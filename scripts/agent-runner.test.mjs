// Gemini runner tests — retry policy (A2) and failure exit code (A1).
// No network: fetch and sleep are replaced through the runner's `deps` object.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './lib.mjs';
import { deps, callGemini, retryDelayMs, parseRetryAfter, isQuotaExhausted, RETRY } from './agent-runner.mjs';

const ok = (obj) => ({ ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }) });
const err = (status, body, headers = {}) => ({ ok: false, status, headers: new Headers(headers), text: async () => body });

function withMocks(responses, fn) {
  const saved = { ...deps };
  const waits = [];
  let calls = 0;
  deps.fetch = async () => {
    const r = responses[Math.min(calls, responses.length - 1)];
    calls++;
    return typeof r === 'function' ? r() : r;
  };
  deps.sleep = async (ms) => void waits.push(ms);
  deps.random = () => 0.5; // jitter factor 0
  return Promise.resolve(fn())
    .then((v) => ({ v, waits, calls: () => calls }))
    .finally(() => Object.assign(deps, saved));
}

/* ---------- A2: retry policy ---------- */
test('retry: schedule 5s → 20s → 60s with bounded jitter', () => {
  assert.equal(retryDelayMs(0, null, () => 0.5), 5_000);
  assert.equal(retryDelayMs(1, null, () => 0.5), 20_000);
  assert.equal(retryDelayMs(2, null, () => 0.5), 60_000);
  assert.equal(retryDelayMs(0, null, () => 0), 4_000);
  assert.equal(retryDelayMs(0, null, () => 1), 6_000);
  assert.ok(retryDelayMs(2, null, () => 1) <= RETRY.maxWaitMs);
});

test('retry: Retry-After (seconds or HTTP date) overrides the schedule, capped', () => {
  assert.equal(parseRetryAfter('7'), 7_000);
  assert.equal(parseRetryAfter(new Date(10_000).toUTCString(), 0), 10_000);
  assert.equal(parseRetryAfter('garbage'), null);
  assert.equal(parseRetryAfter(null), null);
  assert.equal(retryDelayMs(0, 7_000), 7_000);
  assert.equal(retryDelayMs(0, 600_000), RETRY.maxWaitMs);
});

test('retry: quota-exhausted 429 is detected, plain rate-limit 429 is not', () => {
  assert.ok(isQuotaExhausted(429, '{"error":{"message":"You exceeded your current quota, please check your plan"}}'));
  assert.ok(!isQuotaExhausted(429, '{"error":{"message":"Resource has been exhausted (e.g. check quota)."}}'));
  assert.ok(!isQuotaExhausted(503, 'exceeded your current quota'));
});

test('callGemini: 503 then 200 succeeds after one backoff wait', async () => {
  const { v, waits, calls } = await withMocks([err(503, 'overloaded'), ok({ findings: [] })], () => callGemini('p', {}, 2));
  assert.deepEqual(v, { findings: [] });
  assert.deepEqual(waits, [5_000]);
  assert.equal(calls(), 2);
});

test('callGemini: Retry-After header is honoured', async () => {
  const { waits } = await withMocks([err(429, 'rate limited', { 'retry-after': '3' }), ok({ tasks: [] })], () => callGemini('p', {}, 2));
  assert.deepEqual(waits, [3_000]);
});

test('callGemini: quota-exhausted 429 stops immediately with a clear message', async () => {
  const res = await withMocks([err(429, 'You exceeded your current quota')], async () => {
    await assert.rejects(callGemini('p', {}, 2), (e) => e.fatal === true && /quota exhausted/.test(e.message));
  });
  assert.equal(res.calls(), 1);
  assert.deepEqual(res.waits, []);
});

test('callGemini: persistent 503 gives up after maxRetries within the wait budget', async () => {
  const res = await withMocks([err(503, 'overloaded')], async () => {
    await assert.rejects(callGemini('p', {}, 2), /HTTP 503/);
  });
  assert.equal(res.calls(), 3);
  assert.deepEqual(res.waits, [5_000, 20_000]);
  assert.ok(res.waits.reduce((a, b) => a + b, 0) <= RETRY.budgetMs);
});

/* ---------- A1: a failed agent run makes the runner exit non-zero ---------- */
test('runner: Gemini 503 on every attempt → failed record written and exit code 2', async () => {
  // Run a copy of the runner against a copy of the data so the repo's live data is untouched.
  const dir = mkdtempSync(join(tmpdir(), 'ganesha-runner-'));
  try {
    for (const p of ['scripts', 'agents', 'public/agent-data']) cpSync(join(ROOT, p), join(dir, p), { recursive: true });
    const startIso = new Date().toISOString();
    const prevKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'test-key-not-real';
    let runner;
    try {
      runner = await import(pathToFileURL(join(dir, 'scripts/agent-runner.mjs')).href);
    } finally {
      if (prevKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = prevKey;
    }
    const rss = `<rss><channel><item><title>Test headline</title><link>https://example.com/a</link><source>Example</source><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`;
    let geminiCalls = 0;
    runner.deps.fetch = async (url) => {
      if (String(url).includes('news.google.com')) return { ok: true, status: 200, headers: new Headers(), text: async () => rss };
      geminiCalls++;
      return err(503, 'The model is overloaded.');
    };
    runner.deps.sleep = async () => {};
    runner.deps.random = () => 0.5;

    const code = await runner.main(['--agent', 'narada']);
    assert.equal(code, runner.EXIT_AGENT_FAILED);
    assert.equal(code, 2);
    assert.ok(geminiCalls >= 3, 'retried before failing');
    const runs = JSON.parse(readFileSync(join(dir, 'public/agent-data/runs.json'), 'utf8')).runs;
    assert.ok(runs[0].startedAt >= startIso.slice(0, 19), 'newest run is from this invocation');
    assert.equal(runs[0].agent, 'narada_market_intelligence');
    assert.equal(runs[0].engine, 'gemini');
    assert.equal(runs[0].status, 'failed');
    assert.match(runs[0].error, /HTTP 503/);

    assert.equal(await runner.main(['--agent', 'bogus']), 1, 'usage error is exit 1, distinct from agent failure');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
