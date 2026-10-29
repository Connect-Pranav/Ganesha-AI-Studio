// AGENTVERSE brain endpoint: owner-only, free engines only (Gemini → Groq), never a paid engine. Providers are MOCKED.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getBindings, disposeDb, resetDb } from './helpers.mjs';
import worker from '../index.mjs';

let db;
before(async () => ({ DB: db } = await getBindings()));
after(disposeDb);
beforeEach(() => resetDb(db));
const ctx = { waitUntil: (p) => p.catch(() => {}) };
const H = { authorization: 'Bearer t', 'content-type': 'application/json' };
const call = (env, body, headers = H) => worker.fetch(new Request('https://g.test/api/agentverse/chat', { method: 'POST', headers, body: JSON.stringify(body) }), env, ctx);

test('agentverse chat: owner-only, Gemini first, falls back to Groq, never calls Claude', async (t) => {
  const hits = [];
  const real = globalThis.fetch;
  t.after(() => { globalThis.fetch = real; });
  globalThis.fetch = async (url) => {
    const u = String(url);
    hits.push(u.includes('anthropic') ? 'claude' : u.includes('groq') ? 'groq' : 'gemini');
    if (u.includes('generativelanguage')) return new Response('{"error":{"code":429}}', { status: 429 });
    if (u.includes('groq')) return new Response(JSON.stringify({ choices: [{ message: { content: '{"reply":"Haan"}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2 } }), { status: 200 });
    return new Response('{}', { status: 500 });
  };
  const env = { DB: db, ASSETS: { fetch: async () => new Response('ok') }, ADMIN_TOKEN: 't', GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q', ANTHROPIC_API_KEY: 'paid', GEMINI_FALLBACK_MODELS: '' };
  assert.equal((await call(env, { prompt: 'hi' }, { 'content-type': 'application/json' })).status, 401);
  assert.equal((await call(env, { prompt: '' })).status, 400);
  const r = await call(env, { system: 'You are VANI', prompt: 'status batao', quick: true });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.provider, 'groq');
  assert.deepEqual(j.json, { reply: 'Haan' });
  assert.ok(hits.includes('gemini') && hits.includes('groq'));
  assert.ok(!hits.includes('claude'), 'paid Claude key is never used by AGENTVERSE');
});

test('agentverse chat: clear 503 when no free key is set', async () => {
  const env = { DB: db, ASSETS: { fetch: async () => new Response('ok') }, ADMIN_TOKEN: 't', ANTHROPIC_API_KEY: 'paid' };
  const r = await call(env, { prompt: 'hi' });
  assert.equal(r.status, 503);
  assert.match((await r.json()).error, /GEMINI_API_KEY or GROQ_API_KEY/);
});
