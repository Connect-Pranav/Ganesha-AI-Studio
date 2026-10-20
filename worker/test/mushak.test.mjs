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

test('owner command → Mushak replies like an employee with a blueprint → it runs by itself', async () => {
  const { send } = await import('../agentchat.mjs');
  n = 0;
  const reply = 'Ji Sir. Blueprint: Sunverse ke liye 5 indie artists dhoondhunga, research aur score karunga, aur best 2 ke liye drafts banaunga.\nBLUEPRINT: {"title":"Sunverse artist collabs","brand":"sunverse","campaign":{"new":{"name":"Indie artist collabs","objective":"creator_collaboration","audience":"Indie artists","geography":"India"}},"steps":[{"kind":"discover","count":5},{"kind":"research","count":2},{"kind":"qualify","count":2},{"kind":"draft","count":2}],"expected":"2 drafts for approval"}';
  const seen = [];
  const chatFetch = async (url, init) => {
    if (!/Growth Manager at Ganesha/.test(String(init?.body ?? ''))) return gemini(url, init);
    seen.push(String(init?.body ?? ''));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: reply }] }, finishReason: 'STOP' }] }), { status: 200 });
  };
  const r = await send(ENV, db, 'mushak_growth', { message: 'Sunverse ke liye collab artists dhoondo' }, { fetch: chatFetch, sleep: noSleep });
  assert.match(seen[0], /employee/, 'employee voice for Mushak');
  assert.doesNotMatch(seen[0], /deity/);
  assert.doesNotMatch(r.content, /BLUEPRINT:/, 'the machine line is hidden from the chat');
  assert.equal(r.blueprint.run.steps, 1 + 2 + 2 + 2);
  const camp = await db.prepare("SELECT * FROM growth_campaigns WHERE name = 'Indie artist collabs'").first();
  assert.equal(camp.status, 'active');
  let c = await ap.getCycle(db, r.blueprint.run.cycleId);
  assert.equal(c.inputs.commands[0].command, 'Sunverse ke liye collab artists dhoondo');
  while (c.status === 'running') c = await ap.advance(ENV, db, { deps: { fetch: gemini, sleep: noSleep } });
  assert.equal(c.outputs.leadsFound, 3, 'mock returns 3 leads per search');
  assert.equal(c.outputs.researched, 2);
  assert.equal(c.outputs.scored, 2);
  assert.equal(c.outputs.draftsForApproval.length, 2);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM growth_drafts WHERE status = 'pending_approval'").first()).n, 2, 'drafts wait for the owner');

  // A bad blueprint is reported, not run.
  const bad = 'Ok Sir.\nBLUEPRINT: {"title":"x","brand":"nts","campaign":{"new":{"name":"x","objective":"sponsorship"}},"steps":[{"kind":"discover","count":3}]}';
  const r2 = await send(ENV, db, 'mushak_growth', { message: 'nts ke liye' }, { fetch: async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: bad }] }, finishReason: 'STOP' }] }), { status: 200 }), sleep: noSleep });
  assert.match(r2.blueprint.error, /brand must be/);
});

test('SAARTHI can command Mushak: its MUSHAK line is delegated, Mushak blueprints and queues the run', async () => {
  const cbochat = await import('../cbochat.mjs');
  const raw = (text) => new Response(JSON.stringify({ id: 'i2', steps: [{ type: 'model_output', content: [{ type: 'text', text }] }], usage: { total_input_tokens: 5, total_output_tokens: 5 } }), { status: 200 });
  const bp = 'Ji Sir, blueprint ready.\nBLUEPRINT: {"title":"Kids brands","brand":"littleloop","campaign":{"new":{"name":"Kids brands via Saarthi","objective":"sponsorship"}},"steps":[{"kind":"discover","count":3}],"expected":"3 leads"}';
  const fetch = async (url, init) => {
    const body = String(init?.body ?? '');
    if (/SAARTHI \(technical id/.test(body)) return raw('Theek hai, Mushak ko bol diya.\nMUSHAK: LittleLoop ke liye 3 kids brands dhoondo');
    if (/Growth Manager at Ganesha/.test(body)) {
      assert.match(body, /Command from SAARTHI/);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: bp }] }, finishReason: 'STOP' }] }), { status: 200 });
    }
    return gemini(url, init);
  };
  const r = await cbochat.send(ENV, db, [], { message: 'LittleLoop ke liye sponsors chahiye' }, { fetch, sleep: noSleep });
  assert.doesNotMatch(r.content, /MUSHAK:/);
  assert.equal(r.delegation.command, 'LittleLoop ke liye 3 kids brands dhoondo');
  assert.equal(r.delegation.blueprint.run.steps, 1);
  assert.equal(r.action.type, 'mushak', 'stored on the Saarthi message for the chat UI');
  const hist = await cbochat.history(db);
  assert.equal(hist.at(-1).action.type, 'mushak');
  assert.equal((await db.prepare("SELECT status FROM growth_cycles").first()).status, 'running');
});
