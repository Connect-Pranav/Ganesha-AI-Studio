// Ganesha Brain: memory, skills, Groq engine, missions (think → plan → approve → execute → verify →
// deliver) on a real local D1. Every AI provider and connector is MOCKED — these prove the logic only.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getBindings, disposeDb, resetDb, noSleep } from './helpers.mjs';
import * as memory from '../brain/memory.mjs';
import * as skills from '../brain/skills.mjs';
import * as missions from '../brain/missions.mjs';
import { deliverMission } from '../brain/deliver.mjs';
import { callProvider } from '../providers.mjs';
import * as chat from '../agentchat.mjs';
import worker from '../index.mjs';

let db;
before(async () => ({ DB: db } = await getBindings()));
after(disposeDb);
beforeEach(() => resetDb(db));

const geminiRes = (text) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }), { status: 200 });
const groqRes = (text) => new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 7, completion_tokens: 3 } }), { status: 200 });

/** Fake AI: answers by what the system prompt asks for. `opts.check` decides the checker's verdicts in order. */
function fakeAi({ plan, checks = [], seen = [], deliveries = [] } = {}) {
  let c = 0;
  return async (url, init) => {
    if (url.startsWith('https://api.github.com/')) {
      deliveries.push({ url, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ content: { html_url: 'https://github.com/x/vault/blob/main/m.md' } }), { status: 201 });
    }
    if (url.startsWith('https://hooks.slack.com/')) {
      deliveries.push({ url, body: JSON.parse(init.body) });
      return new Response('ok', { status: 200 });
    }
    const body = JSON.parse(init.body);
    const system = body.systemInstruction?.parts?.[0]?.text ?? body.messages?.[0]?.content ?? '';
    const prompt = body.contents?.[0]?.parts?.[0]?.text ?? body.messages?.[1]?.content ?? '';
    seen.push({ url, system, prompt });
    const reply = url.includes('groq.com') ? groqRes : geminiRes;
    if (system.includes('THINK about a goal')) return reply(JSON.stringify(plan));
    if (system.includes('strict quality checker')) return reply(JSON.stringify(checks[c++] ?? { pass: true, score: 8, note: 'Complete and usable.' }));
    if (system.includes('Close a finished mission')) return reply('**Outcome**\nTwo reels ready.\n\n**Ready to use**\nScript + prompt.\nLESSON: Rain reels need a cosy indoor ending.');
    return reply(`Deliverable for: ${prompt.match(/YOUR STEP \(\d+\): ([^\n]+)/)?.[1] ?? '?'}`);
  };
}
const PLAN = {
  thinking: 'Research what kids enjoy about rain, write the script, turn it into a Flow prompt, then check safety.',
  criteria: ['2 × 10 s scenes', 'safe for ages 2–8'],
  steps: [
    { agent: 'littleloop_vyasa_scriptwriter', title: 'Script', instruction: 'Write a rain reel script', skill: 'reel-script' },
    { agent: 'sunverse_vagdevi_lyricist', title: 'Song', instruction: 'Write lyrics' }, // other brand → dropped
    { agent: 'nobody_agent', title: 'Ghost', instruction: 'x' }, // unknown → dropped
    { agent: 'littleloop_maya_prompt_engineer', title: 'Flow prompt', instruction: 'One master prompt', skill: 'flow-video-prompt' },
    { agent: 'ops_dharma_safety', title: 'Safety check', instruction: 'Check for kids' },
  ],
};

test('memory: scopes, duplicates, secrets refused, pinned first, REMEMBER lines', async () => {
  await memory.addMemory(db, { scope: 'studio', fact: 'Owner prefers Hinglish replies' });
  assert.equal((await memory.addMemory(db, { scope: 'studio', fact: 'owner prefers hinglish replies!' })).duplicate, true);
  await memory.addMemory(db, { scope: 'sunverse', fact: 'Singer is KoBhit, lyrics by COCO' });
  const pin = await memory.addMemory(db, { scope: 'littleloop', fact: 'Reels are always 2 × 10 s scenes' });
  await memory.updateMemory(db, pin.id, { pinned: true });
  await assert.rejects(memory.addMemory(db, { scope: 'studio', fact: 'gemini key is AIzaSyA1234567890abcdefghijklmn' }), /never stores/);
  await assert.rejects(memory.addMemory(db, { scope: 'mars', fact: 'hello there' }), /scope/);
  const ll = await memory.memoryFor(db, { agentId: 'littleloop_vyasa_scriptwriter' });
  assert.match(ll.split('\n')[0], /2 × 10 s/, 'pinned first');
  assert.match(ll, /Hinglish/);
  assert.doesNotMatch(ll, /KoBhit/, 'LittleLoop agents do not see Sunverse memory');
  const x = memory.extractRemember('Done.\nREMEMBER: Diwali reel on 1 Nov\nREMEMBER[sunverse]: new song every Friday\nmore', 'littleloop');
  assert.equal(x.text, 'Done.\nmore');
  assert.deepEqual(x.facts, [{ scope: 'littleloop', fact: 'Diwali reel on 1 Nov' }, { scope: 'sunverse', fact: 'new song every Friday' }]);
});

test('skills: built-ins seeded, custom skill saved, /command parsed, built-ins cannot be deleted', async () => {
  const all = await skills.listSkills(db);
  assert.ok(all.some((s) => s.id === 'reel-script' && s.builtin));
  await skills.saveSkill(db, { id: 'diwali-reel', name: 'Diwali reel', description: 'Festive reel', instructions: 'Lamps, sweets, kindness.', brand: 'littleloop' });
  const p = await skills.parseSkillCommand(db, '/diwali-reel bunny version');
  assert.equal(p.skill.id, 'diwali-reel');
  assert.equal(p.rest, 'bunny version');
  assert.equal((await skills.parseSkillCommand(db, '/nope hi')).skill, null);
  await assert.rejects(skills.deleteSkill(db, 'reel-script'), /Built-in/);
  await assert.rejects(skills.saveSkill(db, { id: 'Bad Id', name: 'x', description: 'xyz', instructions: 'xyz' }), /id must/);
  assert.match(await skills.catalog(db, 'sunverse'), /yt-seo/);
  assert.doesNotMatch(await skills.catalog(db, 'sunverse'), /diwali-reel/, 'other brand skills hidden');
});

test('groq: OpenAI-compatible request with bearer key, parsed and logged', async () => {
  let req;
  const r = await callProvider({ GROQ_API_KEY: 'gsk_test' }, db, 'groq', { system: 's', prompt: 'p', json: true, purpose: 't' }, { fetch: async (u, i) => ((req = { u, i }), groqRes('{"ok":true}')), sleep: noSleep });
  assert.equal(req.u, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(req.i.headers.authorization, 'Bearer gsk_test');
  assert.equal(JSON.parse(req.i.body).response_format.type, 'json_object');
  assert.deepEqual(r.json, { ok: true });
  const log = await db.prepare("SELECT provider, input_tokens FROM provider_calls WHERE provider = 'groq'").first();
  assert.equal(log.input_tokens, 7);
});

test('agent chat: memory + skills in the prompt, /skill applied, REMEMBER saved and shown', async () => {
  await memory.addMemory(db, { scope: 'littleloop', fact: 'Main character is Pip the bunny' });
  const seen = [];
  const r = await chat.send({ GEMINI_API_KEY: 'g' }, db, 'littleloop_vyasa_scriptwriter', { message: '/reel-script baarish wali' }, { fetch: fakeAi({ seen }), sleep: noSleep });
  const sys = seen[0].system;
  assert.match(sys, /Pip the bunny/);
  assert.match(sys, /ACTIVE SKILL — LittleLoop reel script/);
  assert.match(seen[0].prompt, /\[using skill \/reel-script\] baarish wali/);
  assert.equal(r.skill, 'reel-script');
  const g = async () => geminiRes('Tathastu.\nREMEMBER: Owner wants rain reels every Monday');
  const r2 = await chat.send({ GEMINI_API_KEY: 'g' }, db, 'littleloop_vyasa_scriptwriter', { message: 'yaad rakho: har Monday rain reel' }, { fetch: g, sleep: noSleep });
  assert.equal(r2.remembered.length, 1);
  assert.doesNotMatch(r2.content, /REMEMBER:/);
  assert.match(r2.content, /Yaad rakha/);
  assert.ok((await memory.listMemory(db, { scope: 'littleloop' })).some((m) => m.fact.includes('every Monday') && m.source === 'chat'));
});

test('mission: think → plan (brand-isolated) → nothing runs before approval → execute → verify → lessons → deliver', async () => {
  const env = { GEMINI_API_KEY: 'g', GITHUB_TOKEN: 'github_pat_x', SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/T/B/x' };
  const seen = [];
  const deliveries = [];
  const deps = { fetch: fakeAi({ plan: PLAN, seen, deliveries }), sleep: noSleep };
  const m = await missions.createMission(env, db, { goal: 'Two rain reels for LittleLoop this week', brand: 'littleloop', deliver: ['github', 'slack'] }, deps);
  assert.equal(m.status, 'awaiting_approval');
  assert.deepEqual(m.steps.map((s) => s.agent_id), ['littleloop_vyasa_scriptwriter', 'littleloop_maya_prompt_engineer', 'ops_dharma_safety']);
  assert.equal(m.steps[0].skill_id, 'reel-script');
  assert.match(m.thinking, /Research/);

  // Approval gate: advancing before approval does nothing.
  assert.equal((await missions.advance(env, db, m.id, deps)).steps[0].status, 'pending');

  await missions.decideMission(db, m.id, { decision: 'approve' });
  let cur;
  for (let i = 0; i < 10; i++) {
    cur = await missions.advance(env, db, m.id, deps);
    if (cur.status !== 'running') break;
  }
  assert.equal(cur.status, 'done');
  assert.ok(cur.steps.every((s) => s.status === 'done' && s.check.pass));
  // Step 2 saw step 1's output; the skill method was in step 1's system prompt.
  const step2 = seen.find((x) => /YOUR STEP \(2\)/.test(x.prompt));
  assert.match(step2.prompt, /Deliverable for: Script/);
  assert.ok(seen.some((x) => /YOUR STEP \(1\)/.test(x.prompt) && /ACTIVE SKILL — LittleLoop reel script/.test(x.system)));
  assert.match(cur.result, /Two reels ready/);
  assert.doesNotMatch(cur.result, /LESSON:/);
  assert.ok((await memory.listMemory(db, { scope: 'littleloop' })).some((x) => x.source === 'mission' && /cosy indoor ending/.test(x.fact)));
  assert.deepEqual(cur.deliveries.map((d) => [d.target, d.status]), [['github', 'sent'], ['slack', 'sent']]);
  assert.match(deliveries[0].url, /repos\/Connect-Pranav\/Ganesha-AI-Vault\/contents\/missions\//);
  assert.match(deliveries[1].body.text, /github\.com\/x\/vault/, 'Slack links the vault file');
  // Done is final: another advance changes nothing.
  assert.equal((await missions.advance(env, db, m.id, deps)).status, 'done');
});

test('mission: a step the checker rejects is redone once with the note; reject and cancel work', async () => {
  const env = { GEMINI_API_KEY: 'g' };
  const seen = [];
  const plan = { thinking: 't', criteria: ['c'], steps: [{ agent: 'sunverse_vagdevi_lyricist', title: 'Lyrics', instruction: 'Write a song' }] };
  const deps = { fetch: fakeAi({ plan, seen, checks: [{ pass: false, note: 'Chorus missing' }, { pass: true, note: 'ok' }] }), sleep: noSleep };
  const m = await missions.createMission(env, db, { goal: 'New Sunverse monsoon song', brand: 'sunverse' }, deps);
  await missions.decideMission(db, m.id, { decision: 'approve' });
  let cur = await missions.advance(env, db, m.id, deps);
  assert.equal(cur.steps[0].status, 'pending');
  assert.equal(cur.steps[0].check.note, 'Chorus missing');
  cur = await missions.advance(env, db, m.id, deps);
  assert.equal(cur.steps[0].status, 'done');
  assert.equal(cur.steps[0].attempts, 2);
  assert.ok(seen.some((x) => /CHECKER REJECTED YOUR LAST ATTEMPT: Chorus missing/.test(x.prompt)));

  const r = await missions.createMission(env, db, { goal: 'Another sunverse song idea', brand: 'sunverse' }, deps);
  await missions.decideMission(db, r.id, { decision: 'reject' });
  assert.equal((await missions.getMission(db, r.id)).status, 'rejected');
  await assert.rejects(missions.decideMission(db, r.id, { decision: 'approve' }), /not waiting/);
});

test('mission: no engine → planning fails with a clear message; unconnected destination is skipped, not faked', async () => {
  const m = await missions.createMission({}, db, { goal: 'Foliocraft pricing page copy', brand: 'foliocraft' });
  assert.equal(m.status, 'failed');
  assert.match(m.error, /GEMINI_API_KEY or GROQ_API_KEY/);
  await assert.rejects(missions.createMission({}, db, { goal: 'x' }), /goal/);
  await assert.rejects(missions.createMission({}, db, { goal: 'valid goal text', deliver: ['email'] }), /Unknown destination/);
  const out = await deliverMission({}, db, { id: 'msn_1', goal: 'g', brand: 'studio', result: 'r' }, [], ['notion']);
  assert.equal(out[0].status, 'skipped');
  assert.match(out[0].message, /NOTION_TOKEN/);
});

test('http: brain routes are owner-only and work end to end', async () => {
  const ctx = { waitUntil: (p) => p.catch(() => {}) };
  const env = { DB: db, ASSETS: { fetch: async () => new Response('ok') }, ADMIN_TOKEN: 't' };
  const H = { authorization: 'Bearer t', 'content-type': 'application/json' };
  assert.equal((await worker.fetch(new Request('https://g.test/api/brain'), env, ctx)).status, 401);
  const s = await (await worker.fetch(new Request('https://g.test/api/brain', { headers: H }), env, ctx)).json();
  assert.ok(s.skillCount >= 9);
  assert.ok(s.engines.some((e) => e.provider === 'groq' && e.free));
  assert.equal(s.connectors.find((c) => c.id === 'notion').configured, false);
  const add = await worker.fetch(new Request('https://g.test/api/brain/memory', { method: 'POST', headers: H, body: JSON.stringify({ scope: 'studio', fact: 'Studio day starts 9 AM IST' }) }), env, ctx);
  assert.equal(add.status, 201);
  const list = await (await worker.fetch(new Request('https://g.test/api/brain/memory', { headers: H }), env, ctx)).json();
  assert.equal(list.memory.length, 1);
  const mis = await worker.fetch(new Request('https://g.test/api/brain/missions', { method: 'POST', headers: H, body: JSON.stringify({ goal: 'Plan Sunverse week', brand: 'sunverse', stream: true }) }), env, ctx);
  const text = await mis.text();
  assert.match(text.split('\n\n')[0], /^event: ping/);
  assert.match(text, /event: done/);
  assert.match(text, /Planning failed/, 'no engine in this env → honest failure, not a fake plan');
});

test('cron: frees a stuck step and moves running missions forward', async () => {
  const env = { GEMINI_API_KEY: 'g' };
  const plan = { thinking: 't', criteria: [], steps: [{ agent: 'narada_market_intelligence', title: 'Research', instruction: 'Find trends' }] };
  const deps = { fetch: fakeAi({ plan }), sleep: noSleep };
  const m = await missions.createMission(env, db, { goal: 'Studio trend scan', brand: 'studio' }, deps);
  await missions.decideMission(db, m.id, { decision: 'approve' });
  await db.prepare("UPDATE mission_steps SET status = 'running', started_at = '2020-01-01T00:00:00Z' WHERE mission_id = ?").bind(m.id).run();
  await missions.scheduledMissions(env, db, deps);
  assert.equal((await missions.getMission(db, m.id)).status, 'done');
});

test('SAARTHI + GANESHA chat: memory/skills in the prompt, MISSION line plans a mission that waits for approval', async () => {
  const cbochat = await import('../cbochat.mjs');
  await memory.addMemory(db, { scope: 'studio', fact: 'Owner reviews work at 9 PM IST' });
  const plan = { thinking: 't', criteria: ['c'], steps: [{ agent: 'sunverse_vagdevi_lyricist', title: 'Lyrics', instruction: 'Write' }] };
  const base = fakeAi({ plan });
  const seen = [];
  // Interactions API is not mocked → SAARTHI falls back to generateContent, which this fake answers.
  const fetchImpl = async (url, init) => {
    if (url.includes(':generateContent')) {
      const b = JSON.parse(init.body);
      const sys = b.systemInstruction?.parts?.[0]?.text ?? '';
      if (sys.includes('SAARTHI')) {
        seen.push(sys);
        return geminiRes('Tathastu.\nMISSION: {"goal":"Sunverse monsoon song pack: lyrics, SEO","brand":"sunverse"}\nREMEMBER: Monsoon songs release on Fridays');
      }
    }
    if (url.includes('interactions')) return new Response('{"error":{"message":"not here"}}', { status: 404 });
    return base(url, init);
  };
  const r = await cbochat.send({ GEMINI_API_KEY: 'g' }, db, [], { message: '/yt-seo monsoon song launch karo' }, { fetch: fetchImpl, sleep: noSleep });
  assert.match(seen[0], /Owner reviews work at 9 PM IST/);
  assert.match(seen[0], /ACTIVE SKILL — Sunverse YouTube SEO pack/);
  assert.match(seen[0], /MISSION: \{"goal"/);
  assert.equal(r.mission.status, 'awaiting_approval');
  assert.equal(r.action.type, 'mission');
  assert.doesNotMatch(r.content, /MISSION:|REMEMBER:/);
  assert.match(r.content, /Yaad rakha/);
  const m = await missions.getMission(db, r.mission.id);
  assert.equal(m.brand, 'sunverse');
  assert.ok(m.steps.every((s) => s.status === 'pending'), 'nothing runs before the owner approves');
  const hist = await cbochat.history(db);
  assert.equal(hist.at(-1).action.type, 'mission', 'the mission card survives a reload');

  // GANESHA's own chat can start missions too; other agents cannot.
  const g = await chat.send({ GEMINI_API_KEY: 'g' }, db, 'ganesha_orchestrator', { message: 'Foliocraft launch pack banao' }, { fetch: async (u, i) => (JSON.parse(i.body).systemInstruction?.parts?.[0]?.text?.includes('THINK about a goal') ? base(u, i) : geminiRes('Tathastu.\nMISSION: {"goal":"Foliocraft launch pack","brand":"foliocraft"}')), sleep: noSleep });
  assert.equal(g.action.type, 'mission');
  const v = await chat.send({ GEMINI_API_KEY: 'g' }, db, 'littleloop_vyasa_scriptwriter', { message: 'x' }, { fetch: async () => geminiRes('ok\nMISSION: {"goal":"some long goal here","brand":"littleloop"}'), sleep: noSleep });
  assert.equal(v.action, null);
});

test('HUD: level/XP and attention stars are counted from real rows only', async () => {
  const { hudStats, levelFor } = await import('../brain/hud.mjs');
  assert.deepEqual(levelFor(0), { level: 1, xpInLevel: 0, xpForNext: 300 });
  assert.equal(levelFor(300).level, 2);
  const empty = await hudStats(db);
  assert.equal(empty.xp, 0);
  assert.equal(empty.stars, 0);
  const env = { GEMINI_API_KEY: 'g' };
  const plan = { thinking: 't', criteria: [], steps: [{ agent: 'narada_market_intelligence', title: 'Research', instruction: 'Find trends' }] };
  const deps = { fetch: fakeAi({ plan }), sleep: noSleep };
  const a = await missions.createMission(env, db, { goal: 'Studio trend scan one', brand: 'studio' }, deps);
  await missions.createMission(env, db, { goal: 'LittleLoop trend scan', brand: 'littleloop' }, deps);
  await missions.decideMission(db, a.id, { decision: 'approve' });
  await missions.advance(env, db, a.id, deps);
  await missions.advance(env, db, a.id, deps);
  const h = await hudStats(db);
  assert.equal(h.counts.missions, 1);
  assert.equal(h.counts.steps, 1);
  assert.equal(h.xp, 250 + 40);
  assert.equal(h.attention.missionApprovals, 1, 'the second mission waits for the owner');
  assert.equal(h.stars, 1);
  assert.equal(h.brands.littleloop.awaiting, 1);
});
