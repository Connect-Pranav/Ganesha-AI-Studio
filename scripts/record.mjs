// Records agent output into public/agent-data with ids/timestamps filled in and
// strict validation. Used by the Claude engine (scheduled tasks).
//
//   node scripts/record.mjs --engine claude --file out.json
//
// out.json may contain any of:
// {
//   "findings": [{ "brand", "title", "insight", "confidence", "evidence": [{ "title","url","source","retrievedAt" }] }],
//   "tasks":    [{ "brand", "title", "agent", "priority", "reason", "sourceFindings": [], "requiresApproval" }],
//   "taskUpdates": [{ "id", "status", "prUrl"? }],
//   "events":   [{ "brand", "agent", "kind", "text" }],
//   "runs":     [{ "agent", "startedAt", "status", "summary", "error"? }]
// }
// Findings may use a temporary "ref" (e.g. "lit1") that tasks cite in sourceFindings;
// refs are replaced with the real finding ids. Any invalid item aborts with no write.
import { readFileSync } from 'node:fs';
import {
  readJson,
  writeJson,
  nowIso,
  stamp,
  validateFinding,
  validateTask,
  validateEvent,
  validateRun,
  validateAll,
  prependTrim,
  LIMITS,
  ENGINES,
} from './lib.mjs';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const engine = arg('engine');
const file = arg('file');
if (!ENGINES.includes(engine) || !file) {
  console.error('Usage: node scripts/record.mjs --engine claude|gemini --file out.json');
  process.exit(2);
}

const input = JSON.parse(readFileSync(file, 'utf8'));
const errors = [];
const now = nowIso();
const s = stamp();
let n = 0;

const refMap = {};
const findings = (input.findings ?? []).map((f) => {
  const id = `f_${s}_${f.brand}_${++n}_${engine}`;
  if (f.ref) refMap[f.ref] = id;
  const out = {
    id,
    brand: f.brand,
    title: f.title,
    insight: f.insight,
    confidence: f.confidence,
    evidence: f.evidence,
    agent: 'narada_market_intelligence',
    engine,
    createdAt: now,
  };
  validateFinding(out, `findings[${n}]`).forEach((e) => errors.push(e));
  return out;
});

const research = readJson('research.json');
const knownFindings = new Set([...research.findings.map((f) => f.id), ...findings.map((f) => f.id)]);

const tasks = (input.tasks ?? []).map((t, i) => {
  const out = {
    id: `t_${s}_${t.brand}_${i + 1}_${engine}`,
    title: t.title,
    brand: t.brand,
    agent: t.agent,
    status: 'queued',
    priority: t.priority,
    reason: t.reason,
    sourceFindings: (t.sourceFindings ?? []).map((r) => refMap[r] ?? r),
    requiresApproval: Boolean(t.requiresApproval),
    createdAt: now,
    createdBy: 'ganesha_orchestrator',
    engine,
  };
  validateTask(out, `tasks[${i}]`).forEach((e) => errors.push(e));
  if (!out.sourceFindings.length) errors.push(`tasks[${i}] needs at least one sourceFindings id`);
  out.sourceFindings.forEach((fid) => knownFindings.has(fid) || errors.push(`tasks[${i}] cites unknown finding ${fid}`));
  return out;
});

const events = (input.events ?? []).map((e, i) => {
  const out = { id: `e_${s}_${i + 1}_${engine}`, at: now, brand: e.brand, agent: e.agent ?? null, engine, kind: e.kind, text: e.text };
  validateEvent(out, `events[${i}]`).forEach((m) => errors.push(m));
  return out;
});

const runs = (input.runs ?? []).map((r, i) => {
  const out = {
    id: `run_${s}_${String(r.agent).split('_')[0]}_${engine}_${i + 1}`,
    agent: r.agent,
    engine,
    startedAt: r.startedAt ?? now,
    finishedAt: now,
    status: r.status,
    summary: r.summary,
    ...(r.error ? { error: r.error } : {}),
  };
  validateRun(out, `runs[${i}]`).forEach((m) => errors.push(m));
  return out;
});

const tasksStore = readJson('tasks.json');
for (const [i, u] of (input.taskUpdates ?? []).entries()) {
  const t = tasksStore.tasks.find((x) => x.id === u.id);
  if (!t) {
    errors.push(`taskUpdates[${i}] unknown task ${u.id}`);
    continue;
  }
  if (u.status) t.status = u.status;
  if (u.prUrl) t.prUrl = u.prUrl;
  validateTask(t, `taskUpdates[${i}]`).forEach((m) => errors.push(m));
}

if (errors.length) {
  console.error(`Nothing written — ${errors.length} validation error(s):`);
  errors.forEach((e) => console.error(' - ' + e));
  process.exit(1);
}

if (findings.length) {
  research.findings = prependTrim(research.findings, findings, LIMITS.findings);
  research.updatedAt = now;
  writeJson('research.json', research);
}
if (tasks.length || (input.taskUpdates ?? []).length) {
  tasksStore.tasks = prependTrim(tasksStore.tasks, tasks, LIMITS.tasks);
  tasksStore.updatedAt = now;
  writeJson('tasks.json', tasksStore);
}
if (events.length) {
  const a = readJson('activity.json');
  a.events = prependTrim(a.events, events, LIMITS.events);
  writeJson('activity.json', a);
}
if (runs.length) {
  const r = readJson('runs.json');
  r.runs = prependTrim(r.runs, runs, LIMITS.runs);
  writeJson('runs.json', r);
}

const all = validateAll();
if (all.length) {
  console.error('Stores invalid after write:\n - ' + all.join('\n - '));
  process.exit(1);
}
console.log(
  `Recorded ${findings.length} findings, ${tasks.length} tasks, ${(input.taskUpdates ?? []).length} task updates, ${events.length} events, ${runs.length} runs (${engine}).`,
);
for (const [ref, id] of Object.entries(refMap)) console.log(`  ${ref} -> ${id}`);
