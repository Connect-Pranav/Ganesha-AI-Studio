// Character Sheet Agent: library-first reuse, Gemini sheet prompts for missing characters. Gemini MOCKED.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getBindings, disposeDb, resetDb, noSleep } from './helpers.mjs';
import { planSheets, listPlans, sheetPrompt, libraryText } from '../sheetagent.mjs';
import { buildAgentPrompt, agentById } from '../agents.mjs';

let db;
before(async () => ({ DB: db } = await getBindings()));
after(disposeDb);
beforeEach(() => resetDb(db));
const NOW = '2026-10-18T10:00:00Z';
const gem = (body, seen) => async (url, init) => {
  seen?.push(JSON.parse(init.body));
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] }, finishReason: 'STOP' }], usageMetadata: {} }), { status: 200 });
};
const STORY = 'Pip, a tiny fluffy cloud, learns to share rain with Momo the thirsty bunny and Chiku the fox.';

test('sheet agent: reuses library sheets by exact name, downgrades invented matches, builds full Gemini prompts', async () => {
  await db.prepare("INSERT INTO reel_sheets (id, brand, name, media_key, mime, bytes, created_at, updated_at) VALUES ('s1','littleloop','Chiku Fox','k','image/png',1,?,?)").bind(NOW, NOW).run();
  const seen = [];
  const plan = await planSheets({ GEMINI_API_KEY: 'g' }, db, { story: STORY, project: 'Pip and the Magic of Sharing', style: '3d' }, {
    fetch: gem({
      characters: [
        { name: 'Pip', role: 'main', status: 'missing', librarySheet: null, description: 'Tiny fluffy cumulus cloud, two heads high', proportions: 'two heads high', expressions: ['happy', 'excited', 'curious', 'concerned', 'hesitant', 'empathetic'], poses: ['floating', 'spin', 'looking down', 'hugging tummy', 'releasing rain', 'celebrating'], palette: [{ name: 'Cloud white', hex: '#f8f9fa' }, { name: 'Bad', hex: 'blue' }], details: 'rosy cheeks' },
        { name: 'Chiku', role: 'supporting', status: 'existing', librarySheet: 'chiku fox', description: '' },
        { name: 'Momo', role: 'supporting', status: 'existing', librarySheet: 'Momo Bunny v2', description: 'white bunny' },
      ],
      continuity: ['Same eye spacing'],
      notes: [],
    }, seen),
    sleep: noSleep,
  });
  const sent = seen[0].contents[0].parts[0].text;
  assert.match(sent, /"Chiku Fox"/, 'library names are given to the model before it designs');
  const [pip, chiku, momo] = plan.characters;
  assert.equal(chiku.status, 'existing');
  assert.equal(chiku.librarySheet.name, 'Chiku Fox');
  assert.equal(chiku.geminiPrompt, null, 'existing sheets are reused, no new prompt');
  assert.equal(momo.status, 'missing', 'a sheet name that is not in the library is never trusted');
  assert.match(momo.reason, /not in the library/);
  assert.ok(momo.geminiPrompt);
  assert.equal(pip.palette[0].hex, '#F8F9FA');
  assert.equal(pip.palette[1].hex, null, 'invalid HEX dropped, not guessed');
  for (const part of ['CHARACTER REFERENCE BOARD', 'CHARACTER NAME: Pip', 'TURNAROUND VIEWS', 'front, side, and back', 'FACIAL EXPRESSION SHEET', 'ACTION POSES', 'IDENTITY LOCK', 'Cloud white #F8F9FA', 'PROJECT: Pip and the Magic of Sharing']) assert.ok(pip.geminiPrompt.includes(part), part);
  assert.equal((await listPlans(db))[0].characters.length, 3, 'run is saved');
});

test('sheet agent: input validation; 2D style changes the prompt; CHITRA pipeline prompt carries the library', async () => {
  await assert.rejects(planSheets({ GEMINI_API_KEY: 'g' }, db, { story: 'short' }), /Paste the story/);
  await assert.rejects(planSheets({ GEMINI_API_KEY: 'g' }, db, { story: STORY, style: 'anime' }), /style must be/);
  assert.match(sheetPrompt({ project: 'P', style: '2d', c: { name: 'X', description: 'd' } }), /premium professional 2D character model sheet/);
  assert.match(libraryText([]), /No character sheets uploaded yet/);
  const agent = agentById('littleloop_chitra_character_designer');
  const { system, prompt } = buildAgentPrompt({ agent, task: { step_key: 'characters', deliverable: 'Character sheet' }, workflow: { title: 'T', brand: 'littleloop', goal: '', input_json: '{}' }, upstream: [], library: '- "Chiku Fox"' });
  assert.match(prompt, /search this FIRST/);
  assert.match(prompt, /"Chiku Fox"/);
  assert.match(system, /reuse it exactly/);
  assert.ok(agent.acceptance.includes('Library searched first: existing or missing per character'));
});
