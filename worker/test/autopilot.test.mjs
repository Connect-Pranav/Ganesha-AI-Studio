// CBO Autopilot on a real local D1 (no provider calls needed to plan).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDb, disposeDb, resetDb, REGISTRY } from './helpers.mjs';
import { runAutopilot, candidates, decideProposal, listProposals, scheduledAutopilot } from '../autopilot.mjs';
import { saveSettings } from '../finance.mjs';
import { createWorkflow } from '../orchestrator.mjs';

let db;
before(async () => {
  db = await getDb();
});
after(disposeDb);
beforeEach(() => resetDb(db));

async function seedSoma() {
  const data = { fetchedAt: '2026-10-14T16:30:05Z', channel: { subscribers: 12 }, videos: [{ id: 'a', title: 'Judaiyan', views: 212, publishedAt: '2026-09-01T00:00:00Z' }, { id: 'b', title: 'Shaam Ki Laali', views: 202, publishedAt: '2026-08-01T00:00:00Z' }] };
  const ins = { nextActions: [{ action: 'Upload a Short cut from the best video' }] };
  await db.prepare("INSERT INTO analytics_snapshots (id, brand, source, account_ref, fetched_at, data_json, insights_json, insights_at) VALUES ('s1','sunverse','youtube_data_api','@SURVERSE_09','2026-10-14T16:30:05Z',?,?,?)").bind(JSON.stringify(data), JSON.stringify(ins), '2026-10-14T05:19:59Z').run();
}

test('candidates come from real records: SOMA data drives the Sunverse goal; open work is never duplicated', async () => {
  await seedSoma();
  const c = await candidates(db);
  assert.deepEqual(c.map((x) => x.template), ['sunverse_song_release', 'littleloop_episode', 'ops_weekly_review', 'foliocraft_feature']);
  const sv = c[0];
  assert.match(sv.goal, /Judaiyan/);
  assert.match(sv.goal, /SOMA's top recommendation: Upload a Short/);
  assert.match(sv.goal, /do not publish/);
  assert.ok(sv.evidence.some((e) => /212 views/.test(e)));
  await createWorkflow(db, { template: 'littleloop_episode', title: 'open one' });
  assert.ok(!(await candidates(db)).some((x) => x.template === 'littleloop_episode'), 'open episode → no new one');
});

test('auto mode with ₹0 cap and unknown cost: proposes (never spends silently); max goals per day; idempotent', async () => {
  const r = await runAutopilot({}, db);
  assert.equal(r.mode, 'auto');
  assert.equal(r.actions.length, 2, 'default max 2 goals/day');
  assert.ok(r.actions.every((a) => a.status === 'proposed'));
  assert.match(r.actions[0].reason, /waits for your tap/);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM workflows').first()).n, 0);
  const again = await runAutopilot({}, db);
  assert.equal(again.actions.length, 0);
  assert.equal((await listProposals(db)).length, 2);
});

test('auto mode starts provably free work by itself (Gemini marked free tier), and the CBO is the creator', async () => {
  await saveSettings(db, { fxUsdInr: { rate: 84, source: 't' }, providerBilling: { gemini: 'free' } });
  const env = { GEMINI_API_KEY: 'g', PRIMARY_ENGINE: 'gemini' };
  const r = await runAutopilot(env, db);
  assert.equal(r.actions.length, 2);
  for (const a of r.actions) {
    assert.equal(a.status, 'started', a.reason);
    assert.equal(a.estInr, 0);
    const wf = await db.prepare('SELECT created_by, status FROM workflows WHERE id = ?').bind(a.workflowId).first();
    assert.equal(wf.created_by, 'GANESHA_CBO');
  }
  assert.ok(await db.prepare("SELECT 1 FROM events WHERE kind = 'autopilot_started'").first());
});

test('auto mode respects the daily ₹ cap; suggest mode never starts; off does nothing; dispatch pause holds', async () => {
  await saveSettings(db, { fxUsdInr: { rate: 84, source: 't' }, providerBilling: { gemini: 'paid' }, autopilotDailyInr: 0.0001 });
  const r = await runAutopilot({ GEMINI_API_KEY: 'g', PRIMARY_ENGINE: 'gemini' }, db);
  assert.ok(r.actions.every((a) => a.status === 'proposed' && /above your autopilot daily limit/.test(a.reason)));

  await resetDb(db);
  await saveSettings(db, { providerBilling: { gemini: 'free' }, fxUsdInr: { rate: 84, source: 't' }, autopilotMode: 'suggest' });
  const s = await runAutopilot({ GEMINI_API_KEY: 'g', PRIMARY_ENGINE: 'gemini' }, db);
  assert.ok(s.actions.every((a) => a.status === 'proposed'));

  await resetDb(db);
  await saveSettings(db, { autopilotMode: 'off' });
  assert.equal((await runAutopilot({}, db)).actions.length, 0);

  await resetDb(db);
  await saveSettings(db, { providerBilling: { gemini: 'free' }, fxUsdInr: { rate: 84, source: 't' }, dispatchPaused: true });
  const p = await runAutopilot({ GEMINI_API_KEY: 'g', PRIMARY_ENGINE: 'gemini' }, db);
  assert.ok(p.actions.every((a) => a.status === 'proposed' && /paused/.test(a.reason)));
});

test('owner approves a proposal with one tap → goal starts; reject skips; a decided proposal cannot be reused', async () => {
  const r = await runAutopilot({}, db);
  const [a, b] = r.actions;
  const ok = await decideProposal(db, a.id, 'approve');
  assert.equal(ok.status, 'started');
  assert.ok(await db.prepare('SELECT 1 FROM workflows WHERE id = ?').bind(ok.workflowId).first());
  await assert.rejects(decideProposal(db, a.id, 'approve'), /already started/);
  assert.equal((await decideProposal(db, b.id, 'reject')).status, 'rejected');
  assert.equal(REGISTRY.agents.length, 31);
});

test('scheduled pass runs at most once a day', async () => {
  const first = await scheduledAutopilot({}, db);
  const second = await scheduledAutopilot({}, db);
  const hour = new Date().getUTCHours() * 60 + new Date().getUTCMinutes();
  if (hour >= 210) {
    assert.ok(first);
    assert.equal(second, null);
  } else assert.equal(first, null, 'before 09:00 IST nothing runs');
});

test('FX: public ECB rate fills in ₹ automatically; owner-set rate always wins; failures keep the last rate', async () => {
  const { maybeRefreshFx, getSettings, saveSettings: save } = await import('../finance.mjs');
  const ok = async () => new Response(JSON.stringify({ amount: 1, base: 'USD', date: '2026-10-14', rates: { INR: 95.16 } }), { status: 200 });
  const fx = await maybeRefreshFx(db, { fetch: ok });
  assert.equal(fx.rate, 95.16);
  assert.equal(fx.auto, true);
  assert.match(fx.source, /ECB reference rate via Frankfurter \(2026-10-14\)/);
  // Fresh auto rate is reused without another request.
  let calls = 0;
  await maybeRefreshFx(db, { fetch: async () => (calls++, ok()) });
  assert.equal(calls, 0);
  // Failure keeps the last known rate.
  await db.prepare("UPDATE studio_settings SET value_json = json_set(value_json, '$.at', '2026-01-01T00:00:00Z') WHERE key = 'fx_usd_inr'").run();
  assert.equal((await maybeRefreshFx(db, { fetch: async () => new Response('x', { status: 500 }) })).rate, 95.16);
  // Owner rate wins and is never overwritten.
  await save(db, { fxUsdInr: { rate: 90, source: 'my bank' } });
  await maybeRefreshFx(db, { fetch: ok });
  assert.equal((await getSettings(db)).fx_usd_inr.rate, 90);
});
