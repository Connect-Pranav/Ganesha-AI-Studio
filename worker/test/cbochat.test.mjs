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

const fakeInteractions = (reply, extra = {}) => {
  const calls = [];
  const fn = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    assert.match(url, /\/v1beta\/interactions$/);
    return Response.json({
      id: `int_${calls.length}`,
      status: 'completed',
      steps: [
        ...(extra.thought ? [{ type: 'thought', signature: 's', summary: [{ type: 'text', text: extra.thought }] }] : []),
        { type: 'model_output', content: [{ type: 'text', text: reply, annotations: extra.cite ? [{ type: 'url_citation', url: 'https://example.com/a', title: 'Example A' }] : [] }] },
      ],
      usage: { total_input_tokens: 900, total_output_tokens: 40, total_thought_tokens: 10 },
    });
  };
  fn.calls = calls;
  return fn;
};

test('Gemini chat: live snapshot, think + research switches, server-side memory, proposed goal', async () => {
  const env = { GEMINI_API_KEY: 'g-test', MEDIA };
  assert.equal(chat.engines(env).find((e) => e.id === 'openai').available, false);
  await assert.rejects(chat.send(env, db, [], { message: 'hi', engine: 'openai' }), /ChatGPT is not available/);
  const f1 = fakeInteractions('Aaj 0 approvals pending hain.', { thought: 'Checked the snapshot.', cite: true });
  const r1 = await chat.send(env, db, [], { message: 'Kaun se approvals pending hain?', think: true, research: true }, { fetch: f1 });
  assert.equal(r1.content, 'Aaj 0 approvals pending hain.');
  assert.equal(r1.thoughts, 'Checked the snapshot.');
  assert.equal(r1.sources[0].url, 'https://example.com/a');
  const b1 = f1.calls[0].body;
  assert.match(b1.system_instruction, /LIVE STUDIO SNAPSHOT/);
  assert.match(b1.system_instruction, /Reel Factory: OFF/);
  assert.equal(b1.generation_config.thinking_level, 'high');
  assert.deepEqual(b1.tools, [{ type: 'google_search' }]);
  assert.equal(b1.previous_interaction_id, undefined);

  const f2 = fakeInteractions('Theek hai, main ek episode plan karta hun.\nACTION: {"type":"start_goal","template":"littleloop_episode","title":"Diwali episode","goal":"Make a short Diwali LittleLoop reel"}');
  const r2 = await chat.send(env, db, [], { message: 'Ek Diwali reel banao' }, { fetch: f2 });
  assert.equal(f2.calls[0].body.previous_interaction_id, 'int_1', 'conversation continues server-side');
  assert.equal(f2.calls[0].body.tools, undefined);
  assert.equal(f2.calls[0].body.generation_config.thinking_level, 'low');
  assert.equal(r2.content, 'Theek hai, main ek episode plan karta hun.');
  assert.deepEqual(r2.action, { type: 'start_goal', template: 'littleloop_episode', title: 'Diwali episode', goal: 'Make a short Diwali LittleLoop reel' });
  const h = await chat.history(db);
  assert.deepEqual(h.map((m) => m.role), ['user', 'assistant', 'user', 'assistant']);
  assert.equal(h[1].sources.length, 1);
  assert.equal(h[3].action.template, 'littleloop_episode');
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM provider_calls WHERE purpose = 'cbo_chat' AND status = 'success'").first()).n, 2);
  await chat.clear(db);
  assert.equal((await chat.history(db)).length, 0);
});

test('extractAction ignores unknown templates and malformed JSON', () => {
  assert.equal(chat.extractAction('x\nACTION: {"type":"start_goal","template":"nope","title":"a","goal":"b"}').action, null);
  assert.equal(chat.extractAction('x\nACTION: {bad').action, null);
  assert.equal(chat.extractAction('plain answer').text, 'plain answer');
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
