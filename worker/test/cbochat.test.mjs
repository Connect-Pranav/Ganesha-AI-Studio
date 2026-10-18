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

test('ChatGPT engine: Responses API with history, Think, Research, image, start_goal tool proposal (mocked)', async () => {
  const env = { OPENAI_API_KEY: 'sk-proj-chatTESTKEY0123456789', MEDIA };
  const e = chat.engines(env).find((x) => x.id === 'openai');
  assert.equal(e.available, true);
  assert.ok(e.think && e.research && e.images && e.stream);
  const bodies = [];
  const reply = (output) => async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: 'r', status: 'completed', output, usage: { input_tokens: 50, output_tokens: 5 } }), { status: 200, headers: { 'x-request-id': 'req_chat' } });
  };
  const msg = (text, cite) => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text, annotations: cite ? [{ type: 'url_citation', url: 'https://example.com/t', title: 'Trend' }] : [] }] });
  const r1 = await chat.send(env, db, [], { message: 'hello', engine: 'openai', think: true, research: true, image: 'data:image/png;base64,iVBORw0KGgo=' }, { fetch: reply([msg('Namaste!', true)]) });
  assert.equal(r1.content, 'Namaste!');
  assert.equal(r1.engine, 'openai');
  assert.equal(r1.sources[0].url, 'https://example.com/t');
  assert.deepEqual(r1.mode, { think: true, research: true, image: true, fallback: null, requestId: 'req_chat', incomplete: null });
  const b1 = bodies[0];
  assert.match(b1.instructions, /LIVE STUDIO SNAPSHOT/);
  assert.deepEqual(b1.reasoning, { effort: 'high' });
  assert.equal(b1.tools[0].type, 'web_search');
  assert.equal(b1.tools[1].name, 'start_goal');
  assert.equal(b1.store, false);
  assert.equal(b1.input.at(-1).content[1].type, 'input_image');

  const tool = { type: 'function_call', call_id: 'c1', name: 'start_goal', arguments: JSON.stringify({ template: 'littleloop_episode', title: 'Diwali reel', goal: 'Make a Diwali reel' }) };
  const r2 = await chat.send(env, db, [], { message: 'Ek Diwali reel banao', engine: 'openai' }, { fetch: reply([tool]) });
  assert.deepEqual(bodies[1].reasoning, { effort: 'low' });
  assert.equal(bodies[1].tools.length, 1, 'no web search unless Research is on');
  assert.deepEqual(bodies[1].input.slice(0, 2).map((m) => m.role), ['user', 'assistant'], 'earlier turns sent as history');
  assert.deepEqual(r2.action, { type: 'start_goal', template: 'littleloop_episode', title: 'Diwali reel', goal: 'Make a Diwali reel' });
  assert.match(r2.content, /Proposed goal/);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM workflows").first()).n, 0, 'a tool call only proposes; nothing starts');

  const bad = { ...tool, arguments: JSON.stringify({ template: 'nope', title: 'x', goal: 'y' }) };
  assert.equal((await chat.send(env, db, [], { message: 'x', engine: 'openai' }, { fetch: reply([bad, msg('ok')]) })).action, null);
  await assert.rejects(chat.send({ GEMINI_API_KEY: 'g', MEDIA }, db, [], { message: 'x', image: 'data:image/png;base64,AAAA' }), /switch to ChatGPT/);
  await assert.rejects(chat.send(env, db, [], { message: 'x', engine: 'openai', image: 'https://example.com/a.png' }), /PNG\/JPEG/);
});

test('ChatGPT engine: streaming deltas; quota errors map to a clear 402 and never fall back to another engine', async () => {
  const env = { OPENAI_API_KEY: 'sk-proj-chatTESTKEY0123456789', GEMINI_API_KEY: 'g', MEDIA };
  const enc = new TextEncoder();
  const stream = async () =>
    new Response(
      new ReadableStream({
        start(c) {
          for (const ev of [{ type: 'response.output_text.delta', delta: 'Hi ' }, { type: 'response.output_text.delta', delta: 'there' }, { type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hi there' }] }], usage: { input_tokens: 9, output_tokens: 2 } } }])
            c.enqueue(enc.encode(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`));
          c.close();
        },
      }),
      { status: 200 },
    );
  const parts = [];
  const r = await chat.send(env, db, [], { message: 'hey', engine: 'openai' }, { fetch: stream }, { onDelta: (t) => parts.push(t) });
  assert.deepEqual(parts, ['Hi ', 'there']);
  assert.equal(r.content, 'Hi there');
  let calls = 0;
  const quota = async (url) => {
    calls++;
    assert.match(url, /api\.openai\.com/, 'no silent switch to Gemini');
    return new Response(JSON.stringify({ error: { code: 'insufficient_quota', type: 'insufficient_quota', message: 'You exceeded your current quota' } }), { status: 429 });
  };
  await assert.rejects(chat.send(env, db, [], { message: 'hey', engine: 'openai' }, { fetch: quota, sleep: noSleep }), (e) => e.status === 402 && /quota/.test(e.message));
  assert.equal(calls, 1);
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
