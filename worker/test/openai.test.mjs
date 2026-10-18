// OpenAI provider (Responses API) on a real local D1. Every OpenAI call here is MOCKED with a fake
// fetch: these tests prove request building, parsing, errors, retries, budgets, logging and redaction.
// They do NOT prove a live OpenAI connection — that is the Settings "Test key & model" button.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getBindings, disposeDb, resetDb, noSleep } from './helpers.mjs';
import * as oa from '../openai.mjs';
import { callProvider, testProvider, providerConfig, PROVIDERS, AUTO_FALLBACK_PROVIDERS } from '../providers.mjs';
import { enginesFor } from '../orchestrator.mjs';
import { agentById } from '../agents.mjs';
import * as secrets from '../secrets.mjs';
import worker from '../index.mjs';

let db;
before(async () => ({ DB: db } = await getBindings()));
after(disposeDb);
beforeEach(async () => {
  await resetDb(db);
  secrets.resetSecretsCache(); // the 60 s settings cache would otherwise carry values between tests
});

const KEY = 'sk-proj-TESTKEY0123456789abcdefSECRET';
const ENV = { OPENAI_API_KEY: KEY };
const IMG = 'data:image/png;base64,iVBORw0KGgo=';

const okBody = (text = 'Namaste!', extra = {}) => ({
  id: 'resp_1',
  object: 'response',
  status: 'completed',
  model: 'gpt-6-luna',
  output: [
    ...(extra.reasoning ? [{ type: 'reasoning', id: 'rs_1', summary: [{ type: 'summary_text', text: extra.reasoning }] }] : []),
    ...(extra.tool ? [{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: extra.tool.name, arguments: JSON.stringify(extra.tool.args), status: 'completed' }] : []),
    ...(text !== null ? [{ type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: extra.cite ? [{ type: 'url_citation', url: 'https://example.com/n', title: 'News' }] : [] }] }] : []),
  ],
  usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 400 }, output_tokens: 500, output_tokens_details: { reasoning_tokens: 120 }, total_tokens: 1500 },
  ...extra.top,
});

/** Scripted fake fetch: each entry is a Response factory or a function(url, init). */
function fake(...steps) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    const s = steps[Math.min(calls.length - 1, steps.length - 1)];
    return typeof s === 'function' ? s(url, init) : s.clone();
  };
  fn.calls = calls;
  return fn;
}
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'x-request-id': 'req_abc123', ...headers } });
const err = (status, code, message, type = 'invalid_request_error') => json({ error: { message, type, code, param: null } }, status);
const deps = (f) => ({ fetch: f, sleep: noSleep });

test('config: default model, configured model, limits; OpenAI is opt-in only (never auto-fallback)', async () => {
  const d = oa.openaiConfig({});
  assert.equal(d.configured, false);
  assert.equal(d.model, oa.DEFAULT_OPENAI_MODEL);
  assert.equal(d.modelSource, 'default');
  assert.equal(d.maxOutputTokens, 8192);
  assert.equal(d.dailyRequestLimit, 200);
  const c = oa.openaiConfig({ OPENAI_API_KEY: KEY, OPENAI_MODEL: ' gpt-6.1-sol ', OPENAI_MAX_OUTPUT_TOKENS: '2000', OPENAI_DAILY_REQUEST_LIMIT: '5' });
  assert.equal(c.model, 'gpt-6.1-sol');
  assert.equal(c.maxOutputTokens, 2000);
  assert.equal(c.dailyRequestLimit, 5);
  assert.equal(oa.openaiConfig({ OPENAI_MAX_OUTPUT_TOKENS: 'lots' }).maxOutputTokens, 8192, 'bad limit → safe default');
  assert.equal(oa.openaiConfig({ OPENAI_MODEL: 'bad model!' }).modelValid, false);
  assert.equal(providerConfig(ENV, 'openai').secretName, 'OPENAI_API_KEY');
  assert.ok(PROVIDERS.includes('openai'));
  assert.ok(!AUTO_FALLBACK_PROVIDERS.includes('openai'));
  // Even with ALLOW_PROVIDER_FALLBACK, an agent only gets OpenAI when it is chosen for it.
  const engines = await enginesFor(db, { ALLOW_PROVIDER_FALLBACK: 'true' }, agentById('littleloop_vyasa_scriptwriter'));
  assert.ok(!engines.includes('openai'));
  await db.prepare("INSERT INTO agent_settings (agent_id, engines, updated_at) VALUES ('littleloop_vyasa_scriptwriter', '[\"openai\"]', 'now')").run();
  assert.deepEqual(await enginesFor(db, {}, agentById('littleloop_vyasa_scriptwriter')), ['openai']);
});

test('buildBody: Responses API shape, history, images, JSON schema, reasoning, tools, output cap; policy errors', () => {
  const cfg = oa.openaiConfig({ ...ENV, OPENAI_MAX_OUTPUT_TOKENS: '1000' });
  const b = oa.buildBody(cfg, {
    system: 'You are the CBO.',
    prompt: 'What is in this picture?',
    messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }, { role: 'system', content: 'ignored' }, { role: 'user', content: '  ' }],
    images: [IMG],
    maxTokens: 50_000,
    json: true,
    schema: { name: 'answer', schema: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false } },
    reasoning: 'high',
    webSearch: true,
    tools: [{ name: 'start_goal', description: 'Propose', parameters: { type: 'object', properties: {}, additionalProperties: false } }],
  });
  assert.equal(b.model, 'gpt-6-luna');
  assert.equal(b.store, false);
  assert.equal(b.max_output_tokens, 1000, 'caller cannot exceed the server cap');
  assert.match(b.instructions, /You are the CBO\.[\s\S]*JSON object only/);
  assert.deepEqual(b.input.slice(0, 2), [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }]);
  assert.equal(b.input.length, 3, 'system/blank history items dropped');
  assert.deepEqual(b.input[2].content, [{ type: 'input_text', text: 'What is in this picture?' }, { type: 'input_image', image_url: IMG, detail: 'auto' }]);
  assert.deepEqual(b.text.format, { type: 'json_schema', name: 'answer', schema: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false }, strict: true });
  assert.deepEqual(b.reasoning, { effort: 'high' });
  assert.deepEqual(b.tools.map((t) => t.type), ['web_search', 'function']);
  assert.equal(b.stream, undefined);
  assert.deepEqual(oa.buildBody(cfg, { prompt: 'x', json: true }).text, { format: { type: 'json_object' } });
  assert.throws(() => oa.buildBody(cfg, { prompt: '' }), /needs a prompt/);
  assert.throws(() => oa.buildBody(cfg, { prompt: 'x', reasoning: 'turbo' }), /reasoning must be/);
  assert.throws(() => oa.buildBody(cfg, { prompt: 'x', images: ['https://evil.example/x.png'] }), /data URLs/);
  assert.throws(() => oa.buildBody(cfg, { prompt: 'x', tools: [{ name: 'Bad Name', parameters: {} }] }), /Invalid function tool/);
  assert.throws(() => oa.buildBody(oa.openaiConfig({ ...ENV, OPENAI_MODEL: 'no spaces allowed' }), { prompt: 'x' }), /not a valid model ID/);
});

test('generate: mocked success → text, citations, reasoning summary, tool call, usage with cached tokens, request ID, cost logged', async () => {
  const f = fake(json(okBody('Hello from GPT', { cite: true, reasoning: 'Thought briefly.', tool: { name: 'start_goal', args: { template: 't', title: 'x', goal: 'y' } } })));
  const r = await callProvider(ENV, db, 'openai', { system: 'S', prompt: 'P', purpose: 'cbo_chat', agentId: 'ganesha_orchestrator', workflowId: 'wf_1' }, deps(f));
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, 'https://api.openai.com/v1/responses');
  assert.equal(f.calls[0].init.headers.authorization, `Bearer ${KEY}`);
  assert.equal(r.provider, 'openai');
  assert.equal(r.model, 'gpt-6-luna');
  assert.equal(r.text, 'Hello from GPT');
  assert.equal(r.requestId, 'req_abc123');
  assert.deepEqual(r.sources, [{ url: 'https://example.com/n', title: 'News' }]);
  assert.equal(r.thoughts, 'Thought briefly.');
  assert.deepEqual(r.toolCalls, [{ name: 'start_goal', callId: 'call_1', arguments: { template: 't', title: 'x', goal: 'y' } }]);
  assert.deepEqual(r.usage, { input: 1000, cached: 400, output: 500, reasoning: 120 });
  const row = await db.prepare("SELECT c.*, d.cached_input_tokens, d.reasoning_tokens, d.request_id, d.agent_id, d.workflow_id FROM provider_calls c JOIN provider_call_details d ON d.call_id = c.id WHERE c.provider = 'openai'").first();
  assert.equal(row.status, 'success');
  assert.equal(row.purpose, 'cbo_chat');
  assert.equal(row.input_tokens, 1000);
  assert.equal(row.output_tokens, 500);
  assert.equal(row.cached_input_tokens, 400);
  assert.equal(row.reasoning_tokens, 120);
  assert.equal(row.request_id, 'req_abc123');
  assert.equal(row.agent_id, 'ganesha_orchestrator');
  assert.equal(row.workflow_id, 'wf_1');
  // Seeded gpt-6-luna price $0.10 in / $0.50 out per 1M; no published cache price → full input rate.
  assert.ok(Math.abs(row.cost_usd - (1000 * 0.1 + 500 * 0.5) / 1e6) < 1e-12);
});

test('costs: owner pricing row overrides the seed and a cached-input rate is applied', async () => {
  await db.prepare("INSERT INTO provider_pricing (id, provider, model, input_per_mtok, output_per_mtok, cache_read_per_mtok, currency, effective_from, effective_to, free_tier, source_url, verified_at, notes, created_at) VALUES ('pr1','openai','gpt-6-luna',1,2,0.5,'USD','1970-01-01',NULL,0,'https://example.com','2026-10-18',NULL,'2026-10-18')").run();
  const cost = await oa.costUsd(db, oa.openaiConfig(ENV), 'gpt-6-luna', { input: 1000, cached: 400, output: 500 });
  assert.ok(Math.abs(cost - (600 * 1 + 400 * 0.5 + 500 * 2) / 1e6) < 1e-12);
  assert.equal(await oa.costUsd(db, oa.openaiConfig(ENV), 'unknown-model', { input: 1, output: 1 }), null, 'unknown price → no cost, never guessed');
  const env = { ...ENV, OPENAI_PRICE_PER_MTOK: '3,6,1' };
  assert.ok(Math.abs((await oa.costUsd(db, oa.openaiConfig(env), 'x', { input: 100, cached: 0, output: 10 })) - (300 + 60) / 1e6) < 1e-12);
});

test('missing and invalid keys: not_configured; 401 is not retried and the key never appears in errors', async () => {
  await assert.rejects(callProvider({}, db, 'openai', { prompt: 'x' }), (e) => e.kind === 'not_configured' && /OPENAI_API_KEY/.test(e.message));
  const f = fake(err(401, 'invalid_api_key', `Incorrect API key provided: ${KEY}`));
  await assert.rejects(callProvider(ENV, db, 'openai', { prompt: 'x' }, deps(f)), (e) => {
    assert.equal(e.kind, 'auth');
    assert.ok(!e.message.includes(KEY), 'key redacted');
    assert.match(e.message, /request req_abc123/);
    return true;
  });
  assert.equal(f.calls.length, 1);
  const logged = await db.prepare("SELECT error FROM provider_calls WHERE provider = 'openai'").all();
  assert.ok(logged.results.every((r) => !r.error.includes(KEY)), 'logs redacted');
});

test('rate limits retry with backoff; insufficient_quota does not retry; model 404 never switches model', async () => {
  const f = fake(err(429, 'rate_limit_exceeded', 'Rate limit reached', 'requests'), err(429, 'rate_limit_exceeded', 'Rate limit reached', 'requests'), json(okBody('third time')));
  const r = await callProvider(ENV, db, 'openai', { prompt: 'x' }, deps(f));
  assert.equal(r.text, 'third time');
  assert.equal(f.calls.length, 3);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM provider_calls WHERE provider = 'openai' AND status = 'error'").first()).n, 2, 'each failed attempt is recorded');

  const q = fake(err(429, 'insufficient_quota', 'You exceeded your current quota', 'insufficient_quota'));
  await assert.rejects(callProvider(ENV, db, 'openai', { prompt: 'x' }, deps(q)), (e) => e.kind === 'quota' && /billing/.test(e.message));
  assert.equal(q.calls.length, 1);

  const m = fake(err(404, 'model_not_found', 'The model `gpt-9` does not exist'));
  await assert.rejects(callProvider({ ...ENV, OPENAI_MODEL: 'gpt-9' }, db, 'openai', { prompt: 'x' }, deps(m)), (e) => e.kind === 'model_not_found');
  assert.equal(m.calls.length, 1);
  assert.equal(m.calls[0].body.model, 'gpt-9', 'no silent switch to another model');

  const u = fake(err(400, 'unsupported_parameter', "Unsupported parameter: 'reasoning.effort' is not supported with this model."));
  await assert.rejects(callProvider(ENV, db, 'openai', { prompt: 'x', reasoning: 'high' }, deps(u)), (e) => e.kind === 'unsupported');
  assert.equal(u.calls.length, 1);
});

test('server errors and network timeouts: bounded retries (3 attempts), then a clear error', async () => {
  const s = fake(err(503, null, 'overloaded', 'server_error'));
  await assert.rejects(callProvider(ENV, db, 'openai', { prompt: 'x' }, deps(s)), (e) => e.kind === 'server');
  assert.equal(s.calls.length, 3);
  const hang = fake((url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))));
  await assert.rejects(callProvider(ENV, db, 'openai', { prompt: 'x', timeoutMs: 20 }, deps(hang)), (e) => e.kind === 'timeout' && /timed out after 20 ms/.test(e.message));
  assert.equal(hang.calls.length, 3);
});

test('incomplete or non-JSON output is an error, not a silent partial answer', async () => {
  const cut = fake(json({ ...okBody(null), status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }));
  await assert.rejects(callProvider(ENV, db, 'openai', { prompt: 'x' }, deps(cut)), (e) => e.kind === 'bad_output' && /max_output_tokens/.test(e.message));
  const bad = fake(json(okBody('not json at all')));
  await assert.rejects(callProvider(ENV, db, 'openai', { prompt: 'x', json: true }, deps(bad)), /did not return valid JSON/);
  const good = fake(json(okBody('{"ok":true,"n":2}')));
  assert.deepEqual((await callProvider(ENV, db, 'openai', { prompt: 'x', json: true }, deps(good))).json, { ok: true, n: 2 });
});

const sse = (events) =>
  new Response(
    new ReadableStream({
      start(c) {
        const enc = new TextEncoder();
        for (const e of events) c.enqueue(enc.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
        c.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream', 'x-request-id': 'req_stream' } },
  );

test('streaming: deltas reach the caller and the final response is parsed + logged', async () => {
  const f = fake(() =>
    sse([
      { type: 'response.created', response: { id: 'resp_s', status: 'in_progress' } },
      { type: 'response.output_text.delta', delta: 'Nam' },
      { type: 'response.output_text.delta', delta: 'aste' },
      { type: 'response.completed', response: okBody('Namaste') },
    ]),
  );
  const parts = [];
  const r = await oa.generate(ENV, db, { prompt: 'hi', stream: true, onDelta: (t) => parts.push(t), purpose: 'cbo_chat' }, deps(f));
  assert.equal(f.calls[0].body.stream, true);
  assert.deepEqual(parts, ['Nam', 'aste']);
  assert.equal(r.text, 'Namaste');
  assert.equal(r.requestId, 'req_stream');
  assert.equal(r.usage.cached, 400);

  // A failure after text was already shown is NOT retried (it would duplicate output).
  const broken = fake(() => sse([{ type: 'response.output_text.delta', delta: 'Half' }, { type: 'response.failed', response: { error: { message: 'boom' } } }]));
  await assert.rejects(oa.generate(ENV, db, { prompt: 'hi', stream: true, onDelta: () => {} }, deps(broken)), /response failed: boom/);
  assert.equal(broken.calls.length, 1);
});

test('daily request budget blocks before any request is sent', async () => {
  const env = { ...ENV, OPENAI_DAILY_REQUEST_LIMIT: '2' };
  const f = fake(json(okBody('ok')));
  await callProvider(env, db, 'openai', { prompt: 'a' }, deps(f));
  await callProvider(env, db, 'openai', { prompt: 'b' }, deps(f));
  await assert.rejects(callProvider(env, db, 'openai', { prompt: 'c' }, deps(f)), (e) => e.kind === 'budget' && /2\/2/.test(e.message));
  assert.equal(f.calls.length, 2);
  assert.equal(await oa.requestsToday(db), 2);
});

test('connection test: checks key + model for free; live test is explicit; status never exposes the key', async () => {
  assert.equal((await oa.testConnection({}, db)).state, 'not_configured');
  const ok = fake(json({ id: 'gpt-6-luna', object: 'model', owned_by: 'openai' }));
  const t = await testProvider(ENV, db, 'openai', deps(ok));
  assert.equal(ok.calls[0].url, 'https://api.openai.com/v1/models/gpt-6-luna');
  assert.equal(t.state, 'connected');
  assert.equal(t.live, false);
  assert.equal(t.requestId, 'req_abc123');
  const missing = fake(err(404, 'model_not_found', 'The model `gpt-zzz` does not exist or you do not have access to it.'));
  const t2 = await oa.testConnection({ ...ENV, OPENAI_MODEL: 'gpt-zzz' }, db, {}, deps(missing));
  assert.equal(t2.state, 'error');
  assert.equal(t2.kind, 'model_not_found');
  const bad = fake(err(401, 'invalid_api_key', `Incorrect API key provided: ${KEY}`));
  const t3 = await oa.testConnection(ENV, db, {}, deps(bad));
  assert.equal(t3.kind, 'auth');
  assert.ok(!JSON.stringify(t3).includes(KEY));
  const live = fake(json({ id: 'gpt-6-luna' }), json(okBody('{"ok":true}')));
  const t4 = await oa.testConnection(ENV, db, { live: true }, deps(live));
  assert.equal(t4.state, 'connected');
  assert.equal(t4.live, true);
  assert.equal(live.calls[1].body.max_output_tokens, 64);

  const st = await oa.status(ENV, ENV, db);
  assert.equal(st.keySource, 'worker');
  assert.equal(st.model, 'gpt-6-luna');
  assert.equal(st.modelSource, 'default');
  assert.equal(st.month.requests, 0, 'connection tests are not counted as usage');
  assert.equal(st.pricing.input, 0.1);
  assert.equal(st.lastTest.status, 'success');
  assert.ok(!JSON.stringify(st).includes(KEY));
});

test('Settings: OpenAI key/model/limits validated; placeholders, empty values and Cloudflare-owned names refused', async () => {
  secrets.resetSecretsCache();
  const env = { ADMIN_TOKEN: 'admin-1' };
  await assert.rejects(secrets.save(env, db, { name: 'OPENAI_API_KEY', value: 'sk-...' }), /placeholder/);
  await assert.rejects(secrets.save(env, db, { name: 'OPENAI_API_KEY', value: 'YOUR_OPENAI_KEY_HERE' }), /placeholder/);
  await assert.rejects(secrets.save(env, db, { name: 'OPENAI_API_KEY', value: 'hello world key' }), /does not look like an OpenAI API key/);
  await secrets.save(env, db, { name: 'OPENAI_API_KEY', value: KEY });
  await assert.rejects(secrets.save(env, db, { name: 'OPENAI_API_KEY', value: '' }), /Empty value/);
  await assert.rejects(secrets.save(env, db, { name: 'OPENAI_API_KEY', value: '   ' }), /Empty value/);
  assert.equal((await secrets.withSecrets(env, db)).OPENAI_API_KEY, KEY, 'empty input never wiped the working key');
  await assert.rejects(secrets.save(env, db, { name: 'OPENAI_MODEL', value: 'gpt 6' }), /model ID/);
  await secrets.save(env, db, { name: 'OPENAI_MODEL', value: 'gpt-6.1-sol' });
  await assert.rejects(secrets.save(env, db, { name: 'OPENAI_MAX_OUTPUT_TOKENS', value: '999999' }), /whole number/);
  await secrets.save(env, db, { name: 'OPENAI_DAILY_REQUEST_LIMIT', value: '50' });
  await assert.rejects(secrets.save({ ...env, OPENAI_MODEL: 'gpt-6-astra' }, db, { name: 'OPENAI_MODEL', value: 'gpt-6-luna' }), /Cloudflare Worker secret/);
  secrets.resetSecretsCache();
  const merged = await secrets.withSecrets(env, db);
  assert.equal(oa.openaiConfig(merged).model, 'gpt-6.1-sol');
  assert.equal(oa.openaiConfig(merged).dailyRequestLimit, 50);
  const st = await oa.status(env, merged, db);
  assert.equal(st.keySource, 'app');
  assert.equal(st.modelSource, 'app');
  const list = await secrets.list(env, db);
  assert.ok(!JSON.stringify(list).includes(KEY));
  await secrets.save(env, db, { name: 'OPENAI_API_KEY', value: null });
  secrets.resetSecretsCache();
  assert.equal((await secrets.withSecrets(env, db)).OPENAI_API_KEY, undefined, 'explicit Remove still works');
});

test('redact removes the configured key and any sk- shaped token', () => {
  assert.equal(oa.redact(`key ${KEY} and sk-otherKEY12345678 end`, ENV), 'key [redacted] and sk-[redacted] end');
});

test('http: OpenAI status/test endpoints are owner-only and keyless; chat streams over SSE (global fetch mocked)', async () => {
  const assets = { fetch: async () => new Response('x') };
  const env = { DB: db, ASSETS: assets, ADMIN_TOKEN: 't0k3n', OPENAI_API_KEY: KEY, MEDIA: (await getBindings()).MEDIA };
  const ctx = { waitUntil: (p) => p.catch(() => {}) };
  const req = (path, init = {}) => new Request(`https://ganesha.test${path}`, init);
  const H = { authorization: 'Bearer t0k3n', 'content-type': 'application/json' };
  assert.equal((await worker.fetch(req('/api/settings/openai'), env, ctx)).status, 401);
  assert.equal((await worker.fetch(req('/api/settings/test-openai', { method: 'POST', body: '{}' }), env, ctx)).status, 401);
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.endsWith('/v1/models/gpt-6-luna')) return json({ id: 'gpt-6-luna' });
      if (u.endsWith('/v1/responses'))
        return sse([{ type: 'response.output_text.delta', delta: 'Stream ' }, { type: 'response.output_text.delta', delta: 'works' }, { type: 'response.completed', response: okBody('Stream works') }]);
      throw new Error(`unexpected fetch ${u}`);
    };
    const st = await (await worker.fetch(req('/api/settings/openai', { headers: H }), env, ctx)).text();
    assert.ok(!st.includes(KEY));
    assert.equal(JSON.parse(st).keySource, 'worker');
    const t = await (await worker.fetch(req('/api/settings/test-openai', { method: 'POST', headers: H, body: '{}' }), env, ctx)).json();
    assert.equal(t.state, 'connected', JSON.stringify(t));
    const res = await worker.fetch(req('/api/cbo/chat', { method: 'POST', headers: H, body: JSON.stringify({ message: 'hi', engine: 'openai', stream: true }) }), env, ctx);
    assert.match(res.headers.get('content-type'), /text\/event-stream/);
    const text = await res.text();
    assert.match(text, /event: delta\ndata: \{"t":"Stream "\}/);
    const done = JSON.parse(/event: done\ndata: (.*)/.exec(text)[1]);
    assert.equal(done.reply.content, 'Stream works');
    assert.ok(!text.includes(KEY));
  } finally {
    globalThis.fetch = realFetch;
  }
});
