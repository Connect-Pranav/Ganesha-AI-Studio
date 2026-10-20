// MUSHAK autopilot on a real local D1; Gemini (search-grounded + generateContent) is MOCKED.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getBindings, disposeDb, resetDb, noSleep } from './helpers.mjs';
import * as ap from '../growth/autopilot.mjs';
import * as core from '../growth/core.mjs';

let db;
before(async () => ({ DB: db } = await getBindings()));
after(disposeDb);
beforeEach(() => resetDb(db));
const ENV = { GEMINI_API_KEY: 'g-key' };

let n = 0;
const interaction = (obj, urls) => new Response(JSON.stringify({ id: 'i', steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify(obj), annotations: urls.map((u) => ({ url: u, title: u })) }] }], usage: { total_input_tokens: 100, total_output_tokens: 40 } }), { status: 200 });
const generate = (obj) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }), { status: 200 });
// One fake Gemini that answers discover / research / qualify / draft by looking at the prompt.
const gemini = async (url, init) => {
  const body = String(init?.body ?? '');
  if (/interactions/.test(url)) {
    if (/Lead Hunter/.test(body)) {
      n++;
      const leads = [1, 2, 3].map((i) => ({ name: `Partner ${n}-${i}`, orgType: 'company', website: `https://p${n}-${i}.example`, category: 'kids brands', whyFit: 'fits', sources: [{ url: `https://p${n}-${i}.example/about` }] }));
      return interaction({ leads }, leads.map((l) => l.sources[0].url));
    }
    return interaction({ summary: 'A family brand', facts: [{ fact: 'Sells toddler toys', sourceUrl: 'https://src.example' }], hypotheses: [], decisionMakerRoles: [{ role: 'Partnerships lead', sourceUrl: 'https://src.example' }], publicBusinessEmail: 'hello@p.example', suitability: { ok: true, concerns: [] } }, ['https://src.example']);
  }
  if (/Lead Qualification/.test(body))
    return generate({ components: { fit: { score: 28, evidence: 'toys' }, need: { score: 20, evidence: 'x' }, commercial: { score: 15, evidence: 'x' }, access: { score: 10, evidence: 'x' }, evidence: { score: 8, evidence: 'x' } }, missing: [], nextAction: 'Draft', confidence: 'medium' });
  return generate({ subject: 'Hello', body: 'Hi team, a short collaboration idea from LittleLoop for your toddler toys. Open to a chat?', personalization: 'toys' });
};

test('autopilot: opens starter campaigns, plans with reasons, runs steps a few per tick, records inputs/plan/outputs', async () => {
  n = 0;
  const s = await ap.getSettings(db);
  assert.equal(s.autopilot, true, 'on by default');
  assert.equal(s.everyHours, 4);

  // Cycle 1: no campaigns → Mushak opens one per brand and plans discovery.
  const c1 = await ap.scheduledMushak(ENV, db, { fetch: gemini, sleep: noSleep });
  assert.equal(c1.inputs.openedCampaigns.length, 3);
  assert.equal((await core.listCampaigns(db)).filter((c) => c.status === 'active').length, 3);
  assert.ok(c1.plan.every((p) => p.kind === 'discover' && p.why));
  let c = c1;
  while (c.status === 'running') c = await ap.advance(ENV, db, { deps: { fetch: gemini, sleep: noSleep } });
  assert.equal(c.status, 'done');
  assert.equal(c.outputs.leadsFound, 9);
  assert.match(c.summary, /found 9 lead/);
  assert.ok(c.plan[0].result.leads[0].sources.length > 0, 'outputs keep sources');

  // Not due again yet.
  assert.equal(await ap.scheduledMushak(ENV, db, { fetch: gemini }), null);

  // Cycle 2 (manual): pipeline first — research the new leads.
  await ap.saveSettings(db, { maxSteps: 4 });
  let m = await ap.startCycle(ENV, db, 'manual');
  assert.ok(m.plan.every((p) => p.kind === 'research'));
  while (m.status === 'running') m = await ap.advance(ENV, db, { deps: { fetch: gemini, sleep: noSleep } });
  assert.equal(m.outputs.researched, 4);

  // Cycle 3: those are scored, then drafted (qualify comes first in the plan).
  await ap.saveSettings(db, { maxSteps: 30 });
  let k = await ap.startCycle(ENV, db, 'manual');
  assert.equal(k.plan[0].kind, 'qualify');
  while (k.status === 'running') k = await ap.advance(ENV, db, { deps: { fetch: gemini, sleep: noSleep } });
  assert.ok(k.outputs.scored >= 4);
  // Nothing is ever sent by Mushak.
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM growth_drafts WHERE status IN ('approved','sent')").first()).n, 0);

  const list = await ap.listCycles(db);
  assert.equal(list.cycles.length, 3);
  assert.ok(list.nextRunAt);
});

test('autopilot: owner campaigns are respected, off switch stops new cycles, no Gemini → skipped with a reason', async () => {
  await core.createCampaign(db, { brand: 'littleloop', name: 'Mine', objective: 'licensing' });
  const sk = await ap.startCycle({}, db, 'manual');
  assert.equal(sk.status, 'skipped');
  assert.match(sk.error, /GEMINI_API_KEY/);
  const c = await ap.startCycle(ENV, db, 'manual');
  assert.deepEqual(c.inputs.openedCampaigns.map((x) => x.brand).sort(), ['foliocraft', 'sunverse'], 'brand with an owner campaign is left alone');
  await assert.rejects(ap.startCycle(ENV, db, 'manual'), /already running/);
  await db.prepare("UPDATE growth_cycles SET status = 'done'").run();
  await ap.saveSettings(db, { autopilot: false });
  assert.equal(await ap.scheduledMushak(ENV, db), null);
  await assert.rejects(ap.saveSettings(db, { everyHours: 0 }), /1–24/);
});
