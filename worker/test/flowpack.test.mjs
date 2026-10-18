// Flow pack: consolidates a finished LittleLoop goal into one Flow prompt per reel. Gemini is MOCKED.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getBindings, disposeDb, resetDb, noSleep } from './helpers.mjs';
import { buildFlowPack, getFlowPack } from '../flowpack.mjs';

let db;
before(async () => ({ DB: db } = await getBindings()));
after(disposeDb);
beforeEach(() => resetDb(db));
const NOW = '2026-10-18T10:00:00Z';

async function seed(brand = 'littleloop') {
  await db.prepare("INSERT INTO workflows (id, template, brand, title, goal, status, created_at, updated_at) VALUES ('wf1','littleloop_reel',?,'Plan five reels','Five reels','completed',?,?)").bind(brand, NOW, NOW).run();
  const steps = [['characters', 'Character sheet', 'Chiku: orange fox cub, #F28C28, blue scarf'], ['script', 'Timed script', '0-4s Chiku spots a puddle…'], ['prompts', 'Per-shot video prompts', 'Shot 1: 9:16, Chiku jumps…']];
  for (const [k, d, text] of steps) {
    await db.prepare("INSERT INTO tasks (id, workflow_id, step_key, agent_id, deliverable, status, max_attempts, created_at, updated_at) VALUES (?,?,?,?,?,'completed',2,?,?)").bind(`t-${k}`, 'wf1', k, `agent_${k}`, d, NOW, NOW).run();
    await db.prepare("INSERT INTO artifacts (id, workflow_id, task_id, agent_id, kind, version, content_json, created_at) VALUES (?,?,?,?,'deliverable',1,?,?)").bind(`a-${k}`, 'wf1', `t-${k}`, `agent_${k}`, JSON.stringify({ summary: 's', deliverable: text.repeat(5) }), NOW).run();
  }
  await db.prepare("INSERT INTO reel_sheets (id, brand, name, media_key, mime, bytes, created_at, updated_at) VALUES ('s1','littleloop','Chiku Fox','sheet/s1','image/png',10,?,?)").bind(NOW, NOW).run();
}

const gemini = (reels, seen) => async (url, init) => {
  assert.match(url, /generativelanguage/);
  seen?.push(JSON.parse(init.body));
  const text = JSON.stringify({ reels, notes: ['Flow makes 8s per clip'] });
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }), { status: 200 });
};
const LONG = 'Format: 9:16 vertical 1080x1920, 16s. '.repeat(10);

test('flow pack: one master prompt per reel, only real sheet names, cached until regenerated', async () => {
  await seed();
  const seen = [];
  const env = { GEMINI_API_KEY: 'g' };
  const pack = await buildFlowPack(env, db, 'wf1', {}, { fetch: gemini([{ title: 'Puddle jump', durationSec: 16, sheets: ['chiku fox', 'Momo Bunny'], sheetNote: '', masterPrompt: LONG }], seen), sleep: noSleep });
  assert.equal(pack.reels.length, 1);
  assert.deepEqual(pack.reels[0].sheets, ['Chiku Fox'], 'matched case-insensitively to the saved name');
  assert.match(pack.reels[0].sheetNote, /Momo Bunny/, 'invented sheet names are flagged, not passed through');
  const sent = seen[0].contents[0].parts[0].text;
  assert.match(sent, /"Chiku Fox"/, 'real uploaded sheet names are given to the model');
  assert.match(sent, /orange fox cub/, 'agent outputs are included');
  assert.equal((await getFlowPack(db, 'wf1')).reels[0].title, 'Puddle jump');
  const again = await buildFlowPack(env, db, 'wf1', {}, { fetch: async () => assert.fail('cached pack must not call Gemini') });
  assert.equal(again.reels[0].title, 'Puddle jump');
  const redo = await buildFlowPack(env, db, 'wf1', { force: true }, { fetch: gemini([{ title: 'Take 2', sheets: [], masterPrompt: LONG }]), sleep: noSleep });
  assert.equal(redo.reels[0].title, 'Take 2');
});

test('flow pack: refuses non-LittleLoop goals and incomplete prompts', async () => {
  await seed('sunverse');
  await assert.rejects(buildFlowPack({ GEMINI_API_KEY: 'g' }, db, 'wf1'), /LittleLoop goals only/);
  await resetDb(db);
  await seed();
  await assert.rejects(buildFlowPack({ GEMINI_API_KEY: 'g' }, db, 'wf1', {}, { fetch: gemini([{ title: 'x', masterPrompt: 'too short' }]), sleep: noSleep }), /without a full prompt/);
  assert.equal(await getFlowPack(db, 'wf1'), null, 'nothing saved on a bad reply');
  await assert.rejects(buildFlowPack({ GEMINI_API_KEY: 'g' }, db, 'nope'), /not found/);
});
