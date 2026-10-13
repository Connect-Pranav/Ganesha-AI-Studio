// Worker backend tests on a real local D1 with a MOCKED provider (no network, no real keys).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDb, disposeDb, resetDb, ENV, noSleep, fakeAnthropic, goodOutput, REGISTRY } from './helpers.mjs';
import {
  TEMPLATES,
  createWorkflow,
  tick,
  getTasks,
  getWorkflow,
  claimTask,
  reclaimExpiredLeases,
  decideApproval,
  completeExternalAction,
  setWorkflowState,
  retryTask,
  stepsToRerun,
} from '../orchestrator.mjs';
import { testProvider, callProvider } from '../providers.mjs';
import worker from '../index.mjs';

let db;
before(async () => {
  db = await getDb();
});
after(disposeDb);
beforeEach(() => resetDb(db));

const status = async (wfId) => Object.fromEntries((await getTasks(db, wfId)).map((t) => [t.step_key, t.status]));
async function drain(env, deps, max = 30) {
  for (let i = 0; i < max; i++) {
    const r = await tick(env, db, deps);
    if (!r.ran.length && !r.reclaimed) return i;
  }
  return max;
}

test('registry: the backend sees all 31 agents and every template agent exists', () => {
  assert.equal(REGISTRY.agents.length, 31);
  for (const t of Object.values(TEMPLATES)) for (const s of t.steps) assert.ok(REGISTRY.agents.some((a) => a.id === s.agent), s.agent);
});

test('create: one task per template step; idempotency key returns the same workflow', async () => {
  const a = await createWorkflow(db, { template: 'sunverse_song_release', title: 'Monsoon song', idempotencyKey: 'k1' });
  const b = await createWorkflow(db, { template: 'sunverse_song_release', title: 'Monsoon song', idempotencyKey: 'k1' });
  assert.equal(a.duplicate, false);
  assert.equal(b.duplicate, true);
  assert.equal(b.id, a.id);
  assert.equal((await getTasks(db, a.id)).length, TEMPLATES.sunverse_song_release.steps.length);
  const n = await db.prepare('SELECT COUNT(*) AS n FROM workflows').first();
  assert.equal(n.n, 1);
  await assert.rejects(createWorkflow(db, { template: 'nope', title: 'x' }), /Unknown template/);
});

test('dependencies: first tick only runs root steps', async () => {
  const fetch = fakeAnthropic();
  const wf = await createWorkflow(db, { template: 'sunverse_song_release', title: 'Song' });
  const r = await tick(ENV, db, { fetch, sleep: noSleep });
  assert.deepEqual(r.ran.map((x) => x.split(':')[1]), ['trends']);
  const s = await status(wf.id);
  assert.equal(s.trends, 'completed');
  assert.equal(s.composition, 'queued');
  assert.equal(fetch.calls[0].agentId, 'sunverse_gandharva_trend_analyst');
});

test('structured hand-off: downstream prompt contains upstream deliverable; usage is logged', async () => {
  const fetch = fakeAnthropic();
  const wf = await createWorkflow(db, { template: 'research_brief', title: 'Kids music trends', goal: 'Find gaps' });
  await drain(ENV, { fetch, sleep: noSleep });
  assert.equal((await getWorkflow(db, wf.id)).status, 'completed');
  const qaCall = fetch.calls.find((c) => c.agentId === 'chitragupta_quality_audit');
  assert.match(qaCall.prompt, /Upstream: research by narada_market_intelligence/);
  assert.match(qaCall.prompt, /NARADA deliverable/);
  const usage = await db.prepare("SELECT COUNT(*) AS n, SUM(input_tokens) AS i FROM provider_calls WHERE status='success'").first();
  assert.equal(usage.n, 3);
  assert.equal(usage.i, 360);
  const tasks = await getTasks(db, wf.id);
  assert.ok(tasks.every((t) => t.provider === 'claude' && t.model === 'claude-test' && t.output_artifact));
});

test('gate fail routes a correction to the responsible step, then passes', async () => {
  const fetch = fakeAnthropic((agent, n) =>
    agent === 'chitragupta_quality_audit' && n === 1
      ? { output: goodOutput(agent, { verdict: 'fail', fixes: [{ step_key: 'research', instruction: 'Add evidence for claim 2' }] }) }
      : {},
  );
  const wf = await createWorkflow(db, { template: 'research_brief', title: 'Brief' });
  await drain(ENV, { fetch, sleep: noSleep });
  assert.equal((await getWorkflow(db, wf.id)).status, 'completed');
  const naradaCalls = fetch.calls.filter((c) => c.agentId === 'narada_market_intelligence');
  assert.equal(naradaCalls.length, 2);
  assert.match(naradaCalls[1].prompt, /Add evidence for claim 2/);
  const qa = (await getTasks(db, wf.id)).find((t) => t.step_key === 'qa');
  assert.equal(qa.qa, 'pass');
  assert.equal(qa.attempts, 2);
});

test('gate fail with no attempts left stops the workflow as failed (no silent loop)', async () => {
  const fetch = fakeAnthropic((agent) =>
    agent === 'chitragupta_quality_audit' ? { output: goodOutput(agent, { verdict: 'fail', fixes: [{ step_key: 'research', instruction: 'Redo' }] }) } : {},
  );
  const wf = await createWorkflow(db, { template: 'research_brief', title: 'Brief' });
  const ticks = await drain(ENV, { fetch, sleep: noSleep });
  assert.ok(ticks < 30);
  assert.equal((await getWorkflow(db, wf.id)).status, 'failed');
});

test('stepsToRerun includes steps between the fixed step and the gate', () => {
  const tasks = TEMPLATES.sunverse_song_release.steps.map((s) => ({ step_key: s.key, depends_on: s.dependsOn, is_gate: s.gate ? 1 : 0 }));
  const { targets, rerun } = stepsToRerun(tasks, 'safety', ['lyrics']);
  assert.deepEqual(targets, ['lyrics']);
  for (const k of ['lyrics', 'artwork', 'video', 'safety']) assert.ok(rerun.includes(k), k);
  assert.ok(!rerun.includes('composition'));
  assert.ok(!rerun.includes('qa'), 'downstream of the gate is not reset');
});

test('approval gate: stops, approve → waiting_for_external_action, confirm → completes', async () => {
  const fetch = fakeAnthropic();
  const wf = await createWorkflow(db, { template: 'foliocraft_feature', title: 'Theme preview' });
  await drain(ENV, { fetch, sleep: noSleep });
  assert.equal((await getWorkflow(db, wf.id)).status, 'waiting_for_approval');
  assert.equal((await status(wf.id)).handoff, 'queued');
  const ap = await db.prepare("SELECT * FROM approvals WHERE workflow_id = ? AND status = 'pending'").bind(wf.id).first();
  assert.equal(ap.action, 'build');

  assert.equal(await decideApproval(db, ap.id, 'approved'), 'waiting_for_external_action');
  await assert.rejects(decideApproval(db, ap.id, 'approved'), /already approved/); // no double action
  const build = (await getTasks(db, wf.id)).find((t) => t.step_key === 'build');
  await completeExternalAction(db, build.id, { reference: 'https://github.com/x/pull/1' });
  await drain(ENV, { fetch, sleep: noSleep });
  assert.equal((await getWorkflow(db, wf.id)).status, 'completed');
});

test('approval rejected cancels the workflow', async () => {
  const fetch = fakeAnthropic();
  const wf = await createWorkflow(db, { template: 'foliocraft_feature', title: 'Theme preview' });
  await drain(ENV, { fetch, sleep: noSleep });
  const ap = await db.prepare("SELECT id FROM approvals WHERE workflow_id = ?").bind(wf.id).first();
  assert.equal(await decideApproval(db, ap.id, 'rejected', { note: 'not now' }), 'cancelled');
  assert.equal((await status(wf.id)).handoff, 'cancelled');
});

test('leases: only one worker can claim a task; expired leases are reclaimed', async () => {
  const wf = await createWorkflow(db, { template: 'research_brief', title: 'Brief' });
  const t = (await getTasks(db, wf.id)).find((x) => x.step_key === 'research');
  assert.equal(await claimTask(db, t.id, 'w1'), true);
  assert.equal(await claimTask(db, t.id, 'w2'), false);
  await db.prepare("UPDATE tasks SET lease_expires_at = '2000-01-01T00:00:00Z' WHERE id = ?").bind(t.id).run();
  assert.equal(await reclaimExpiredLeases(db), 1);
  const after = (await getTasks(db, wf.id)).find((x) => x.id === t.id);
  assert.equal(after.status, 'queued');
  assert.equal(after.attempts, 1);
});

test('resume after interruption does not repeat completed work', async () => {
  const fetch = fakeAnthropic();
  const wf = await createWorkflow(db, { template: 'research_brief', title: 'Brief' });
  await tick(ENV, db, { fetch, sleep: noSleep }); // research done
  const t = (await getTasks(db, wf.id)).find((x) => x.step_key === 'qa');
  await claimTask(db, t.id, 'dead-worker'); // worker dies mid-task
  await db.prepare("UPDATE tasks SET lease_expires_at = '2000-01-01T00:00:00Z' WHERE id = ?").bind(t.id).run();
  await drain(ENV, { fetch, sleep: noSleep });
  assert.equal((await getWorkflow(db, wf.id)).status, 'completed');
  assert.equal(fetch.calls.filter((c) => c.agentId === 'narada_market_intelligence').length, 1);
});

test('transient 429 is retried with backoff; missing key fails clearly; manual retry recovers', async () => {
  const fetch = fakeAnthropic(() => ({ status: 429, body: 'rate limited' }));
  const wf = await createWorkflow(db, { template: 'research_brief', title: 'Brief' });
  await tick(ENV, db, { fetch, sleep: noSleep });
  let t = (await getTasks(db, wf.id)).find((x) => x.step_key === 'research');
  assert.equal(t.status, 'queued');
  assert.ok(t.next_attempt_at > new Date().toISOString().slice(0, 19));
  assert.match(t.error, /HTTP 429/);
  assert.equal(fetch.calls.length, 3, 'callProvider retries 3 times inside one attempt');

  const noKey = { ...ENV, ANTHROPIC_API_KEY: '' };
  await db.prepare('UPDATE tasks SET next_attempt_at = NULL WHERE id = ?').bind(t.id).run();
  await tick(noKey, db, { fetch, sleep: noSleep });
  t = (await getTasks(db, wf.id)).find((x) => x.step_key === 'research');
  assert.equal(t.status, 'failed');
  assert.match(t.error, /not configured: secret ANTHROPIC_API_KEY/);
  assert.equal((await getWorkflow(db, wf.id)).status, 'failed');

  await retryTask(db, t.id);
  await drain(ENV, { fetch: fakeAnthropic(), sleep: noSleep });
  assert.equal((await getWorkflow(db, wf.id)).status, 'completed');
});

test('output that misses acceptance criteria is rejected, retried, then fails', async () => {
  const bad = { summary: 'x', deliverable: 'y'.repeat(100), acceptance: [], open_questions: [] };
  const fetch = fakeAnthropic((agent) => (agent === 'narada_market_intelligence' ? { output: bad } : {}));
  const wf = await createWorkflow(db, { template: 'research_brief', title: 'Brief' });
  await tick(ENV, db, { fetch, sleep: noSleep });
  let t = (await getTasks(db, wf.id)).find((x) => x.step_key === 'research');
  assert.equal(t.status, 'queued');
  assert.match(t.feedback, /acceptance criterion not addressed/);
  for (let i = 0; i < 4; i++) {
    await db.prepare('UPDATE tasks SET next_attempt_at = NULL WHERE id = ?').bind(t.id).run();
    await tick(ENV, db, { fetch, sleep: noSleep });
  }
  t = (await getTasks(db, wf.id)).find((x) => x.step_key === 'research');
  assert.equal(t.status, 'failed');
  assert.equal(t.attempts, t.max_attempts);
  const rejected = await db.prepare("SELECT COUNT(*) AS n FROM artifacts WHERE kind = 'rejected_output'").first();
  assert.equal(rejected.n, t.max_attempts);
});

test('cancel during a running task: the late result is discarded', async () => {
  const wf = await createWorkflow(db, { template: 'research_brief', title: 'Brief' });
  let release;
  const gate = new Promise((r) => (release = r));
  const slow = fakeAnthropic();
  const fetch = async (...a) => (await gate, slow(...a));
  const running = tick(ENV, db, { fetch, sleep: noSleep });
  await new Promise((r) => setTimeout(r, 50));
  await setWorkflowState(db, wf.id, 'cancel');
  release();
  await running;
  assert.equal((await getWorkflow(db, wf.id)).status, 'cancelled');
  assert.equal((await status(wf.id)).research, 'cancelled');
});

test('pause stops progress; resume continues', async () => {
  const fetch = fakeAnthropic();
  const wf = await createWorkflow(db, { template: 'research_brief', title: 'Brief' });
  await setWorkflowState(db, wf.id, 'pause');
  assert.deepEqual((await tick(ENV, db, { fetch, sleep: noSleep })).ran, []);
  await setWorkflowState(db, wf.id, 'resume');
  await drain(ENV, { fetch, sleep: noSleep });
  assert.equal((await getWorkflow(db, wf.id)).status, 'completed');
});

test('provider test: not_configured without key, connected only after a live reply, auth error never leaks key', async () => {
  assert.equal((await testProvider({}, db, 'claude')).state, 'not_configured');
  assert.equal((await testProvider(ENV, db, 'claude', { fetch: fakeAnthropic(), sleep: noSleep })).state, 'connected');
  const r = await testProvider(ENV, db, 'claude', {
    fetch: fakeAnthropic(() => ({ status: 401, body: `invalid x-api-key ${ENV.ANTHROPIC_API_KEY}` })),
    sleep: noSleep,
  });
  assert.equal(r.state, 'error');
  assert.equal(r.kind, 'auth');
  assert.ok(!r.message.includes(ENV.ANTHROPIC_API_KEY));
  const logged = await db.prepare("SELECT error FROM provider_calls WHERE status = 'error'").first();
  assert.ok(!logged.error.includes(ENV.ANTHROPIC_API_KEY));
});

test('gemini fallback: overloaded main model falls back to the next free model; bad key does not', async () => {
  const seen = [];
  const fetch = async (url) => {
    const model = /models\/([^:]+):/.exec(url)[1];
    seen.push(model);
    if (model === 'gemini-3.8-flash') return new Response('{"error":{"code":503,"message":"high demand"}}', { status: 503 });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }], usageMetadata: {} }), { status: 200 });
  };
  const r = await callProvider({ GEMINI_API_KEY: 'k' }, db, 'gemini', { system: 's', prompt: 'p', json: true }, { fetch, sleep: noSleep });
  assert.equal(r.model, 'gemini-3.6-flash');
  assert.deepEqual(seen, ['gemini-3.8-flash', 'gemini-3.8-flash', 'gemini-3.8-flash', 'gemini-3.6-flash']);
  const authFail = async () => new Response('{"error":"bad key"}', { status: 403 });
  await assert.rejects(callProvider({ GEMINI_API_KEY: 'k' }, db, 'gemini', { system: 's', prompt: 'p' }, { fetch: authFail, sleep: noSleep }), /HTTP 403/);
});

test('gemini adapter: sends key in header (not URL) and parses JSON + usage', async () => {
  let seen;
  const fetch = async (url, init) => {
    seen = { url, init };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 } }), { status: 200 });
  };
  const r = await callProvider({ GEMINI_API_KEY: 'g-key-SECRET' }, db, 'gemini', { system: 's', prompt: 'p', json: true }, { fetch, sleep: noSleep });
  assert.deepEqual(r.json, { ok: true });
  assert.deepEqual(r.usage, { input: 7, output: 3 });
  assert.ok(!seen.url.includes('g-key-SECRET'));
  assert.equal(seen.init.headers['x-goog-api-key'], 'g-key-SECRET');
});

test('PRIMARY_ENGINE=gemini puts Gemini first for Claude-only agents; D1 override still wins', async () => {
  const { enginesFor } = await import('../orchestrator.mjs');
  const vagdevi = REGISTRY.agents.find((a) => a.id === 'sunverse_vagdevi_lyricist');
  assert.deepEqual(vagdevi.engines, ['claude']);
  assert.deepEqual(await enginesFor(db, { PRIMARY_ENGINE: 'gemini' }, vagdevi), ['gemini', 'claude']);
  assert.deepEqual(await enginesFor(db, {}, vagdevi), ['claude']);
  await db.prepare("INSERT INTO agent_settings (agent_id, engines, updated_at) VALUES (?, '[\"claude\"]', '2026-10-13T00:00:00Z')").bind(vagdevi.id).run();
  assert.deepEqual(await enginesFor(db, { PRIMARY_ENGINE: 'gemini' }, vagdevi), ['claude']);
});

test('Gemini-only setup: a Claude-only agent completes through Gemini', async () => {
  const fetch = async (url, init) => {
    assert.match(url, /generativelanguage\.googleapis\.com/);
    const body = JSON.parse(init.body);
    const agentId = /\(([a-z0-9_]+)\)/.exec(body.systemInstruction.parts[0].text)[1];
    const text = JSON.stringify(goodOutput(agentId));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }), { status: 200 });
  };
  const env = { GEMINI_API_KEY: 'g', PRIMARY_ENGINE: 'gemini', MAX_CONCURRENT_TASKS: '6' };
  const wf = await createWorkflow(db, { template: 'research_brief', title: 'Brief' });
  await drain(env, { fetch, sleep: noSleep });
  assert.equal((await getWorkflow(db, wf.id)).status, 'completed');
  assert.ok((await getTasks(db, wf.id)).every((t) => t.provider === 'gemini'));
});

test('schema: generated file is current; Worker builds every table on an empty database', async () => {
  const { execFileSync } = await import('node:child_process');
  const { resetSchemaCache } = await import('../schema.mjs');
  resetSchemaCache();
  execFileSync('node', [new URL('../../scripts/gen-schema.mjs', import.meta.url).pathname, '--check'], { stdio: 'pipe' });
  // Child tables before parents (foreign keys).
  for (const t of ['analytics_snapshots', 'agent_settings', 'events', 'provider_calls', 'approvals', 'artifacts', 'tasks', 'workflows'])
    await db.prepare(`DROP TABLE IF EXISTS ${t}`).run();
  const h = await worker.fetch(new Request('https://g.test/api/analytics/sunverse'), { DB: db, ASSETS: assets }, ctx);
  assert.equal(h.status, 200);
  const { results } = await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  for (const t of ['workflows', 'tasks', 'artifacts', 'approvals', 'provider_calls', 'events', 'agent_settings', 'analytics_snapshots'])
    assert.ok(results.some((r) => r.name === t), `missing ${t}`);
});

/* ---------------- HTTP layer ---------------- */
const assets = { fetch: async () => new Response('<html>dashboard</html>', { headers: { 'content-type': 'text/html' } }) };
const ctx = { waitUntil: (p) => p.catch(() => {}) };
const req = (path, init = {}) => new Request(`https://ganesha.test${path}`, init);

test('http: health is public; API is locked without ADMIN_TOKEN and rejects a wrong token', async () => {
  const env = { DB: db, ASSETS: assets };
  const h = await worker.fetch(req('/api/health'), env, ctx);
  assert.equal(h.status, 200);
  const body = await h.json();
  assert.equal(body.agents, 31);
  assert.equal(JSON.stringify(body).includes('sk-'), false);
  assert.equal((await worker.fetch(req('/api/workflows'), env, ctx)).status, 503);
  const env2 = { ...env, ADMIN_TOKEN: 'right-token' };
  assert.equal((await worker.fetch(req('/api/workflows', { headers: { authorization: 'Bearer wrong' } }), env2, ctx)).status, 401);
  assert.equal((await worker.fetch(req('/'), env2, ctx)).status, 200, 'dashboard still served');
});

test('http: notifications list pending approvals; approving from the bell works once', async () => {
  const fetch = fakeAnthropic();
  const wf = await createWorkflow(db, { template: 'foliocraft_feature', title: 'Theme preview' });
  await drain(ENV, { fetch, sleep: noSleep });
  const env = { DB: db, ASSETS: assets, ADMIN_TOKEN: 't' };
  const headers = { authorization: 'Bearer t', 'content-type': 'application/json' };
  assert.equal((await worker.fetch(req('/api/notifications'), env, ctx)).status, 401);
  const n = await (await worker.fetch(req('/api/notifications', { headers }), env, ctx)).json();
  assert.equal(n.counts.approvals, 1);
  assert.equal(n.approvals[0].workflow_title, 'Theme preview');
  assert.equal(n.approvals[0].action, 'build');
  assert.ok(n.approvals[0].output_artifact, 'deliverable is viewable before approving');
  const body = JSON.stringify({ decision: 'approved' });
  assert.equal((await worker.fetch(req(`/api/approvals/${n.approvals[0].id}`, { method: 'POST', headers, body }), env, ctx)).status, 200);
  assert.equal((await worker.fetch(req(`/api/approvals/${n.approvals[0].id}`, { method: 'POST', headers, body }), env, ctx)).status, 409);
  const after = await (await worker.fetch(req('/api/notifications', { headers }), env, ctx)).json();
  assert.equal(after.counts.approvals, 0);
  assert.equal(after.counts.external, 1, 'approved step now waits for the owner to confirm it was done');
  assert.equal((await getWorkflow(db, wf.id)).status, 'waiting_for_external_action');
});

test('http: create workflow with Idempotency-Key, read it back, provider status shows not_configured', async () => {
  const env = { DB: db, ASSETS: assets, ADMIN_TOKEN: 't0k3n' };
  const headers = { authorization: 'Bearer t0k3n', 'content-type': 'application/json', 'idempotency-key': 'abc' };
  const body = JSON.stringify({ template: 'research_brief', title: 'Shorts hooks' });
  const r1 = await worker.fetch(req('/api/workflows', { method: 'POST', headers, body }), env, ctx);
  const r2 = await worker.fetch(req('/api/workflows', { method: 'POST', headers, body }), env, ctx);
  assert.equal(r1.status, 201);
  assert.equal(r2.status, 200);
  const id = (await r1.json()).id;
  assert.equal((await r2.json()).id, id);
  const g = await (await worker.fetch(req(`/api/workflows/${id}`, { headers }), env, ctx)).json();
  assert.equal(g.tasks.length, 3);
  const p = await (await worker.fetch(req('/api/providers', { headers }), env, ctx)).json();
  assert.deepEqual(p.providers.map((x) => x.state), ['not_configured', 'not_configured']);
  const agents = await (await worker.fetch(req('/api/agents', { headers }), env, ctx)).json();
  assert.equal(agents.count, 31);
});

test('http: summary counts real rows only; null/zero honest on empty DB; never leaks keys', async () => {
  const env = { DB: db, ASSETS: assets, ADMIN_TOKEN: 't', ANTHROPIC_API_KEY: 'sk-test-anthropic-SECRET', YOUTUBE_API_KEY: 'yt-SECRET' };
  const headers = { authorization: 'Bearer t' };
  assert.equal((await worker.fetch(req('/api/summary'), env, ctx)).status, 401);

  // Empty database: zero goals, no durations (null, not 0), all 31 agents listed with zero work.
  const empty = await (await worker.fetch(req('/api/summary', { headers }), env, ctx)).json();
  assert.deepEqual(empty.workflows, []);
  assert.equal(empty.taskDurationSec, null);
  assert.equal(empty.agents.length, 31);
  assert.ok(empty.agents.every((a) => a.total === 0 && a.gate === null));
  assert.equal(empty.integrations.youtubeStats.configured, true);
  assert.equal(empty.integrations.youtubeUpload.configured, false);
  assert.equal(empty.providers.find((p) => p.provider === 'claude').state, 'key_set_untested');

  // One goal driven to its approval stop.
  const fetch = fakeAnthropic();
  const wf = await createWorkflow(db, { template: 'foliocraft_feature', title: 'Theme preview' });
  await drain(ENV, { fetch, sleep: noSleep });
  const s = await (await worker.fetch(req('/api/summary', { headers }), env, ctx)).json();
  assert.equal(s.workflows.length, 1);
  assert.equal(s.workflows[0].id, wf.id);
  assert.equal(s.workflows[0].steps, TEMPLATES.foliocraft_feature.steps.length);
  assert.equal(s.counts.workflowsByStatus.waiting_for_approval, 1);
  assert.equal(s.counts.workflowsByBrand.foliocraft.waiting_for_approval, 1);
  assert.equal(s.counts.approvalsByStatus.pending, 1);
  const done = s.agents.filter((a) => a.completed > 0).map((a) => a.id);
  assert.ok(done.includes('foliocraft_brahma_product_architect'));
  assert.ok(s.agents.find((a) => a.id === 'chitragupta_quality_audit').gate.pass >= 1);
  assert.ok(s.usage30d.some((u) => u.provider === 'claude' && u.calls > 0));
  assert.ok(s.events.length > 0);
  const raw = JSON.stringify(s);
  assert.equal(raw.includes('SECRET'), false, 'no key material in summary');

  // Deliverables list for the brand: metadata only, content stays behind /api/artifacts/:id.
  const list = await (await worker.fetch(req('/api/artifacts?brand=foliocraft', { headers }), env, ctx)).json();
  assert.ok(list.artifacts.length >= 4);
  assert.ok(list.artifacts.every((a) => a.workflow_id === wf.id && !('content_json' in a)));
  assert.equal((await (await worker.fetch(req('/api/artifacts?brand=sunverse', { headers }), env, ctx)).json()).artifacts.length, 0);
  assert.equal((await worker.fetch(req('/api/artifacts?brand=nope', { headers }), env, ctx)).status, 400);
});
