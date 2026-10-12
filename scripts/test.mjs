// Agent system tests — run with `npm test` (node:test, no dependencies).
// Covers: registry integrity, contracts, routing, pipeline templates, permissions,
// output validation and status rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {
  ROOT,
  readRegistry,
  readPipelineTemplates,
  derivePipelineStatus,
  validateFinding,
  validateTask,
  validateEvent,
  validatePipeline,
  validateAll,
} from './lib.mjs';
import { route } from './pipeline.mjs';

const reg = readRegistry();
const { templates, routing } = readPipelineTemplates();
const ids = reg.agents.map((a) => a.id);
const KNOWN_APPROVALS = ['publish_content', 'spend_money', 'deploy', 'merge_pull_request'];
const now = '2026-10-13T00:00:00Z';

/* ---------- registry ---------- */
test('registry: 31 agents with unique ids and names', () => {
  assert.equal(reg.agents.length, 31);
  assert.equal(new Set(ids).size, ids.length, 'duplicate id');
  assert.equal(new Set(reg.agents.map((a) => a.name)).size, ids.length, 'duplicate name');
});

test('registry: every agent has a complete contract', () => {
  for (const a of reg.agents) {
    for (const f of ['id', 'name', 'team', 'role', 'mission', 'contract']) assert.ok(a[f], `${a.id}.${f}`);
    assert.match(a.id, /^[a-z][a-z0-9_]+$/, `${a.id} id format`);
    assert.ok(reg.teams[a.team], `${a.id} unknown team`);
    assert.ok(a.inputs.length && a.outputs.length && a.acceptance.length, `${a.id} io/acceptance`);
    assert.ok(a.permissions.length, `${a.id} permissions`);
    assert.ok(a.engines.length && a.engines.every((e) => ['claude', 'gemini'].includes(e)), `${a.id} engines`);
    assert.ok(Number.isInteger(a.maxRetries) && a.maxRetries >= 0 && a.maxRetries <= 2, `${a.id} maxRetries`);
    assert.ok(a.approvalRequired.every((x) => KNOWN_APPROVALS.includes(x)), `${a.id} approval kinds`);
    assert.ok(existsSync(join(ROOT, a.contract)), `${a.id} contract file ${a.contract}`);
  }
});

test('permissions: only coders open PRs (with merge approval); no secrets; publishers need approval', () => {
  for (const a of reg.agents) {
    if (a.permissions.includes('open_pull_request')) assert.ok(['code_shakti', 'ops_agni_automation'].includes(a.id), a.id);
    if (a.permissions.includes('open_pull_request')) assert.ok(a.approvalRequired.includes('merge_pull_request'), `${a.id} must need merge approval`);
    assert.ok(!a.permissions.some((p) => /secret|credential|token/i.test(p)), `${a.id} must not hold secrets`);
  }
  const publishers = reg.agents.filter((a) => /release|growth analyst/i.test(a.role) && a.team !== 'ops');
  for (const a of publishers) assert.ok(a.approvalRequired.includes('publish_content'), `${a.id} must need publish approval`);
});

test('contracts: team files are generated from the current registry', () => {
  execFileSync('node', [join(ROOT, 'scripts', 'gen-contracts.mjs'), '--check'], { stdio: 'pipe' });
});

/* ---------- templates ---------- */
test('templates: agents exist, dependencies valid and acyclic', () => {
  for (const [name, t] of Object.entries(templates)) {
    const keys = t.steps.map((s) => s.key);
    assert.equal(new Set(keys).size, keys.length, `${name} duplicate step`);
    for (const s of t.steps) {
      assert.ok(ids.includes(s.agent), `${name}.${s.key} unknown agent ${s.agent}`);
      for (const d of s.dependsOn) assert.ok(keys.indexOf(d) >= 0 && keys.indexOf(d) < keys.indexOf(s.key), `${name}.${s.key} dep ${d} must come earlier`);
    }
    assert.equal(t.steps.at(-1).agent, 'samvada_handoffs', `${name} must end with SAMVADA handoff`);
  }
});

test('templates: gates are QA/safety agents; approval steps belong to agents that require approval', () => {
  for (const [name, t] of Object.entries(templates)) {
    for (const s of t.steps) {
      if (s.gate) assert.ok(['chitragupta_quality_audit', 'ops_dharma_safety'].includes(s.agent), `${name}.${s.key} gate agent`);
      if (s.approval) assert.ok(reg.agents.find((a) => a.id === s.agent).approvalRequired.length > 0, `${name}.${s.key} approval agent`);
    }
    if (t.brand !== 'studio') {
      assert.ok(t.steps.some((s) => s.agent === 'chitragupta_quality_audit'), `${name} needs CHITRAGUPTA`);
      assert.ok(t.steps.some((s) => s.approval), `${name} needs an approval stop`);
    }
  }
  assert.ok(templates.littleloop_episode.steps.some((s) => s.agent === 'ops_dharma_safety'), 'LittleLoop needs child-safety gate');
});

test('coverage: every agent except the orchestrator is used by a template', () => {
  const used = new Set(Object.values(templates).flatMap((t) => t.steps.map((s) => s.agent)));
  const unused = ids.filter((id) => !used.has(id) && id !== 'ganesha_orchestrator');
  assert.deepEqual(unused, []);
});

/* ---------- routing ---------- */
test('routing: labels win, keywords route, fallback is research', () => {
  assert.equal(route('Anything', ['sunverse']), 'sunverse_song_release');
  assert.equal(route('New monsoon love song'), 'sunverse_song_release');
  assert.equal(route('Kids episode about counting'), 'littleloop_episode');
  assert.equal(route('Add dark mode to the portfolio builder'), 'foliocraft_feature');
  assert.equal(route('Competitor research on pricing tools'), 'research_brief');
  assert.equal(route('Hello'), routing.fallback);
  for (const t of Object.values(routing.labels)) assert.ok(templates[t]);
});

/* ---------- output validation ---------- */
const ev = { title: 'x', url: 'https://example.com', source: 'S', retrievedAt: now };

test('validation: findings need retrieved evidence', () => {
  const f = { id: 'f1', brand: 'sunverse', title: 't', insight: 'i', confidence: 'low', evidence: [ev], agent: 'narada_market_intelligence', engine: 'claude', createdAt: now };
  assert.deepEqual(validateFinding(f), []);
  assert.ok(validateFinding({ ...f, evidence: [] }).length);
  assert.ok(validateFinding({ ...f, evidence: [{ ...ev, url: 'not-a-url' }] }).length);
  assert.ok(validateFinding({ ...f, brand: 'marvel' }).length);
});

test('validation: tasks and events reject unknown agents and long text', () => {
  const t = { id: 't1', title: 'x', brand: 'littleloop', agent: 'littleloop_vyasa_scriptwriter', status: 'queued', priority: 'low', reason: 'r', sourceFindings: ['f1'], requiresApproval: false, createdAt: now, createdBy: 'ganesha_orchestrator', engine: 'claude' };
  assert.deepEqual(validateTask(t), []);
  assert.ok(validateTask({ ...t, agent: 'rogue_agent' }).length);
  const e = { id: 'e1', at: now, brand: 'studio', agent: null, engine: null, kind: 'system', text: 'ok' };
  assert.deepEqual(validateEvent(e), []);
  assert.ok(validateEvent({ ...e, text: 'x'.repeat(201) }).length);
});

/* ---------- pipeline status ---------- */
const mk = (statuses, extra = {}) => ({
  id: 'p1', template: 'research_brief', brand: 'studio', title: 'T', goalRef: null, engine: 'claude', createdAt: now, updatedAt: now,
  steps: [
    { key: 'research', agent: 'narada_market_intelligence', dependsOn: [], status: statuses[0], attempts: 1 },
    { key: 'qa', agent: 'chitragupta_quality_audit', dependsOn: ['research'], gate: true, status: statuses[1], attempts: 1, ...extra },
    { key: 'handoff', agent: 'samvada_handoffs', dependsOn: ['qa'], status: statuses[2], attempts: 0 },
  ],
});

test('status: derived from steps', () => {
  assert.equal(derivePipelineStatus(mk(['pending', 'pending', 'pending']).steps), 'pending');
  assert.equal(derivePipelineStatus(mk(['completed', 'running', 'pending']).steps), 'running');
  assert.equal(derivePipelineStatus(mk(['completed', 'failed', 'pending']).steps), 'failed');
  assert.equal(derivePipelineStatus(mk(['completed', 'completed', 'completed']).steps), 'completed');
  const a = mk(['completed', 'completed', 'approval_required']).steps;
  assert.equal(derivePipelineStatus(a), 'approval_required');
});

test('status: validator blocks skipped dependencies and un-passed gates', () => {
  const good = mk(['completed', 'completed', 'running'], { qa: 'pass' });
  good.status = 'running';
  assert.deepEqual(validatePipeline(good), []);
  const skipped = mk(['pending', 'completed', 'pending'], { qa: 'pass' });
  skipped.status = derivePipelineStatus(skipped.steps);
  assert.ok(validatePipeline(skipped).some((m) => /dependencies not completed/.test(m)));
  const noPass = mk(['completed', 'completed', 'pending']);
  noPass.status = 'running';
  assert.ok(validatePipeline(noPass).some((m) => /gate completed without qa=pass/.test(m)));
  const wrongStatus = { ...good, status: 'completed' };
  assert.ok(validatePipeline(wrongStatus).some((m) => /derived/.test(m)));
});

/* ---------- live data ---------- */
test('live agent data in the repo is valid', () => {
  assert.deepEqual(validateAll(), []);
});
