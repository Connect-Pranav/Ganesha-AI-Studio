// CBO chat + finished work on a real local D1. Gemini/OpenAI are MOCKED (fake fetch).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getBindings, disposeDb, resetDb, noSleep } from './helpers.mjs';
import * as chat from '../cbochat.mjs';
import { finishedWork } from '../finished.mjs';
import { createWorkflow } from '../orchestrator.mjs';

let db, MEDIA;
before(async () => ({ DB: db, MEDIA } = await getBindings()));
after(disposeDb);
beforeEach(() => resetDb(db));

const fakeGemini = (reply) => {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return Response.json({ candidates: [{ content: { parts: [{ text: reply }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 40 } });
  };
  fn.calls = calls;
  return fn;
};

test('Gemini chat: grounded in the live snapshot, history kept, call logged; ChatGPT needs a key', async () => {
  const env = { GEMINI_API_KEY: 'g-test', MEDIA };
  assert.equal(chat.engines(env).find((e) => e.id === 'openai').available, false);
  await assert.rejects(chat.send(env, db, [], { message: 'hi', engine: 'openai' }), /ChatGPT is not available/);
  const f = fakeGemini('CBO: Aaj 0 approvals pending hain.');
  const r = await chat.send(env, db, [], { message: 'Kaun se approvals pending hain?' }, { fetch: f, sleep: noSleep });
  assert.equal(r.content, 'Aaj 0 approvals pending hain.');
  const sys = f.calls[0].body.systemInstruction.parts[0].text;
  assert.match(sys, /LIVE STUDIO SNAPSHOT/);
  assert.match(sys, /Pending approvals \(0\)/);
  assert.match(sys, /Reel Factory: OFF/);
  await chat.send(env, db, [], { message: 'Aur kuch?' }, { fetch: fakeGemini('Bas itna.'), sleep: noSleep });
  const h = await chat.history(db);
  assert.deepEqual(h.map((m) => m.role), ['user', 'assistant', 'user', 'assistant']);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM provider_calls WHERE purpose = 'cbo_chat' AND status = 'success'").first()).n, 2);
  await chat.clear(db);
  assert.equal((await chat.history(db)).length, 0);
});

test('ChatGPT engine uses the OpenAI API only when OPENAI_API_KEY is set', async () => {
  const env = { OPENAI_API_KEY: 'sk-test', MEDIA };
  let body;
  const f = async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    body = JSON.parse(init.body);
    return Response.json({ choices: [{ message: { content: 'Namaste!' } }], usage: { prompt_tokens: 10, completion_tokens: 2 } });
  };
  const r = await chat.send(env, db, [], { message: 'hello', engine: 'openai' }, { fetch: f });
  assert.equal(r.content, 'Namaste!');
  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.messages.at(-1).content, 'hello');
});

test('finished work lists completed goals with step outputs', async () => {
  const { id } = await createWorkflow(db, { template: 'research_brief', title: 'Done goal' });
  await db.prepare("UPDATE workflows SET status = 'completed' WHERE id = ?").bind(id).run();
  await db.prepare("UPDATE tasks SET status = 'completed', output_artifact = 'art_1', finished_at = '2026-10-18T00:00:00Z' WHERE workflow_id = ?").bind(id).run();
  const f = await finishedWork({ MEDIA }, db);
  assert.equal(f.goals[0].title, 'Done goal');
  assert.ok(f.goals[0].steps.length >= 1);
  assert.equal(f.recentSteps[0].output_artifact, 'art_1');
});
