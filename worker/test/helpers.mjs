// Test helpers: a real local D1 (Miniflare via wrangler) and a scripted fake provider.
// These are MOCKED provider tests. They prove orchestration logic, not live connectivity.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPlatformProxy } from 'wrangler';
import { REGISTRY, agentById } from '../agents.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Every migration in order, and every rollback in reverse order.
const MIG_DIR = join(ROOT, 'migrations');
const MIGRATIONS = readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(join(MIG_DIR, f), 'utf8'));
const DOWNS = readdirSync(join(MIG_DIR, 'rollback')).filter((f) => f.endsWith('.sql')).sort().reverse().map((f) => readFileSync(join(MIG_DIR, 'rollback', f), 'utf8'));

const statements = (sql) =>
  sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

let proxy;
export async function getDb() {
  proxy ??= await getPlatformProxy({ configPath: join(ROOT, 'wrangler.jsonc'), persist: false });
  return proxy.env.DB;
}
export async function disposeDb() {
  await proxy?.dispose();
  proxy = undefined;
}
export async function resetDb(db) {
  for (const sql of DOWNS) await db.batch(statements(sql).map((s) => db.prepare(s)));
  for (const sql of MIGRATIONS) await db.batch(statements(sql).map((s) => db.prepare(s)));
}

export const ENV = { ANTHROPIC_API_KEY: 'sk-test-anthropic-SECRET', ANTHROPIC_MODEL: 'claude-test', GEMINI_API_KEY: '', MAX_CONCURRENT_TASKS: '6' };
export const noSleep = async () => {};

/** Builds a valid agent output for whichever agent the system prompt names. */
export function goodOutput(agentId, { verdict = 'pass', fixes = [] } = {}) {
  const a = agentById(agentId);
  const isGate = a.id === 'chitragupta_quality_audit' || a.id === 'ops_dharma_safety';
  if (isGate) return { verdict, summary: `Review ${verdict}`, issues: verdict === 'fail' ? ['Hook repeats an existing phrase'] : [], fixes };
  return {
    summary: `${a.name} delivered`,
    deliverable: `# ${a.name} deliverable\n\nOriginal content prepared for this step with enough detail to be usable by the next agent in the pipeline.`,
    acceptance: a.acceptance.map((c) => ({ criterion: c, met: true, note: '' })),
    open_questions: [],
  };
}

/**
 * Fake fetch for the Anthropic Messages API. `script(agentId, callNo)` returns
 * { output } | { status, body } | { throw }. Records calls for assertions.
 */
export function fakeAnthropic(script = () => ({})) {
  const calls = [];
  const perAgent = new Map();
  const fn = async (url, init) => {
    const body = JSON.parse(init.body);
    const agentId = /\(([a-z0-9_]+)\)/.exec(body.system)?.[1];
    const n = (perAgent.get(agentId) ?? 0) + 1;
    perAgent.set(agentId, n);
    calls.push({ url, agentId, n, headers: init.headers, prompt: body.messages[0].content });
    const s = script(agentId, n) ?? {};
    if (s.throw) throw s.throw;
    if (s.status) return new Response(s.body ?? 'error', { status: s.status, headers: s.headers ?? {} });
    const out = s.output ?? (agentId ? goodOutput(agentId) : { ok: true });
    return new Response(
      JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(out) }], stop_reason: 'end_turn', usage: { input_tokens: 120, output_tokens: 80 } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  fn.calls = calls;
  return fn;
}

export { REGISTRY };
