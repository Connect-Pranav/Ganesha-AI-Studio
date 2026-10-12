// Shared helpers for agent engines: storage + schema validation (no dependencies).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = join(ROOT, 'public', 'agent-data');

export const BRANDS = ['littleloop', 'sunverse', 'foliocraft', 'studio'];
export const AGENTS = ['narada_market_intelligence', 'ganesha_orchestrator', 'code_shakti'];
export const ENGINES = ['claude', 'gemini'];
export const LIMITS = { runs: 100, findings: 60, tasks: 80, events: 100 };

export function readJson(name) {
  return JSON.parse(readFileSync(join(DATA_DIR, name), 'utf8'));
}
export function writeJson(name, data) {
  writeFileSync(join(DATA_DIR, name), JSON.stringify(data, null, 2) + '\n');
}
export function readRegistry() {
  return JSON.parse(readFileSync(join(ROOT, 'agents', 'registry.json'), 'utf8'));
}
export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
export const stamp = () => nowIso().replace(/[-:]/g, '');

/* ---------------- validation ---------------- */
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function check(errors, cond, msg) {
  if (!cond) errors.push(msg);
}
const isStr = (v, max = 10000) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const isIso = (v) => typeof v === 'string' && ISO.test(v) && !Number.isNaN(Date.parse(v));
const isUrl = (v) => {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
};
const oneOf = (v, list) => list.includes(v);

export function validateRun(r, where = 'run') {
  const e = [];
  check(e, isStr(r?.id, 120), `${where}.id`);
  check(e, oneOf(r?.agent, AGENTS), `${where}.agent`);
  check(e, oneOf(r?.engine, ENGINES), `${where}.engine`);
  check(e, isIso(r?.startedAt), `${where}.startedAt`);
  check(e, isIso(r?.finishedAt), `${where}.finishedAt`);
  check(e, oneOf(r?.status, ['success', 'failed', 'partial']), `${where}.status`);
  check(e, isStr(r?.summary, 300), `${where}.summary`);
  if (r?.status !== 'success') check(e, isStr(r?.error, 1000), `${where}.error required when not success`);
  return e;
}

export function validateFinding(f, where = 'finding') {
  const e = [];
  check(e, isStr(f?.id, 120), `${where}.id`);
  check(e, oneOf(f?.brand, BRANDS), `${where}.brand`);
  check(e, isStr(f?.title, 120), `${where}.title (<=120)`);
  check(e, isStr(f?.insight, 600), `${where}.insight (<=600)`);
  check(e, oneOf(f?.confidence, ['high', 'medium', 'low']), `${where}.confidence`);
  check(e, Array.isArray(f?.evidence) && f.evidence.length > 0, `${where}.evidence must be non-empty`);
  (f?.evidence ?? []).forEach((ev, i) => {
    check(e, isStr(ev?.title, 300), `${where}.evidence[${i}].title`);
    check(e, isUrl(ev?.url), `${where}.evidence[${i}].url`);
    check(e, isStr(ev?.source, 120), `${where}.evidence[${i}].source`);
    check(e, isIso(ev?.retrievedAt), `${where}.evidence[${i}].retrievedAt`);
  });
  check(e, oneOf(f?.agent, AGENTS), `${where}.agent`);
  check(e, oneOf(f?.engine, ENGINES), `${where}.engine`);
  check(e, isIso(f?.createdAt), `${where}.createdAt`);
  return e;
}

export function validateTask(t, where = 'task') {
  const e = [];
  check(e, isStr(t?.id, 120), `${where}.id`);
  check(e, isStr(t?.title, 120), `${where}.title (<=120)`);
  check(e, oneOf(t?.brand, BRANDS), `${where}.brand`);
  check(e, oneOf(t?.agent, AGENTS), `${where}.agent`);
  check(e, oneOf(t?.status, ['queued', 'in_progress', 'review', 'done']), `${where}.status`);
  check(e, oneOf(t?.priority, ['high', 'medium', 'low']), `${where}.priority`);
  check(e, isStr(t?.reason, 600), `${where}.reason`);
  check(e, Array.isArray(t?.sourceFindings), `${where}.sourceFindings`);
  check(e, typeof t?.requiresApproval === 'boolean', `${where}.requiresApproval`);
  check(e, isIso(t?.createdAt), `${where}.createdAt`);
  check(e, oneOf(t?.createdBy, AGENTS), `${where}.createdBy`);
  check(e, oneOf(t?.engine, ENGINES), `${where}.engine`);
  if (t?.prUrl !== undefined) check(e, isUrl(t.prUrl), `${where}.prUrl`);
  return e;
}

export function validateEvent(ev, where = 'event') {
  const e = [];
  check(e, isStr(ev?.id, 120), `${where}.id`);
  check(e, isIso(ev?.at), `${where}.at`);
  check(e, oneOf(ev?.brand, BRANDS), `${where}.brand`);
  check(e, ev?.agent === null || oneOf(ev?.agent, AGENTS), `${where}.agent`);
  check(e, ev?.engine === null || oneOf(ev?.engine, ENGINES), `${where}.engine`);
  check(e, oneOf(ev?.kind, ['research', 'task', 'code', 'system']), `${where}.kind`);
  check(e, isStr(ev?.text, 200), `${where}.text (<=200)`);
  return e;
}

/** Validates all four stores. Returns a list of error strings (empty = valid). */
export function validateAll() {
  const errors = [];
  const load = (name) => {
    try {
      return readJson(name);
    } catch (err) {
      errors.push(`${name}: cannot parse (${err.message})`);
      return null;
    }
  };
  const runs = load('runs.json');
  const research = load('research.json');
  const tasks = load('tasks.json');
  const activity = load('activity.json');

  const each = (file, list, key, fn) => {
    if (!Array.isArray(list)) return errors.push(`${file}: "${key}" must be an array`);
    const ids = new Set();
    list.forEach((item, i) => {
      fn(item, `${file}.${key}[${i}]`).forEach((m) => errors.push(m));
      if (ids.has(item?.id)) errors.push(`${file}.${key}[${i}].id duplicate "${item.id}"`);
      ids.add(item?.id);
    });
  };
  if (runs) each('runs.json', runs.runs, 'runs', validateRun);
  if (research) each('research.json', research.findings, 'findings', validateFinding);
  if (tasks) each('tasks.json', tasks.tasks, 'tasks', validateTask);
  if (activity) each('activity.json', activity.events, 'events', validateEvent);

  if (research && tasks && Array.isArray(research.findings) && Array.isArray(tasks.tasks)) {
    const fids = new Set(research.findings.map((f) => f.id));
    tasks.tasks.forEach((t, i) => {
      if (t.createdBy === 'ganesha_orchestrator' && (!t.sourceFindings?.length))
        errors.push(`tasks.json.tasks[${i}] created by GANESHA must cite sourceFindings`);
      (t.sourceFindings ?? []).forEach((fid) => {
        if (!fids.has(fid) && research.findings.length >= LIMITS.findings) return; // may have been trimmed
        if (!fids.has(fid)) errors.push(`tasks.json.tasks[${i}] cites unknown finding "${fid}"`);
      });
    });
  }
  return errors;
}

/** Prepend items and trim to limit (newest first). */
export function prependTrim(list, items, limit) {
  return [...items, ...list].slice(0, limit);
}
