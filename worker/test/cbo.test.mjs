// GANESHA_CBO / CFO / voice / production tests on a real local D1 with MOCKED providers.
// They prove the control logic (estimates, budgets, reservations, approvals, voices, continuity),
// not live provider connectivity or real prices on any given day.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDb, disposeDb, resetDb, ENV, noSleep, fakeAnthropic, REGISTRY } from './helpers.mjs';
import { createWorkflow, tick, getTasks, getWorkflow, decideApproval } from '../orchestrator.mjs';
import { computeEstimate, reserveBudget, lifecycleOf, reassignTask, planGoal, financeSummary, listTasks } from '../cbo.mjs';
import { saveSettings, upsertBudget, priceFor, getSettings, addSubscription } from '../finance.mjs';
import { VOICE_PROFILES, recommendVoices, assignVoice, listVoices, synthesize, updateVoiceSetting } from '../voices.mjs';
import * as prod from '../production.mjs';
import { runCommand } from '../commands.mjs';
import { listConnections, testOpenAI } from '../connections.mjs';
import worker from '../index.mjs';

let db;
before(async () => {
  db = await getDb();
});
after(disposeDb);
beforeEach(() => resetDb(db));

async function drain(env, deps, max = 30) {
  for (let i = 0; i < max; i++) {
    const r = await tick(env, db, deps);
    if (!r.ran.length && !r.reclaimed) return r;
  }
}
const FX = { fxUsdInr: { rate: 84, source: 'test fixture' } };
const assets = { fetch: async () => new Response('ok') };
const ctx = { waitUntil: (p) => p.catch(() => {}) };
const req = (path, init = {}) => new Request(`https://ganesha.test${path}`, init);

const ORIGINAL_IDS = ['ganesha_orchestrator', 'narada_market_intelligence', 'chitragupta_quality_audit', 'samvada_handoffs', 'sunverse_tumburu_music_director', 'sunverse_vagdevi_lyricist', 'sunverse_saraswati_vocal_director', 'sunverse_vishvavasu_sound_engineer', 'sunverse_gandharva_trend_analyst', 'sunverse_vishvakarma_video_producer', 'sunverse_surya_release_manager', 'sunverse_nata_visual_designer', 'littleloop_krishna_story_director', 'littleloop_vyasa_scriptwriter', 'littleloop_drishti_visual_planner', 'littleloop_maya_prompt_engineer', 'littleloop_chitra_character_designer', 'littleloop_nataraja_edit_director', 'littleloop_nada_sound_director', 'littleloop_lakshmi_growth_analyst', 'foliocraft_brahma_product_architect', 'foliocraft_nirnaya_strategy_analyst', 'foliocraft_sutradhara_ux_architect', 'code_shakti', 'foliocraft_kubera_monetisation', 'ops_agni_automation', 'ops_soma_analytics', 'ops_hanuman_recovery', 'ops_dharma_safety', 'ops_maya_docs', 'ops_lakshmi_growth'];

test('preservation: exactly the 31 original agents, same ids, same order', () => {
  assert.deepEqual(REGISTRY.agents.map((a) => a.id), ORIGINAL_IDS);
});

/* ---------------- CFO arithmetic ---------------- */
test('estimate: verified seeded price, direct vs conservative, INR only with an FX rate', async () => {
  const price = await priceFor(db, 'claude', 'claude-sonnet-5-5', '2026-10-14');
  assert.equal(price.input, 2);
  assert.equal(price.output, 10);
  assert.match(price.source, /platform\.claude\.com/);
  const history = { samples: 0, avgOut: null, maxOut: null, avgAttempts: null };
  const e = computeEstimate({ provider: 'claude', model: 'claude-sonnet-5-5', inputTokens: 1000, outputTokens: 1000, history, remainingAttempts: 3, price, tier: 'paid', fx: null, maxOutputCap: 8000 });
  assert.equal(e.directUsd, 0.012); // 1000*2/1e6 + 1000*10/1e6
  assert.equal(e.conservativeUsd, (3 * 1000 * 2 + 3 * 2000 * 10) / 1e6);
  assert.equal(e.directInr, null, 'no FX rate → no INR, never guessed');
  assert.equal(e.confidence, 'low');
  const e2 = computeEstimate({ provider: 'gemini', model: 'gemini-3.8-flash', inputTokens: 1000, outputTokens: 1000, history, remainingAttempts: 3, price: await priceFor(db, 'gemini', 'gemini-3.8-flash', '2026-10-14'), tier: 'free', fx: { rate: 84 } });
  assert.equal(e2.directUsd, 0);
  assert.equal(e2.basis, 'free_tier');
  // Dated price change is honoured.
  assert.equal((await priceFor(db, 'gemini', 'gemini-3.8-flash', '2027-01-02')).input, 1.5);
  assert.equal(await priceFor(db, 'openai', 'anything'), null);
});

test('dispatch: every task gets a preflight estimate and actual cost is reconciled into the ledger', async () => {
  await saveSettings(db, FX);
  const fetch = fakeAnthropic(); // 120 in / 80 out tokens per call
  const wf = await createWorkflow(db, { template: 'research_brief', title: 'Kids music trends' });
  await drain(ENV, { fetch, sleep: noSleep });
  assert.equal((await getWorkflow(db, wf.id)).status, 'completed');
  const est = await db.prepare('SELECT COUNT(*) AS n FROM cost_estimates WHERE workflow_id = ?').bind(wf.id).first();
  assert.equal(est.n, 3);
  // claude-test has no verified price → actual is recorded with tokens but unknown cost.
  const l1 = await db.prepare('SELECT SUM(input_tokens) AS i, SUM(amount_usd) AS usd, MIN(basis) AS b FROM cost_ledger WHERE workflow_id = ?').bind(wf.id).first();
  assert.equal(l1.i, 360);
  assert.equal(l1.usd, null);
  assert.equal(l1.b, 'no_price');

  // With a verified model the cost is exact arithmetic: (120*2 + 80*10)/1e6 USD per call.
  const env = { ...ENV, ANTHROPIC_MODEL: 'claude-sonnet-5-5' };
  const wf2 = await createWorkflow(db, { template: 'research_brief', title: 'Second' });
  await drain(env, { fetch, sleep: noSleep });
  const l2 = await db.prepare('SELECT SUM(amount_usd) AS usd, SUM(amount_inr) AS inr FROM cost_ledger WHERE workflow_id = ?').bind(wf2.id).first();
  assert.ok(Math.abs(l2.usd - 3 * 0.00104) < 1e-12);
  assert.ok(Math.abs(l2.inr - 3 * 0.00104 * 84) < 1e-6);
  const r = await db.prepare("SELECT COUNT(*) AS n FROM budget_reservations WHERE status = 'active'").first();
  assert.equal(r.n, 0, 'no reservation left open');
  const tasks = await listTasks(db);
  assert.ok(tasks.filter((t) => t.workflowId === wf2.id).every((t) => t.state === 'COMPLETED' && t.estimate && t.actual));
});

test('budget: over-budget task is held for approval before any provider call; approve runs it once', async () => {
  await saveSettings(db, FX);
  await upsertBudget(db, { scope: 'monthly_total', limitInr: 0.0001 });
  const fetch = fakeAnthropic();
  const env = { ...ENV, ANTHROPIC_MODEL: 'claude-sonnet-5-5' };
  const wf = await createWorkflow(db, { template: 'research_brief', title: 'Over budget' });
  const r = await tick(env, db, { fetch, sleep: noSleep });
  assert.equal(r.ran.length, 0);
  assert.equal(fetch.calls.length, 0, 'nothing charged');
  assert.equal((await getWorkflow(db, wf.id)).status, 'waiting_for_approval');
  const ap = await db.prepare("SELECT * FROM approvals WHERE status = 'pending'").first();
  assert.match(ap.action, /^budget:research$/);
  assert.match(ap.summary, /Budget would be exceeded/);
  await decideApproval(db, ap.id, 'approved');
  const r2 = await tick(env, db, { fetch, sleep: noSleep });
  assert.equal(r2.ran.length, 1);
  assert.equal(fetch.calls.length, 1);
  // The override was used once: the next step is held again.
  await tick(env, db, { fetch, sleep: noSleep });
  assert.equal(fetch.calls.length, 1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM approvals WHERE status = 'pending' AND action LIKE 'budget:%'").first()).n, 1);
});

test('budget: reject a budget hold cancels the goal', async () => {
  await saveSettings(db, FX);
  await upsertBudget(db, { scope: 'task', limitInr: 0 });
  const wf = await createWorkflow(db, { template: 'research_brief', title: 'x' });
  await tick({ ...ENV, ANTHROPIC_MODEL: 'claude-sonnet-5-5' }, db, { fetch: fakeAnthropic(), sleep: noSleep });
  const ap = await db.prepare("SELECT * FROM approvals WHERE status = 'pending'").first();
  assert.equal(await decideApproval(db, ap.id, 'rejected'), 'cancelled');
  assert.equal((await getWorkflow(db, wf.id)).status, 'cancelled');
});

test('reservation ledger: concurrent reservations cannot spend the same budget', async () => {
  await upsertBudget(db, { scope: 'monthly_total', limitInr: 1 });
  const wf = await createWorkflow(db, { template: 'research_brief', title: 'x' });
  const res = await Promise.all(Array.from({ length: 5 }, (_, i) => reserveBudget(db, { taskId: `t${i}`, workflowId: wf.id, provider: 'claude', amountInr: 0.6 })));
  assert.equal(res.filter(Boolean).length, 1, 'exactly one 0.6 reservation fits in ₹1');
  // Project + provider budgets are enforced too.
  await upsertBudget(db, { scope: 'provider', scopeRef: 'gemini', limitInr: 0.1 });
  assert.equal(await reserveBudget(db, { taskId: 'g', workflowId: wf.id, provider: 'gemini', amountInr: 0.2 }), null);
  // Subscriptions count against the monthly total.
  await addSubscription(db, { name: 'Plan', provider: 'x', amount: 0.3, currency: 'INR' });
  assert.equal(await reserveBudget(db, { taskId: 'z', workflowId: wf.id, provider: 'claude', amountInr: 0.2 }), null);
});

test('unknown cost with an active budget requires approval; global pause stops dispatch', async () => {
  await upsertBudget(db, { scope: 'monthly_total', limitInr: 1000 }); // no FX rate → INR unknown
  const fetch = fakeAnthropic();
  await createWorkflow(db, { template: 'research_brief', title: 'x' });
  await tick({ ...ENV, ANTHROPIC_MODEL: 'claude-sonnet-5-5' }, db, { fetch, sleep: noSleep });
  assert.equal(fetch.calls.length, 0);
  assert.match((await db.prepare('SELECT summary FROM approvals').first()).summary, /no USD→INR rate/);

  await resetDb(db);
  await saveSettings(db, { dispatchPaused: true });
  const wf = await createWorkflow(db, { template: 'research_brief', title: 'y' });
  const r = await tick(ENV, db, { fetch, sleep: noSleep });
  assert.equal(r.ran.length, 0);
  assert.ok(r.held[0].endsWith('dispatch_paused'));
  const t = (await listTasks(db)).find((x) => x.workflowId === wf.id && x.stepKey === 'research');
  assert.equal(t.state, 'BLOCKED');
});

test('approval threshold: a conservative estimate above it is held', async () => {
  await saveSettings(db, { ...FX, taskApprovalInr: 0 });
  const fetch = fakeAnthropic();
  await createWorkflow(db, { template: 'research_brief', title: 'x' });
  await tick({ ...ENV, ANTHROPIC_MODEL: 'claude-sonnet-5-5' }, db, { fetch, sleep: noSleep });
  assert.equal(fetch.calls.length, 0);
  assert.match((await db.prepare('SELECT summary FROM approvals').first()).summary, /approval threshold/);
});

test('plan: DRAFT estimate for N goals writes nothing', async () => {
  const p = await planGoal(ENV, db, { template: 'littleloop_episode', title: 'Five reels', count: 5 });
  assert.equal(p.state, 'DRAFT');
  assert.equal(p.count, 5);
  assert.ok(p.steps.every((s) => s.state === 'DRAFT' && s.estimate.assumptions.length));
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM workflows').first()).n, 0);
  assert.equal(p.budgetCheck.ok, null);
});

/* ---------------- operations ---------------- */
test('lifecycle mapping and reassignment rules', async () => {
  const s = new Map([['a', 'completed'], ['b', 'failed'], ['c', 'running']]);
  assert.equal(lifecycleOf({ status: 'queued', depends_on: ['a'] }, s, 'running', false).state, 'READY');
  assert.equal(lifecycleOf({ status: 'queued', depends_on: ['c'] }, s, 'running', false).state, 'ASSIGNED');
  assert.equal(lifecycleOf({ status: 'queued', depends_on: ['b'] }, s, 'running', false).state, 'BLOCKED');
  assert.equal(lifecycleOf({ status: 'queued', depends_on: ['a'] }, s, 'paused', false).state, 'BLOCKED');
  assert.equal(lifecycleOf({ status: 'queued', depends_on: [] }, s, 'running', true).state, 'BLOCKED');
  assert.equal(lifecycleOf({ status: 'waiting_for_external_action', depends_on: [] }, s, 'running', false).state, 'BLOCKED');

  const wf = await createWorkflow(db, { template: 'sunverse_song_release', title: 'Song' });
  const tasks = await getTasks(db, wf.id);
  const lyrics = tasks.find((t) => t.step_key === 'lyrics');
  const safety = tasks.find((t) => t.step_key === 'safety');
  const release = tasks.find((t) => t.step_key === 'release');
  await assert.rejects(reassignTask(db, safety.id, 'sunverse_vagdevi_lyricist'), /review gate/);
  await assert.rejects(reassignTask(db, lyrics.id, 'ops_dharma_safety'), /Review agents/);
  await assert.rejects(reassignTask(db, release.id, 'sunverse_vagdevi_lyricist'), /requires human approval/);
  const r = await reassignTask(db, lyrics.id, 'littleloop_vyasa_scriptwriter');
  assert.equal(r.from, 'sunverse_vagdevi_lyricist');
  assert.equal((await db.prepare('SELECT agent_id FROM tasks WHERE id = ?').bind(lyrics.id).first()).agent_id, 'littleloop_vyasa_scriptwriter');
  assert.equal(REGISTRY.agents.length, 31, 'reassignment never changes the registry');
});

test('commands answer from records; pause is only proposed, never applied by the command', async () => {
  const run = (t) => runCommand(ENV, db, [{ provider: 'claude', state: 'key_set_untested', model: 'm' }, { provider: 'gemini', state: 'not_configured', model: 'g' }], t);
  assert.equal((await run("Give me today's complete studio status.")).intent, 'status');
  assert.equal((await run('Which agents are working and what is each one doing?')).intent, 'agents');
  const p = await run('Plan five Instagram Reels and estimate the cost before assigning any tasks.');
  assert.equal(p.intent, 'plan');
  assert.equal(p.data.count, 5);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM workflows').first()).n, 0);
  const c = await run('Show me remaining credits and tell me which balances are unknown.');
  assert.equal(c.intent, 'credits');
  assert.ok(c.data.every((q) => q.remaining === null));
  const pause = await run('Pause tasks that could incur new API charges.');
  assert.equal(pause.intent, 'pause');
  assert.deepEqual(pause.proposedAction.body, { dispatchPaused: true });
  assert.equal((await getSettings(db)).dispatch_paused, false);
  assert.equal((await run('Show me token usage by provider.')).intent, 'usage');
  assert.equal((await run('Which tasks are at risk of missing their deadlines?')).intent, 'deadlines');
  assert.equal((await run('Find the cheapest suitable model for this task.')).intent, 'cheapest');
  assert.equal((await run('Which provider requires authorization?')).intent, 'authorize');
  assert.equal((await run('Show me the tasks waiting for my approval.')).intent, 'approvals');
  assert.equal((await run('Show me the actual versus estimated cost of my last project.')).intent, 'actual_vs_estimate');
  assert.equal((await run('Why did the CBO assign this task to this agent?')).intent, 'why_assign');
  assert.match((await run('Create a Sunverse male-only romantic music video.')).answer, /Male-only requirement/);
});

/* ---------------- voices ---------------- */
test('voice library: exactly 10 profiles — 4 male, 4 female, 2 kids; nothing claims synthesis or singing by default', async () => {
  assert.equal(VOICE_PROFILES.length, 10);
  assert.equal(VOICE_PROFILES.filter((p) => p.gender === 'male').length, 4);
  assert.equal(VOICE_PROFILES.filter((p) => p.gender === 'female').length, 4);
  assert.equal(VOICE_PROFILES.filter((p) => p.gender === 'child').length, 2);
  assert.deepEqual(VOICE_PROFILES.map((p) => p.id), ['M1', 'M2', 'M3', 'M4', 'F1', 'F2', 'F3', 'F4', 'K1', 'K2']);
  const v = await listVoices({}, db);
  assert.ok(v.every((p) => !p.availability.speechSynthesis && !p.availability.singing && !p.availability.previewable));
  await updateVoiceSetting(db, 'M3', { provider: 'gemini_tts', providerVoiceId: 'VoiceA' });
  const v2 = await listVoices({ GEMINI_API_KEY: 'k' }, db);
  assert.equal(v2.find((p) => p.id === 'M3').availability.speechSynthesis, true);
  assert.equal(v2.find((p) => p.id === 'M3').availability.singing, false, 'TTS is never a singing model');
  await updateVoiceSetting(db, 'K1', { provider: 'gemini_tts', providerVoiceId: 'VoiceB' });
  assert.equal((await listVoices({ GEMINI_API_KEY: 'k' }, db)).find((p) => p.id === 'K1').availability.speechSynthesis, false, 'no verified child voice');
});

test('voice director: male-only stays male; LittleLoop toddler/dad/mom; music-only adds no narration; override allowed', async () => {
  const male = await recommendVoices({}, db, { brief: 'Male-only romantic Hindi song for the monsoon', brand: 'sunverse', contentType: 'music_video' });
  assert.ok(male.recommendations.length >= 1);
  assert.ok(male.recommendations.every((r) => r.profileId.startsWith('M') && r.backups.every((b) => b.profileId.startsWith('M'))));
  assert.ok(male.recommendations.every((r) => r.mode === 'singing' && /Singing provider required/.test(r.generationMethod)));

  const ll = await recommendVoices({}, db, { brief: 'Toddler spills milk, dad panics, mom laughs', brand: 'littleloop', contentType: 'reel' });
  const by = Object.fromEntries(ll.recommendations.map((r) => [r.role, r.profileId]));
  assert.equal(by.toddler, 'K1');
  assert.match(by.dad, /^M/);
  assert.match(by.mom, /^F/);

  const mo = await recommendVoices({}, db, { brief: 'Instrumental lofi, music-only, no narration', brand: 'sunverse' });
  assert.equal(mo.recommendations.length, 0);
  assert.ok(mo.notes.some((n) => /Music-only/.test(n)));
  assert.equal((await recommendVoices({}, db, { brief: 'Technology documentary for YouTube', contentType: 'documentary' })).recommendations[0].profileId, 'M2');
  assert.equal(male.overridable, true);
});

test('voice consistency: locked assignment needs confirmation + reason to replace; director keeps it', async () => {
  await assignVoice(db, { scope: 'project', scopeRef: 'pd_1', role: 'lead vocal', profileId: 'M2', mode: 'singing' });
  await assert.rejects(assignVoice(db, { scope: 'project', scopeRef: 'pd_1', role: 'lead vocal', profileId: 'M3', mode: 'singing' }), /confirmReplace/);
  await assert.rejects(assignVoice(db, { scope: 'project', scopeRef: 'pd_1', role: 'lead vocal', profileId: 'M3', mode: 'singing', confirmReplace: true }), /reason/);
  await assert.rejects(assignVoice(db, { scope: 'project', scopeRef: 'pd_1', role: 'x', profileId: 'K1', mode: 'singing' }), /not designed for singing/);
  const r = await recommendVoices({}, db, { brief: 'romantic song', brand: 'sunverse', projectRef: 'pd_1', roles: [{ role: 'lead vocal', kind: 'singer' }] });
  assert.equal(r.recommendations[0].profileId, 'M2');
  assert.equal(r.recommendations[0].locked, true);
  const ok = await assignVoice(db, { scope: 'project', scopeRef: 'pd_1', role: 'lead vocal', profileId: 'M3', mode: 'singing', confirmReplace: true, reason: 'Owner preferred a younger tone' });
  assert.equal(ok.profile_id, 'M3');
  assert.ok(await db.prepare("SELECT 1 FROM events WHERE kind = 'voice_replaced'").first());
});

test('synthesis: refused without a configured voice; with one, logs usage and ledger (mocked Gemini TTS)', async () => {
  await assert.rejects(synthesize({ GEMINI_API_KEY: 'k' }, db, 'M3', 'Hello'), /not available/);
  await updateVoiceSetting(db, 'M3', { provider: 'gemini_tts', providerVoiceId: 'VoiceA' });
  let body;
  const fetch = async (url, init) => {
    body = JSON.parse(init.body);
    assert.match(url, /gemini-3\.8-flash-tts:generateContent$/);
    assert.ok(!url.includes('SECRET'));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: 'AAAA' } }] } }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 50 } }), { status: 200 });
  };
  const r = await synthesize({ GEMINI_API_KEY: 'k-SECRET' }, db, 'M3', 'Hello there', { fetch });
  assert.equal(r.audioBase64, 'AAAA');
  assert.equal(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'VoiceA');
  const l = await db.prepare("SELECT * FROM cost_ledger WHERE purpose = 'voice_preview'").first();
  assert.equal(l.basis, 'paid_rate_assumed_tier_unknown');
  assert.ok(Math.abs(l.amount_usd - (20 * 0.5 + 50 * 9) / 1e6) < 1e-12);
  await saveSettings(db, { dispatchPaused: true });
  await assert.rejects(synthesize({ GEMINI_API_KEY: 'k' }, db, 'M3', 'x', { fetch }), /pause/);
});

/* ---------------- production ---------------- */
test('characters + scenes: reuse, voice continuity, regeneration history, Flow handoff, verified outputs', async () => {
  const tot = await prod.saveCharacter(db, { brand: 'littleloop', name: 'Tiku', appearance: 'round face, red cap', wardrobe: 'yellow romper', approved: true, referenceAssets: ['https://example.com/tiku.png'] });
  await assert.rejects(prod.saveCharacter(db, { brand: 'littleloop', name: 'Tiku' }), /reuse it/);
  await assert.rejects(prod.saveCharacter(db, { wardrobe: 'blue romper' }, tot), /confirmChange/);
  const dad = await prod.saveCharacter(db, { brand: 'littleloop', name: 'Papa', approved: true });
  const sun = await prod.saveCharacter(db, { brand: 'sunverse', name: 'Singer' });
  await assignVoice(db, { scope: 'character', scopeRef: tot, role: 'main', profileId: 'K1', mode: 'speech' });
  await assignVoice(db, { scope: 'character', scopeRef: dad, role: 'main', profileId: 'M3', mode: 'speech' });

  const pd = await prod.createProduction(db, { brand: 'littleloop', title: 'Milk spill', format: 'instagram_reel', pillar: 'production', method: 'kids_episode' });
  await assert.rejects(prod.addScene(db, pd, { title: 'x', characters: [sun] }), /brand/);
  const sc = await prod.addScene(db, pd, { title: 'Spill', characters: [tot, dad], fields: { subject: 'Tiku and Papa in a kitchen', action: 'milk spills', aspectRatio: '9:16', duration: '8 seconds' } });
  let g = await prod.getProduction(db, pd);
  const scene = g.scenes[0];
  assert.deepEqual(scene.voice, { [tot]: 'K1', [dad]: 'M3' }, 'character voices applied automatically');
  assert.match(scene.prompt, /yellow romper/);
  assert.match(scene.prompt, /9:16/);

  await assert.rejects(prod.regenerateScene(db, sc, { reason: 'x', voice: { [dad]: 'M1' } }), /confirmVoiceChange/);
  const rg = await prod.regenerateScene(db, sc, { reason: 'Hands looked wrong', fields: { subject: 'Tiku and Papa', action: 'milk spills slowly' } });
  assert.equal(rg.version, 2);
  g = await prod.getProduction(db, pd);
  assert.deepEqual(g.scenes[0].voice, { [tot]: 'K1', [dad]: 'M3' }, 'voices preserved across regeneration');
  assert.equal((await prod.sceneVersions(db, sc)).length, 2);

  await assert.rejects(prod.setSceneStatus(db, sc, { status: 'generated' }), /Register the generated video/);
  const h = await prod.prepareFlowHandoff(db, sc);
  assert.equal(h.automation, 'manual_handoff');
  await assert.rejects(prod.completeJob(db, h.jobId, { status: 'succeeded' }), /externalRef/);
  const done = await prod.completeJob(db, h.jobId, { status: 'succeeded', externalRef: 'https://drive.example/clip.mp4' });
  assert.ok(done.assetId);
  g = await prod.getProduction(db, pd);
  assert.equal(g.scenes[0].status, 'generated');
  assert.equal(g.assets[0].status, 'registered', 'owner-reported, not auto-verified');
  assert.ok(g.continuity.issues.some((i) => /no reference images/.test(i.message)), 'Papa has no references → warned');

  const mo = await prod.createProduction(db, { brand: 'sunverse', title: 'Male song', format: 'music_video', pillar: 'production', method: 'music_video', requirements: { vocalRequirement: 'male_only' } });
  const fem = await prod.saveCharacter(db, { brand: 'sunverse', name: 'Dancer' });
  await prod.addScene(db, mo, { title: 'Chorus', characters: [fem], voice: { [fem]: 'F1' }, prompt: 'Dancer in rain' });
  const c = (await prod.getProduction(db, mo)).continuity;
  assert.equal(c.ok, false);
  assert.ok(c.issues.some((i) => /Male-only production uses a female voice/.test(i.message)));
});

/* ---------------- connections + HTTP ---------------- */
test('connections: subscriptions are not API access; nothing connected without a real request; no secrets', async () => {
  const llm = [{ provider: 'claude', state: 'key_set_untested', model: 'm', lastSuccessAt: null, lastError: null }, { provider: 'gemini', state: 'not_configured', model: 'g', lastSuccessAt: null, lastError: null }];
  const c = await listConnections({ ANTHROPIC_API_KEY: 'sk-SECRET', OPENAI_API_KEY: 'oa-SECRET' }, db, llm);
  const by = Object.fromEntries(c.map((x) => [x.id, x]));
  assert.equal(by.claude.state, 'credentials_set_untested');
  assert.equal(by.openai.state, 'credentials_set_untested');
  assert.equal(by.canva.state, 'not_configured');
  assert.equal(by.google_flow.state, 'manual_handoff');
  assert.match(by.gemini.subscriptionNote, /does not grant/);
  assert.equal(/sk-SECRET|oa-SECRET/.test(JSON.stringify(c)), false);
  const t = await testOpenAI({ OPENAI_API_KEY: 'oa-SECRET' }, db, { fetch: async () => new Response('{"error":"bad key oa-SECRET"}', { status: 401 }) });
  assert.equal(t.state, 'error');
  assert.ok(!t.message.includes('oa-SECRET'));
  const ok = await testOpenAI({ OPENAI_API_KEY: 'k' }, db, { fetch: async () => new Response('{"data":[{"id":"a"}]}', { status: 200 }) });
  assert.equal(ok.state, 'connected');
});

test('http: new endpoints are owner-only, validate input, audit config changes, never leak keys', async () => {
  const env = { DB: db, ASSETS: assets, ADMIN_TOKEN: 't', ANTHROPIC_API_KEY: 'sk-SECRET', GEMINI_API_KEY: 'g-SECRET' };
  const H = { authorization: 'Bearer t', 'content-type': 'application/json' };
  for (const p of ['/api/cbo/report', '/api/finance', '/api/voices', '/api/connections', '/api/cbo/tasks', '/api/productions', '/api/characters'])
    assert.equal((await worker.fetch(req(p), env, ctx)).status, 401, p);
  const rep = await (await worker.fetch(req('/api/cbo/report', { headers: H }), env, ctx)).json();
  assert.equal(rep.controller, 'GANESHA_CBO');
  assert.equal(rep.agents.total, 31);
  assert.ok(rep.recommendedActions.some((a) => /USD→INR/.test(a)));
  const fin = await (await worker.fetch(req('/api/finance', { headers: H }), env, ctx)).json();
  assert.equal(fin.forecastMonthInr, null);
  assert.ok(fin.quota.every((q) => q.remaining === null));
  assert.equal((await worker.fetch(req('/api/settings', { method: 'PUT', headers: H, body: JSON.stringify({ fxUsdInr: { rate: 84 } }) }), env, ctx)).status, 400, 'FX needs a source');
  assert.equal((await worker.fetch(req('/api/settings', { method: 'PUT', headers: H, body: JSON.stringify({ dispatchPaused: true, taskApprovalInr: 50 }) }), env, ctx)).status, 200);
  assert.ok(await db.prepare("SELECT 1 FROM events WHERE kind = 'dispatch_pause'").first());
  assert.ok(await db.prepare("SELECT 1 FROM events WHERE kind = 'config_change'").first());
  assert.equal((await worker.fetch(req('/api/finance/budgets', { method: 'POST', headers: H, body: JSON.stringify({ scope: 'monthly_total', limitInr: -1 }) }), env, ctx)).status, 400);
  const v = await (await worker.fetch(req('/api/voices', { headers: H }), env, ctx)).json();
  assert.equal(v.profiles.length, 10);
  const all = JSON.stringify([rep, fin, v, await (await worker.fetch(req('/api/connections', { headers: H }), env, ctx)).json()]);
  assert.equal(/sk-SECRET|g-SECRET/.test(all), false);
  const cmd = await (await worker.fetch(req('/api/cbo/command', { method: 'POST', headers: H, body: JSON.stringify({ text: 'status' }) }), env, ctx)).json();
  assert.equal(cmd.intent, 'status');
  const pr = await (await worker.fetch(req('/api/studio/prompt', { method: 'POST', headers: H, body: JSON.stringify({ fields: { subject: 'A lighthouse', camera: 'slow dolly in' } }) }), env, ctx)).json();
  assert.match(pr.prompt, /Camera: slow dolly in/);
});
