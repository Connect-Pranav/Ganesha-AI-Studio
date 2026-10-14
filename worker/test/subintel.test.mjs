// Subscription Intelligence + subscription-aware CBO selection, on a real local D1 with MOCKED
// provider APIs. Proves classification, dedupe, precedence and arithmetic — not live account access.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDb, disposeDb, resetDb, noSleep, goodOutput, REGISTRY } from './helpers.mjs';
import * as si from '../subintel.mjs';
import { createWorkflow, tick, getTasks } from '../orchestrator.mjs';
import { saveSettings } from '../finance.mjs';
import { setTaskMeta } from '../cbo.mjs';
import worker from '../index.mjs';

let db;
before(async () => {
  db = await getDb();
});
after(disposeDb);
beforeEach(() => resetDb(db));
const byField = (view, record, field) => view.availability.find((a) => a.record === record && a.field === field);

test('availability model: nothing is invented on an empty account; unknown is not zero', async () => {
  for (const s of Object.keys(si.SERVICES)) {
    const v = await si.serviceView({}, db, s);
    const plan = byField(v, 'consumer_subscription', 'plan');
    assert.equal(plan.status, 'UNAVAILABLE');
    assert.equal(plan.value, null);
    assert.match(plan.source, /API|Import|import/);
    assert.equal(byField(v, 'subscription_usage', 'current_usage').status, 'UNAVAILABLE');
    assert.equal(byField(v, 'subscription_usage', 'current_usage').value, null);
    assert.equal(byField(v, 'api_quota', 'remaining_credit').status, 'UNAVAILABLE');
    assert.ok(v.availability.every((a) => si.STATUSES.includes(a.status)));
  }
  const c = await si.serviceView({}, db, 'claude');
  assert.equal(byField(c, 'api_billing', 'month_to_date').status, 'NEEDS_AUTHORIZATION');
  assert.equal(byField(c, 'api_billing', 'month_to_date').value, null, 'unknown API spend is null, not 0');
  assert.equal(byField(c, 'ganesha_usage', 'month_calls').status, 'CALCULATED');
  assert.equal(byField(c, 'ganesha_usage', 'month_calls').value, 0, 'GANESHA sees all of its own calls: verified zero');
  const g = await si.serviceView({}, db, 'google_ai_pro');
  assert.equal(byField(g, 'api_billing', 'month_to_date').status, 'UNAVAILABLE');
  assert.equal(byField(g, 'external_usage', 'outside_ganesha').status, 'UNAVAILABLE');
});

test('profile import: source required, card numbers rejected, account masked, renewal math, CFO row synced', async () => {
  await assert.rejects(si.saveProfile(db, 'claude', { fields: { plan: 'Max' } }), /source is required/);
  await assert.rejects(si.saveProfile(db, 'claude', { source: 'r', fields: { payment_method: 'card 4111 1111 1111 1111' } }), /card or account number/);
  await assert.rejects(si.saveProfile(db, 'claude', { source: 'r', fields: { next_renewal: '14/10/2026' } }), /YYYY-MM-DD/);
  await si.saveProfile(db, 'claude', { source: 'claude.ai receipt 2026-10-02', fields: { plan: 'Pro', status: 'active', account_ref: 'owner@example.com', payment_method: 'card •••• 4242', billing_period: 'monthly', amount: 1950, currency: 'INR', next_renewal: '2026-10-02', first_observed: '2026-01-02' } });
  const v = await si.serviceView({}, db, 'claude');
  assert.equal(v.profile.plan.status, 'IMPORTED');
  assert.equal(v.profile.account_ref.value, 'ow***@example.com');
  assert.equal(v.period.age.basis, 'first observed (true start unknown)');
  assert.ok(v.period.nextRenewal > '2026-10-02', 'past renewal rolled forward by whole periods');
  assert.equal(v.period.effectiveMonthly, 1950);
  const row = await db.prepare("SELECT * FROM subscriptions WHERE id = 'sub_claude'").first();
  assert.equal(row.amount_inr, 1950);
  assert.equal(row.provider, 'claude');
});

test('renewal + forecast arithmetic', () => {
  const p = si.periodMath({ billing_period: 'yearly', next_renewal: '2027-01-15', amount: 19500, start_date: '2026-01-15' }, '2026-10-14');
  assert.equal(p.daysUntilRenewal, 93);
  assert.equal(p.periodStart, '2026-01-15');
  assert.equal(p.periodDays, 365);
  assert.equal(p.effectiveMonthly, 1625);
  assert.equal(p.age.days, 272);
  assert.equal(si.forecastToRenewal({ consumedSoFar: 10, daysElapsed: 2, daysRemaining: 5 }), null, 'needs ≥ 3 observed days');
  const f = si.forecastToRenewal({ consumedSoFar: 30, daysElapsed: 3, daysRemaining: 7, limit: 90 });
  assert.equal(f.projectedTotal, 100);
  assert.equal(f.exceedsLimit, true);
  assert.equal(f.status, 'ESTIMATED');
  // Month-end clamp: Jan 31 + 1 month → Feb 28.
  assert.equal(si.periodMath({ billing_period: 'monthly', next_renewal: '2027-01-31' }, '2027-01-31').periodStart, '2026-12-31');
});

test('billing import: CSV parsed, duplicates skipped on re-import, bad rows rejected', async () => {
  const csv = 'date,amount,currency,description,invoice\n2026-09-02,"1,950",INR,Claude Pro,INV-1\n2026-10-02,1950,INR,Claude Pro,INV-2\n,10,INR,bad,\n';
  const a = await si.importRecords(db, 'claude', { kind: 'billing', csv, source: 'receipts.csv' });
  assert.equal(a.inserted, 2);
  assert.equal(a.rejected.length, 1);
  const b = await si.importRecords(db, 'claude', { kind: 'billing', csv, source: 'receipts.csv again' });
  assert.equal(b.inserted, 0);
  assert.equal(b.skipped, 2);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM billing_records').first()).n, 2);
  const v = await si.serviceView({}, db, 'claude');
  assert.equal(v.spend.subscription.inr, 3900);
  assert.equal(v.spend.subscription.status, 'IMPORTED');
  await assert.rejects(si.importRecords(db, 'claude', { kind: 'billing', csv }), /source is required/);
});

test('usage import + LIVE precedence: provider data replaces imports; imports never overwrite LIVE', async () => {
  const r1 = await si.importRecords(db, 'claude', { kind: 'usage', record: 'api_usage', source: 'export.csv', rows: [{ day: '2026-10-10', model: 'claude-sonnet-5-5', unit: 'input_tokens', consumed: 900 }] });
  assert.equal(r1.inserted, 1);
  assert.equal(await si.upsertUsage(db, { service: 'claude', record: 'api_usage', day: '2026-10-10', model: 'claude-sonnet-5-5', unit: 'input_tokens', consumed: 1000, status: 'LIVE', source: 'api' }), 'updated');
  const r2 = await si.importRecords(db, 'claude', { kind: 'usage', record: 'api_usage', source: 'export.csv', rows: [{ day: '2026-10-10', model: 'claude-sonnet-5-5', unit: 'input_tokens', consumed: 900 }] });
  assert.equal(r2.skipped, 1);
  const row = await db.prepare('SELECT consumed, status FROM usage_ledger').first();
  assert.deepEqual({ ...row }, { consumed: 1000, status: 'LIVE' });
  // Subscription usage uses the provider's own unit (no invented tokens).
  await si.importRecords(db, 'chatgpt', { kind: 'usage', source: 'manual note from ChatGPT', rows: [{ window_start: '2026-10-14', unit: 'messages', consumed: 12, limit: 160, reset_at: '2026-10-14T18:00:00Z' }] });
  const v = await si.serviceView({}, db, 'chatgpt');
  assert.equal(byField(v, 'subscription_usage', 'current_usage').status, 'IMPORTED');
  assert.equal(byField(v, 'subscription_usage', 'current_usage').unit, 'messages');
  assert.equal(byField(v, 'subscription_usage', 'reset_at').value, '2026-10-14T18:00:00Z');
});

function anthropicAdminFetch() {
  const today = new Date().toISOString().slice(0, 10);
  const calls = [];
  const fn = async (url, init) => {
    calls.push(url);
    assert.equal(init.headers['x-api-key'], 'sk-ant-admin01-SECRET');
    if (url.includes('/usage_report/messages'))
      return new Response(JSON.stringify({ data: [{ starting_at: `${today}T00:00:00Z`, ending_at: 'x', results: [{ model: 'claude-sonnet-5-5', uncached_input_tokens: 1000, cache_read_input_tokens: 200, cache_creation: { ephemeral_5m_input_tokens: 50 }, output_tokens: 400 }] }], has_more: false }));
    if (url.includes('/cost_report')) return new Response(JSON.stringify({ data: [{ starting_at: `${today}T00:00:00Z`, results: [{ amount: '123.5', currency: 'USD', description: 'Claude Sonnet 5.5 usage' }] }], has_more: false }));
    return new Response('nope', { status: 404 });
  };
  fn.calls = calls;
  return fn;
}

test('Anthropic Admin adapter (mocked): LIVE usage + cost; cents → USD; account vs GANESHA kept apart; imported invoice not double counted', async () => {
  await saveSettings(db, { fxUsdInr: { rate: 84, source: 'test fixture' } });
  const today = new Date().toISOString();
  await db.prepare("INSERT INTO provider_calls (id, provider, model, purpose, status, http_status, input_tokens, output_tokens, latency_ms, created_at) VALUES ('pc1','claude','claude-sonnet-5-5','task','success',200,250,100,10,?)").bind(today).run();
  // An imported API invoice for this month that the live cost rows also cover.
  await si.importRecords(db, 'claude', { kind: 'billing', record: 'api_billing', source: 'console invoice.csv', rows: [{ date: today.slice(0, 10), amount: 1.23, currency: 'USD', description: 'Monthly API invoice' }] });
  const env = { ANTHROPIC_ADMIN_KEY: 'sk-ant-admin01-SECRET' };
  const r = await si.syncAnthropic(env, db, { fetch: anthropicAdminFetch() });
  assert.equal(r.status, 'ok');
  const usage = (await db.prepare("SELECT unit, consumed, status FROM usage_ledger WHERE service = 'claude' ORDER BY unit").all()).results;
  assert.deepEqual(usage.map((u) => [u.unit, u.consumed, u.status]), [['input_tokens', 1250, 'LIVE'], ['output_tokens', 400, 'LIVE']]);
  const v = await si.serviceView(env, db, 'claude');
  assert.ok(Math.abs(v.spend.apiMonth.usd - 1.235) < 1e-9, 'live cost only (cents → USD); imported invoice superseded');
  assert.ok(v.billing.some((b) => b.superseded));
  assert.equal(v.spend.apiMonth.status, 'LIVE');
  assert.equal(v.external.status, 'CALCULATED');
  assert.equal(v.external.inputTokens, 1000, 'outside GANESHA = 1250 account − 250 GANESHA');
  assert.equal(v.spend.ganeshaMonth.status, 'CALCULATED');
  // Second sync: no duplicates.
  await si.syncAnthropic(env, db, { fetch: anthropicAdminFetch() });
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM billing_records WHERE status = 'LIVE'").first()).n, 1);
});

test('Admin adapters: missing key → NEEDS_AUTHORIZATION; rejected key → never leaks the key; OpenAI pagination', async () => {
  assert.equal((await si.syncAnthropic({}, db)).status, 'needs_authorization');
  assert.equal((await si.syncOpenAI({}, db)).status, 'needs_authorization');
  const bad = await si.syncAnthropic({ ANTHROPIC_ADMIN_KEY: 'sk-ant-admin01-SECRET' }, db, { fetch: async () => new Response('invalid key sk-ant-admin01-SECRET', { status: 401 }) });
  assert.equal(bad.status, 'needs_authorization');
  assert.ok(!bad.error.includes('sk-ant-admin01-SECRET'));
  const runs = JSON.stringify((await db.prepare('SELECT * FROM sync_runs').all()).results);
  assert.ok(!runs.includes('sk-ant-admin01-SECRET'));

  const t0 = Math.floor(Date.now() / 1000) - 86400;
  let n = 0;
  const fetch = async (url) => {
    n++;
    if (url.includes('/usage/completions'))
      return url.includes('page=p2')
        ? new Response(JSON.stringify({ data: [{ start_time: t0 + 86400, results: [{ model: 'gpt-x', input_tokens: 5, output_tokens: 6, num_model_requests: 1 }] }], has_more: false }))
        : new Response(JSON.stringify({ data: [{ start_time: t0, results: [{ model: 'gpt-x', input_tokens: 10, output_tokens: 20, num_model_requests: 2 }] }], has_more: true, next_page: 'p2' }));
    return new Response(JSON.stringify({ data: [{ start_time: t0, results: [{ amount: { value: 0.42, currency: 'usd' }, line_item: 'gpt-x, input' }] }], has_more: false }));
  };
  const ok = await si.syncOpenAI({ OPENAI_ADMIN_KEY: 'k' }, db, { fetch });
  assert.equal(ok.status, 'ok');
  assert.equal(n, 3);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM usage_ledger WHERE service = 'chatgpt' AND unit = 'requests'").first()).n, 2);
  const v = await si.serviceView({ OPENAI_ADMIN_KEY: 'k' }, db, 'chatgpt');
  assert.equal(byField(v, 'consumer_subscription', 'plan').status, 'UNAVAILABLE', 'API data never fills ChatGPT plan fields');
});

test('daily ledger keeps provider rows and GANESHA rows separate; overview totals flag partial data', async () => {
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO provider_calls (id, provider, model, purpose, status, input_tokens, output_tokens, latency_ms, created_at) VALUES ('p','gemini','gemini-3.8-flash','task','success',10,5,1,?)").bind(now).run();
  await si.importRecords(db, 'google_ai_pro', { kind: 'usage', source: 'note', rows: [{ day: now.slice(0, 10), unit: 'prompts', consumed: 4, feature: 'Deep Research' }] });
  const d = await si.dailyLedger(db);
  assert.equal(d.provider.length, 1);
  assert.equal(d.ganesha.length, 1);
  const o = await si.overview({}, db);
  assert.equal(o.services.length, 4);
  assert.equal(o.totals.subscriptionsMonthly.partial, true, 'no plan amounts imported → partial, not zero-complete');
  assert.equal(o.totals.subscriptionsMonthly.inr, null, 'nothing verified → unknown, not ₹0');
  assert.equal(o.totals.aiTotalMonth.inr, null);
  await si.saveProfile(db, 'canva', { source: 'Canva invoice', fields: { amount: 500, currency: 'INR', billing_period: 'monthly', next_renewal: new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10) } });
  const o2 = await si.overview({}, db);
  assert.ok(o2.alerts.some((a) => /Canva renews in 3 day/.test(a.message)));
});

/* ---------------- CBO selection ---------------- */
function multiFetch(log) {
  return async (url, init) => {
    const body = JSON.parse(init.body);
    const isGemini = url.includes('generativelanguage');
    log.push(isGemini ? 'gemini' : 'claude');
    const sys = isGemini ? body.systemInstruction.parts[0].text : body.system;
    const agentId = /\(([a-z0-9_]+)\)/.exec(sys)?.[1];
    const text = JSON.stringify(goodOutput(agentId));
    return isGemini
      ? new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }), { status: 200 })
      : new Response(JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200 });
  };
}
const BOTH = { ANTHROPIC_API_KEY: 'a', ANTHROPIC_MODEL: 'claude-sonnet-5-5', GEMINI_API_KEY: 'g', MAX_CONCURRENT_TASKS: '1', ALLOW_PROVIDER_FALLBACK: 'true' };

test('CBO picks the cheapest allowed engine, records why, and the call really goes there', async () => {
  await saveSettings(db, { fxUsdInr: { rate: 84, source: 't' }, providerBilling: { gemini: 'free' } });
  const log = [];
  const wf = await createWorkflow(db, { template: 'research_brief', title: 'x' });
  await tick(BOTH, db, { fetch: multiFetch(log), sleep: noSleep });
  assert.equal(log[0], 'gemini');
  const d = await db.prepare('SELECT * FROM dispatch_decisions').first();
  assert.equal(d.chosen_provider, 'gemini');
  assert.match(d.reason, /lowest conservative cost/);
  assert.match(d.reason, /Consumer subscriptions are not callable/);
  assert.equal(JSON.parse(d.candidates_json).length, 2);
  assert.equal((await getTasks(db, wf.id)).find((t) => t.step_key === 'research').provider, 'gemini');
});

test('CBO: urgent task avoids a rate-limited free engine; owner override wins; missing keys are explained', async () => {
  await saveSettings(db, { fxUsdInr: { rate: 84, source: 't' }, providerBilling: { gemini: 'free' } });
  await db.prepare("INSERT INTO provider_calls (id, provider, model, purpose, status, http_status, latency_ms, created_at) VALUES ('r1','gemini','gemini-3.8-flash','task','error',429,1,?)").bind(new Date().toISOString()).run();
  const wf = await createWorkflow(db, { template: 'research_brief', title: 'urgent' });
  const research = (await getTasks(db, wf.id)).find((t) => t.step_key === 'research');
  await setTaskMeta(db, research.id, { priority: 'urgent' });
  const log = [];
  await tick(BOTH, db, { fetch: multiFetch(log), sleep: noSleep });
  assert.equal(log[0], 'claude');
  assert.match((await db.prepare('SELECT reason FROM dispatch_decisions').first()).reason, /rate-limited engines were avoided/);

  await resetDb(db);
  await db.prepare("INSERT INTO agent_settings (agent_id, engines, updated_at) VALUES ('narada_market_intelligence', '[\"claude\"]', '2026-10-14T00:00:00Z')").run();
  await saveSettings(db, { providerBilling: { gemini: 'free' } });
  await createWorkflow(db, { template: 'research_brief', title: 'override' });
  const log2 = [];
  await tick({ ...BOTH, ALLOW_PROVIDER_FALLBACK: 'false' }, db, { fetch: multiFetch(log2), sleep: noSleep });
  assert.equal(log2[0], 'claude');
  assert.match((await db.prepare('SELECT reason FROM dispatch_decisions').first()).reason, /Owner engine override/);

  await resetDb(db);
  await createWorkflow(db, { template: 'research_brief', title: 'nokeys' });
  await tick({ MAX_CONCURRENT_TASKS: '1' }, db, { fetch: multiFetch([]), sleep: noSleep });
  assert.match((await db.prepare('SELECT reason FROM dispatch_decisions').first()).reason, /No eligible engine/);
  assert.equal(REGISTRY.agents.length, 31);
});

test('http: subscription endpoints are owner-only, validate, and never echo secrets', async () => {
  const assets = { fetch: async () => new Response('ok') };
  const ctx = { waitUntil: (p) => p.catch(() => {}) };
  const env = { DB: db, ASSETS: assets, ADMIN_TOKEN: 't', ANTHROPIC_ADMIN_KEY: 'sk-ant-admin01-SECRET', OPENAI_ADMIN_KEY: 'oa-admin-SECRET' };
  const H = { authorization: 'Bearer t', 'content-type': 'application/json' };
  const req = (p, i = {}) => new Request(`https://g.test${p}`, i);
  assert.equal((await worker.fetch(req('/api/subintel'), env, ctx)).status, 401);
  const o = await (await worker.fetch(req('/api/subintel', { headers: H }), env, ctx)).json();
  assert.equal(o.services.length, 4);
  assert.equal(/SECRET/.test(JSON.stringify(o)), false);
  assert.equal((await worker.fetch(req('/api/subintel/nope', { headers: H }), env, ctx)).status, 404);
  assert.equal((await worker.fetch(req('/api/subintel/claude/profile', { method: 'PUT', headers: H, body: JSON.stringify({ fields: { plan: 'Pro' } }) }), env, ctx)).status, 400);
  const imp = await worker.fetch(req('/api/subintel/canva/import', { method: 'POST', headers: H, body: JSON.stringify({ kind: 'billing', source: 'canva.csv', csv: 'date,amount,currency\n2026-10-01,499,INR\n' }) }), env, ctx);
  assert.equal((await imp.json()).inserted, 1);
  const rep = await (await worker.fetch(req('/api/cbo/report', { headers: H }), env, ctx)).json();
  assert.equal(rep.subscriptions.services.length, 4);
});
