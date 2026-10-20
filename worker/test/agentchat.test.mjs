// Talk-to-an-agent and MUSHAK daily report, on a real local D1. Every AI provider is MOCKED.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getBindings, disposeDb, resetDb, noSleep } from './helpers.mjs';
import * as chat from '../agentchat.mjs';
import * as core from '../growth/core.mjs';
import * as out from '../growth/outreach.mjs';
import { dailyReport, istDay, reportDays } from '../growth/analytics.mjs';
import worker from '../index.mjs';

let db;
before(async () => ({ DB: db } = await getBindings()));
after(disposeDb);
beforeEach(() => resetDb(db));
const ENV = { GEMINI_API_KEY: 'g-key' };

const gemini = (text, seen = []) => async (url, init) => {
  const body = JSON.parse(init.body);
  seen.push(body);
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }), { status: 200 });
};
const sysOf = (b) => JSON.stringify(b.systemInstruction ?? b.system_instruction ?? b);

test('agent chat: persona + craft in the prompt, own history per agent, proposals limited to the agent’s templates', async () => {
  const seen = [];
  const r = await chat.send(ENV, db, 'littleloop_vyasa_scriptwriter', { message: 'Ek 20 second ki script likho bunny par' }, { fetch: gemini('Tathastu, vatsa — here is the script.\nACTION: {"type":"start_goal","template":"littleloop_episode","title":"Bunny episode","goal":"Make a 20s bunny episode"}'), sleep: noSleep });
  assert.equal(r.role, 'assistant');
  assert.match(r.content, /^Tathastu/);
  assert.equal(r.action.template, 'littleloop_episode');
  const sent = sysOf(await (async () => { await chat.send(ENV, db, 'littleloop_vyasa_scriptwriter', { message: 'aur ek' }, { fetch: gemini('ok', seen), sleep: noSleep }); return seen[0]; })());
  assert.match(sent, /VYASA/);
  assert.match(sent, /prayer/);
  assert.match(sent, /timestamped script/i, 'the agent’s own mission is in its brain');
  assert.match(sent, /never claim you did/);
  const h = await chat.history(db, 'littleloop_vyasa_scriptwriter');
  assert.deepEqual(h.map((m) => m.role), ['user', 'assistant', 'user', 'assistant']);
  assert.equal((await chat.history(db, 'sunverse_vagdevi_lyricist')).length, 0, 'each agent keeps its own conversation');

  // A LittleLoop agent cannot propose a Sunverse goal.
  const x = await chat.send(ENV, db, 'littleloop_vyasa_scriptwriter', { message: 'song bhi' }, { fetch: gemini('Not mine.\nACTION: {"type":"start_goal","template":"sunverse_song_release","title":"Song","goal":"song"}'), sleep: noSleep });
  assert.equal(x.action, null);
  await chat.clear(db, 'littleloop_vyasa_scriptwriter');
  assert.equal((await chat.history(db, 'littleloop_vyasa_scriptwriter')).length, 0);
});

test('agent chat: unknown agent 404, empty message 400, no engine → clear error and the prayer is not left dangling', async () => {
  await assert.rejects(chat.send(ENV, db, 'nobody', { message: 'hi' }), /Unknown agent/);
  await assert.rejects(chat.send(ENV, db, 'ops_soma_analytics', { message: '  ' }), /message is required/);
  await assert.rejects(chat.send({}, db, 'ops_soma_analytics', { message: 'hi' }), /could not answer/);
  assert.equal((await chat.history(db, 'ops_soma_analytics')).length, 0);
});

test('MUSHAK: answers from real Growth numbers; daily report counts the IST day from saved rows', async () => {
  const c = await core.createCampaign(db, { brand: 'littleloop', name: 'Kids publishers', objective: 'sponsorship' });
  const l = (await core.createLead(db, { brand: 'littleloop', campaignId: c.id, name: 'Tiny Tales', website: 'tinytales.example', contactEmail: 'hello@tinytales.example' })).lead;
  const d = await out.createDraft({}, db, { leadId: l.id, channel: 'manual', body: 'Hello, a short collaboration idea. If this is not relevant, just reply "no thanks".' });
  await out.approveDraft(db, d.id);
  await out.sendDraft({}, db, d.id, { confirmSent: true });
  await db.prepare("INSERT INTO growth_jobs (id, brand, campaign_id, kind, agent_id, status, attempts, input_tokens, output_tokens, cost_usd, summary, created_at, finished_at) VALUES ('j1','littleloop',?, 'discover','narada_market_intelligence','succeeded',1,100,50,0.001,'1 leads found',?,?)").bind(c.id, new Date().toISOString(), new Date().toISOString()).run();

  const r = await dailyReport(db);
  assert.equal(r.day, istDay());
  assert.equal(r.counts.leadsFound, 1);
  assert.equal(r.counts.drafts, 1);
  assert.equal(r.counts.approved, 1);
  assert.equal(r.counts.sent, 1);
  assert.equal(r.counts.searches, 1);
  assert.equal(r.jobs[0].agent, 'NARADA');
  assert.equal(r.tokens.input, 100);
  assert.match(r.headline, /found 1 lead/);
  assert.equal(r.byBrand.littleloop.sent, 1);
  assert.ok(r.timeline.some((t) => t.kind === 'message_sent'));
  const empty = await dailyReport(db, '2020-01-01');
  assert.equal(empty.counts.jobs, 0);
  assert.match(empty.headline, /No Growth work/);
  assert.ok((await reportDays(db)).some((x) => x.day === istDay() && x.events > 0));

  const seen = [];
  await chat.send(ENV, db, 'mushak_growth', { message: 'aaj kya kiya?' }, { fetch: gemini('Aaj maine…', seen), sleep: noSleep });
  const sys = sysOf(seen[0]);
  assert.match(sys, /MUSHAK/);
  assert.match(sys, /sent 1/);
});

test('http: agent chat and daily report are owner-only', async () => {
  const ctx = { waitUntil: (p) => p.catch(() => {}) };
  const env = { DB: db, ASSETS: { fetch: async () => new Response('ok') }, ADMIN_TOKEN: 't' };
  assert.equal((await worker.fetch(new Request('https://g.test/api/agent-chat/ops_soma_analytics'), env, ctx)).status, 401);
  assert.equal((await worker.fetch(new Request('https://g.test/api/growth/daily'), env, ctx)).status, 401);
  const r = await worker.fetch(new Request('https://g.test/api/agent-chat/ops_soma_analytics', { headers: { authorization: 'Bearer t' } }), env, ctx);
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).messages, []);
  const d = await worker.fetch(new Request('https://g.test/api/growth/daily?date=2026-10-20', { headers: { authorization: 'Bearer t' } }), env, ctx);
  assert.equal((await d.json()).day, '2026-10-20');
});

test('http: chats stream with an immediate keepalive ping, then done/error (no 100-second cut-off)', async () => {
  const ctx = { waitUntil: (p) => p.catch(() => {}) };
  const env = { DB: db, ASSETS: { fetch: async () => new Response('ok') }, ADMIN_TOKEN: 't' };
  const H = { authorization: 'Bearer t', 'content-type': 'application/json' };
  for (const path of ['/api/agent-chat/ops_soma_analytics', '/api/cbo/chat']) {
    const r = await worker.fetch(new Request(`https://g.test${path}`, { method: 'POST', headers: H, body: JSON.stringify({ message: 'hi', engine: 'gemini', stream: true }) }), env, ctx);
    assert.match(r.headers.get('content-type'), /event-stream/);
    const text = await r.text();
    assert.match(text.split('\n\n')[0], /^event: ping/, `${path}: first event is a keepalive`);
    assert.match(text, /event: error/, `${path}: no AI key here, so it ends with a clear error event`);
  }
});

test('Gemini 503 "high demand": retried, then the next fallback model answers', async () => {
  const { callGeminiInteraction } = await import('../cbochat.mjs');
  const models = [];
  const fetch = async (url, init) => {
    const m = JSON.parse(init.body).model;
    models.push(m);
    if (m === 'gemini-3.8-flash') return new Response(JSON.stringify({ error: { code: 503, message: 'This model is currently experiencing high demand.', status: 'UNAVAILABLE' } }), { status: 503 });
    return new Response(JSON.stringify({ id: 'i', steps: [{ type: 'model_output', content: [{ type: 'text', text: 'ok from backup' }] }] }), { status: 200 });
  };
  const r = await callGeminiInteraction({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'gemini-3.8-flash' }, db, { system: 's', message: 'm' }, { fetch, sleep: noSleep });
  assert.equal(r.text, 'ok from backup');
  assert.deepEqual(models, ['gemini-3.8-flash', 'gemini-3.8-flash', 'gemini-3.6-flash']);
  // A bad key is not retried.
  let n = 0;
  await assert.rejects(callGeminiInteraction({ GEMINI_API_KEY: 'k' }, db, { system: 's', message: 'm' }, { fetch: async () => (n++, new Response('{"error":{"code":400}}', { status: 400 })), sleep: noSleep }));
  assert.equal(n, 1);
});
