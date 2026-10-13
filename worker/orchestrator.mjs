// GANESHA — persistent workflow orchestrator on D1.
// A request only creates/changes rows; work happens in short `tick`s (cron + waitUntil kicks).
// Safety: leases (no double execution), idempotency keys (no duplicate workflows),
// bounded attempts with backoff, gates route failures to the responsible step,
// approval steps stop until a human decides.
import templatesFile from '../agents/pipelines.json' with { type: 'json' };
import { agentById, buildAgentPrompt, validateAgentOutput } from './agents.mjs';
import { callProvider, ProviderError, PROVIDERS } from './providers.mjs';
import { HttpError, isoIn, newId, nowIso } from './util.mjs';

export const TEMPLATES = templatesFile.templates;
export const TASK_STATUSES = ['queued', 'running', 'waiting_for_approval', 'waiting_for_external_action', 'completed', 'failed', 'cancelled'];
const HOLD = new Set(['paused', 'cancelled', 'failed', 'completed']); // workflows that must not progress
const LEASE_MS = 10 * 60_000;

/* ---------------- helpers ---------------- */
async function event(db, workflowId, taskId, kind, message, data) {
  await db
    .prepare('INSERT INTO events (workflow_id, task_id, kind, message, data_json, created_at) VALUES (?,?,?,?,?,?)')
    .bind(workflowId, taskId, kind, String(message).slice(0, 1000), data ? JSON.stringify(data).slice(0, 4000) : null, nowIso())
    .run();
}

export async function getWorkflow(db, id) {
  const wf = await db.prepare('SELECT * FROM workflows WHERE id = ?').bind(id).first();
  if (!wf) throw new HttpError(404, `Workflow ${id} not found`);
  return wf;
}
export async function getTasks(db, workflowId) {
  const { results } = await db.prepare('SELECT * FROM tasks WHERE workflow_id = ? ORDER BY created_at, rowid').bind(workflowId).all();
  return results.map((t) => ({ ...t, depends_on: JSON.parse(t.depends_on) }));
}

/** Workflow status is derived from tasks unless the owner paused/cancelled it. */
export function deriveStatus(tasks) {
  const s = (x) => tasks.some((t) => t.status === x);
  if (s('failed')) return 'failed';
  if (tasks.every((t) => t.status === 'completed')) return 'completed';
  if (s('running')) return 'running';
  if (s('waiting_for_approval')) return 'waiting_for_approval';
  if (s('waiting_for_external_action')) return 'waiting_for_external_action';
  if (s('completed')) return 'running';
  return 'queued';
}

export async function refreshWorkflow(db, workflowId) {
  const wf = await getWorkflow(db, workflowId);
  if (wf.status === 'paused' || wf.status === 'cancelled') return wf.status;
  const status = deriveStatus(await getTasks(db, workflowId));
  if (status !== wf.status) {
    await db.prepare('UPDATE workflows SET status = ?, updated_at = ? WHERE id = ?').bind(status, nowIso(), workflowId).run();
    await event(db, workflowId, null, 'workflow_status', `Workflow ${wf.status} → ${status}`);
  }
  return status;
}

/* ---------------- create ---------------- */
export async function createWorkflow(db, { template, title, goal = '', input = {}, idempotencyKey = null, createdBy = 'owner' }) {
  const tpl = TEMPLATES[template];
  if (!tpl) throw new HttpError(400, `Unknown template "${template}". Known: ${Object.keys(TEMPLATES).join(', ')}`);
  if (typeof title !== 'string' || !title.trim() || title.length > 120) throw new HttpError(400, 'title is required (max 120 chars)');
  if (typeof goal !== 'string' || goal.length > 8000) throw new HttpError(400, 'goal must be a string (max 8000 chars)');
  if (idempotencyKey) {
    const existing = await db.prepare('SELECT id, status FROM workflows WHERE idempotency_key = ?').bind(idempotencyKey).first();
    if (existing) return { id: existing.id, status: existing.status, duplicate: true };
  }
  const id = newId('wf');
  const now = nowIso();
  const stmts = [
    db
      .prepare(`INSERT INTO workflows (id, template, brand, title, goal, input_json, status, idempotency_key, created_by, created_at, updated_at)
                VALUES (?,?,?,?,?,?,'queued',?,?,?,?)`)
      .bind(id, template, tpl.brand, title.trim(), goal, JSON.stringify(input), idempotencyKey, createdBy, now, now),
  ];
  for (const s of tpl.steps) {
    const agent = agentById(s.agent);
    if (!agent) throw new HttpError(500, `Template ${template} references unknown agent ${s.agent}`);
    stmts.push(
      db
        .prepare(`INSERT INTO tasks (id, workflow_id, step_key, agent_id, deliverable, depends_on, is_gate, needs_approval, status, attempts, max_attempts, created_at, updated_at)
                  VALUES (?,?,?,?,?,?,?,?,'queued',0,?,?,?)`)
        .bind(newId('tk'), id, s.key, s.agent, s.deliverable, JSON.stringify(s.dependsOn ?? []), s.gate ? 1 : 0, s.approval ? 1 : 0, agent.maxRetries + 1, now, now),
    );
  }
  try {
    await db.batch(stmts); // atomic
  } catch (e) {
    // Concurrent request with the same idempotency key won the race.
    if (idempotencyKey && /UNIQUE/i.test(e.message)) {
      const existing = await db.prepare('SELECT id, status FROM workflows WHERE idempotency_key = ?').bind(idempotencyKey).first();
      if (existing) return { id: existing.id, status: existing.status, duplicate: true };
    }
    throw e;
  }
  await event(db, id, null, 'workflow_created', `Created from template ${template}`, { steps: tpl.steps.length });
  return { id, status: 'queued', duplicate: false };
}

/* ---------------- scheduling ---------------- */
/** Releases leases whose worker died (deploy, crash, timeout). */
export async function reclaimExpiredLeases(db) {
  const now = nowIso();
  const { results } = await db.prepare("SELECT id, workflow_id, attempts, max_attempts FROM tasks WHERE status = 'running' AND lease_expires_at < ?").bind(now).all();
  for (const t of results) {
    const exhausted = t.attempts >= t.max_attempts;
    await db
      .prepare(`UPDATE tasks SET status = ?, lease_owner = NULL, lease_expires_at = NULL, error = ?, updated_at = ?, finished_at = ? WHERE id = ? AND status = 'running' AND lease_expires_at < ?`)
      .bind(exhausted ? 'failed' : 'queued', 'Lease expired before the task finished (worker interrupted).', now, exhausted ? now : null, t.id, now)
      .run();
    await event(db, t.workflow_id, t.id, 'lease_expired', exhausted ? 'Lease expired; attempts exhausted' : 'Lease expired; re-queued');
    await refreshWorkflow(db, t.workflow_id);
  }
  return results.length;
}

/** Tasks whose dependencies are all completed, in workflows allowed to progress. */
export async function findReadyTasks(db, limit) {
  const now = nowIso();
  const { results } = await db
    .prepare(`SELECT t.* FROM tasks t JOIN workflows w ON w.id = t.workflow_id
              WHERE t.status = 'queued' AND (t.next_attempt_at IS NULL OR t.next_attempt_at <= ?)
                AND w.status NOT IN ('paused','cancelled','failed','completed')
              ORDER BY t.created_at LIMIT 200`)
    .bind(now)
    .all();
  const ready = [];
  const cache = new Map();
  for (const t of results) {
    if (!cache.has(t.workflow_id)) {
      const { results: all } = await db.prepare('SELECT step_key, status FROM tasks WHERE workflow_id = ?').bind(t.workflow_id).all();
      cache.set(t.workflow_id, new Map(all.map((r) => [r.step_key, r.status])));
    }
    const statuses = cache.get(t.workflow_id);
    if (JSON.parse(t.depends_on).every((d) => statuses.get(d) === 'completed')) ready.push({ ...t, depends_on: JSON.parse(t.depends_on) });
    if (ready.length >= limit) break;
  }
  return ready;
}

/** Atomically takes a lease. Returns true only for the single winner. */
export async function claimTask(db, taskId, owner) {
  const now = nowIso();
  const r = await db
    .prepare(`UPDATE tasks SET status = 'running', lease_owner = ?, lease_expires_at = ?, attempts = attempts + 1,
              started_at = ?, error = NULL, updated_at = ? WHERE id = ? AND status = 'queued' AND attempts < max_attempts`)
    .bind(owner, isoIn(LEASE_MS), now, now, taskId)
    .run();
  return r.meta.changes === 1;
}

/** Writes a result only if this worker still holds the lease (cancel/expiry wins otherwise). */
async function finishTask(db, task, owner, fields) {
  const cols = Object.keys(fields);
  const r = await db
    .prepare(`UPDATE tasks SET ${cols.map((c) => `${c} = ?`).join(', ')}, lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
              WHERE id = ? AND status = 'running' AND lease_owner = ?`)
    .bind(...cols.map((c) => fields[c]), nowIso(), task.id, owner)
    .run();
  return r.meta.changes === 1;
}

async function latestArtifact(db, taskId) {
  return db.prepare('SELECT * FROM artifacts WHERE task_id = ? ORDER BY version DESC LIMIT 1').bind(taskId).first();
}

async function saveArtifact(db, task, kind, content) {
  const row = await db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM artifacts WHERE task_id = ?').bind(task.id).first();
  const id = newId('ar');
  await db
    .prepare('INSERT INTO artifacts (id, workflow_id, task_id, agent_id, kind, version, content_json, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .bind(id, task.workflow_id, task.id, task.agent_id, kind, row.v + 1, JSON.stringify(content), nowIso())
    .run();
  return id;
}

/** Engine order: D1 override → registry. Fallback to the other provider only when explicitly allowed. */
export async function enginesFor(db, env, agent) {
  const o = await db.prepare('SELECT engines FROM agent_settings WHERE agent_id = ?').bind(agent.id).first();
  const primary = o ? JSON.parse(o.engines) : agent.engines;
  const list = primary.filter((e) => PROVIDERS.includes(e));
  if (env.ALLOW_PROVIDER_FALLBACK === 'true') for (const p of PROVIDERS) if (!list.includes(p)) list.push(p);
  return list;
}

/* ---------------- execution ---------------- */
async function executeTask(env, db, task, owner, deps) {
  const agent = agentById(task.agent_id);
  const wf = await getWorkflow(db, task.workflow_id);
  const siblings = await getTasks(db, task.workflow_id);
  const upstream = [];
  for (const key of task.depends_on) {
    const dep = siblings.find((s) => s.step_key === key);
    const art = dep && (await latestArtifact(db, dep.id));
    if (!art) throw new ProviderError(`Upstream step ${key} has no saved output`, { kind: 'bad_output' });
    const c = JSON.parse(art.content_json);
    upstream.push({ step_key: key, agent_id: dep.agent_id, deliverable: dep.deliverable, content: c.deliverable ?? JSON.stringify(c, null, 2) });
  }
  const { system, prompt } = buildAgentPrompt({ agent, task, workflow: wf, upstream });
  const engines = await enginesFor(db, env, agent);

  let result;
  const errors = [];
  for (const provider of engines) {
    try {
      result = await callProvider(env, db, provider, { system, prompt, json: true, maxTokens: 8000, purpose: 'task', taskId: task.id }, deps);
      break;
    } catch (e) {
      errors.push(e);
      // Only fall through to the next provider when this one is unavailable, not when the output was bad.
      if (!(e instanceof ProviderError) || !['not_configured', 'auth', 'rate_limited', 'server', 'timeout'].includes(e.kind)) break;
    }
  }
  if (!result) {
    if (!errors.length) throw new ProviderError(`No provider available for ${agent.id}`, { kind: 'not_configured' });
    if (errors.length === 1) throw errors[0];
    // Several providers failed: retry later if any failure was transient; report every cause.
    const retryable = errors.some((e) => e.retryable);
    throw new ProviderError(errors.map((e) => e.message).join(' | '), { retryable, kind: retryable ? 'server' : errors[0].kind });
  }

  const check = validateAgentOutput(agent, Boolean(task.is_gate), result.json);
  return { result, check, agent, siblings };
}

/** Steps to re-run after a gate fails: the fixed steps plus everything between them and the gate. */
export function stepsToRerun(tasks, gateKey, fixKeys) {
  const byKey = new Map(tasks.map((t) => [t.step_key, t]));
  const ancestors = new Set();
  const walk = (k) => {
    for (const d of byKey.get(k)?.depends_on ?? []) if (!ancestors.has(d)) (ancestors.add(d), walk(d));
  };
  walk(gateKey);
  const targets = fixKeys.filter((k) => ancestors.has(k) && !byKey.get(k).is_gate);
  const rerun = new Set(targets);
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of tasks)
      if (!rerun.has(t.step_key) && (ancestors.has(t.step_key) || t.step_key === gateKey) && t.depends_on.some((d) => rerun.has(d)))
        (rerun.add(t.step_key), (grew = true));
  }
  rerun.add(gateKey);
  return { targets, rerun: [...rerun] };
}

async function runOne(env, db, task, owner, deps) {
  let outcome;
  try {
    outcome = await executeTask(env, db, task, owner, deps);
  } catch (e) {
    const retryable = e instanceof ProviderError ? e.retryable || e.kind === 'bad_output' : false;
    const exhausted = task.attempts + 1 >= task.max_attempts;
    const failNow = !retryable || exhausted;
    await finishTask(db, task, owner, {
      status: failNow ? 'failed' : 'queued',
      error: String(e.message).slice(0, 1000),
      next_attempt_at: failNow ? null : isoIn(60_000 * 2 ** task.attempts),
      finished_at: failNow ? nowIso() : null,
    });
    await event(db, task.workflow_id, task.id, failNow ? 'task_failed' : 'task_retry', e.message);
    return refreshWorkflow(db, task.workflow_id);
  }

  const { result, check, siblings } = outcome;
  const base = { provider: result.provider, model: result.model };

  if (!check.ok) {
    const exhausted = task.attempts + 1 >= task.max_attempts;
    const msg = `Output failed verification: ${check.errors.join('; ')}`;
    if (check.value) await saveArtifact(db, task, 'rejected_output', check.value);
    await finishTask(db, task, owner, {
      ...base,
      status: exhausted ? 'failed' : 'queued',
      error: msg.slice(0, 1000),
      feedback: exhausted ? task.feedback : `Your previous output was rejected. Fix: ${check.errors.join('; ')}`.slice(0, 4000),
      next_attempt_at: exhausted ? null : isoIn(30_000),
      finished_at: exhausted ? nowIso() : null,
    });
    await event(db, task.workflow_id, task.id, exhausted ? 'task_failed' : 'task_retry', msg);
    return refreshWorkflow(db, task.workflow_id);
  }

  const artifactId = await saveArtifact(db, task, task.is_gate ? 'review' : 'deliverable', check.value);

  if (task.is_gate && check.value.verdict === 'fail') {
    const fixKeys = check.value.fixes.map((f) => f.step_key);
    const { targets, rerun } = stepsToRerun(siblings, task.step_key, fixKeys);
    const gateExhausted = task.attempts + 1 >= task.max_attempts;
    // Every step that must run again needs an attempt left, or the workflow would stall silently.
    const blocked = gateExhausted || targets.length === 0 || rerun.some((k) => {
      if (k === task.step_key) return false;
      const t = siblings.find((s) => s.step_key === k);
      return t.attempts >= t.max_attempts;
    });
    if (blocked) {
      await finishTask(db, task, owner, { ...base, status: 'failed', qa: 'fail', output_artifact: artifactId, finished_at: nowIso(),
        error: `Review failed and no correction attempts remain: ${check.value.issues.join('; ')}`.slice(0, 1000) });
      await event(db, task.workflow_id, task.id, 'gate_failed_final', 'Gate failed; needs human review', { issues: check.value.issues });
      return refreshWorkflow(db, task.workflow_id);
    }
    const won = await finishTask(db, task, owner, { ...base, status: 'queued', qa: 'fail', output_artifact: artifactId, error: null });
    if (!won) return refreshWorkflow(db, task.workflow_id);
    const now = nowIso();
    const stmts = [];
    for (const key of rerun) {
      if (key === task.step_key) continue;
      const fixes = check.value.fixes.filter((f) => f.step_key === key).map((f) => `- ${f.instruction}`).join('\n');
      const feedback = fixes ? `${task.agent_id} review requires:\n${fixes}` : `An upstream step was revised after ${task.agent_id} review; update your deliverable to match.`;
      stmts.push(
        db.prepare(`UPDATE tasks SET status = 'queued', feedback = ?, next_attempt_at = NULL, finished_at = NULL, updated_at = ? WHERE workflow_id = ? AND step_key = ? AND status = 'completed'`)
          .bind(feedback.slice(0, 4000), now, task.workflow_id, key),
      );
    }
    if (stmts.length) await db.batch(stmts);
    await event(db, task.workflow_id, task.id, 'gate_failed', `Routed corrections to: ${targets.join(', ')}`, { issues: check.value.issues });
    return refreshWorkflow(db, task.workflow_id);
  }

  if (task.needs_approval) {
    const won = await finishTask(db, task, owner, { ...base, status: 'waiting_for_approval', output_artifact: artifactId, error: null });
    if (won) {
      await db
        .prepare(`INSERT INTO approvals (id, workflow_id, task_id, action, summary, status, created_at) VALUES (?,?,?,?,?,'pending',?)`)
        .bind(newId('ap'), task.workflow_id, task.id, `${task.step_key}`, String(check.value.summary).slice(0, 500), nowIso())
        .run();
      await event(db, task.workflow_id, task.id, 'approval_requested', `Approval needed for ${task.step_key}`);
    }
    return refreshWorkflow(db, task.workflow_id);
  }

  await finishTask(db, task, owner, { ...base, status: 'completed', qa: task.is_gate ? 'pass' : null, output_artifact: artifactId, error: null, feedback: null, finished_at: nowIso() });
  await event(db, task.workflow_id, task.id, 'task_completed', String(check.value.summary).slice(0, 300));
  return refreshWorkflow(db, task.workflow_id);
}

/** One orchestration pass. Safe to run concurrently: leases decide who executes. */
export async function tick(env, db, deps = {}) {
  const owner = newId('lease');
  const reclaimed = await reclaimExpiredLeases(db);
  const limit = Math.max(1, Math.min(Number(env.MAX_CONCURRENT_TASKS) || 3, 6));
  const ready = await findReadyTasks(db, limit);
  const claimed = [];
  for (const t of ready) if (await claimTask(db, t.id, owner)) claimed.push(t);
  await Promise.allSettled(claimed.map((t) => runOne(env, db, t, owner, deps)));
  return { reclaimed, ran: claimed.map((t) => `${t.workflow_id}:${t.step_key}`) };
}

/* ---------------- owner actions ---------------- */
export async function decideApproval(db, approvalId, decision, { by = 'owner', note = null } = {}) {
  if (!['approved', 'rejected'].includes(decision)) throw new HttpError(400, 'decision must be approved or rejected');
  const ap = await db.prepare('SELECT * FROM approvals WHERE id = ?').bind(approvalId).first();
  if (!ap) throw new HttpError(404, 'Approval not found');
  const now = nowIso();
  const r = await db
    .prepare("UPDATE approvals SET status = ?, decided_by = ?, decided_at = ?, note = ? WHERE id = ? AND status = 'pending'")
    .bind(decision, by, now, note, approvalId)
    .run();
  if (r.meta.changes !== 1) throw new HttpError(409, `Approval already ${ap.status}`);
  if (decision === 'approved') {
    // No publishing integration is connected yet, so approval hands the action to a human
    // instead of pretending it happened. Phase 5 replaces this with the real YouTube upload.
    await db
      .prepare("UPDATE tasks SET status = 'waiting_for_external_action', updated_at = ? WHERE id = ? AND status = 'waiting_for_approval'")
      .bind(now, ap.task_id)
      .run();
    await event(db, ap.workflow_id, ap.task_id, 'approved', `Approved ${ap.action}; waiting for the action to be carried out`);
  } else {
    await db.batch([
      db.prepare("UPDATE tasks SET status = 'cancelled', updated_at = ?, finished_at = ? WHERE workflow_id = ? AND status NOT IN ('completed','failed')").bind(now, now, ap.workflow_id),
      db.prepare("UPDATE workflows SET status = 'cancelled', updated_at = ? WHERE id = ?").bind(now, ap.workflow_id),
    ]);
    await event(db, ap.workflow_id, ap.task_id, 'rejected', `Rejected ${ap.action}${note ? `: ${note}` : ''}`);
  }
  return refreshWorkflow(db, ap.workflow_id);
}

/** Owner confirms an external action (e.g. manual upload) actually happened. */
export async function completeExternalAction(db, taskId, { reference = null } = {}) {
  const t = await db.prepare('SELECT * FROM tasks WHERE id = ?').bind(taskId).first();
  if (!t) throw new HttpError(404, 'Task not found');
  if (t.status !== 'waiting_for_external_action') throw new HttpError(409, `Task is ${t.status}, not waiting_for_external_action`);
  const now = nowIso();
  await db.prepare("UPDATE tasks SET status = 'completed', finished_at = ?, updated_at = ? WHERE id = ? AND status = 'waiting_for_external_action'").bind(now, now, taskId).run();
  await event(db, t.workflow_id, t.id, 'external_action_done', `Owner confirmed ${t.step_key} done`, reference ? { reference } : null);
  return refreshWorkflow(db, t.workflow_id);
}

export async function setWorkflowState(db, id, action) {
  const wf = await getWorkflow(db, id);
  const now = nowIso();
  if (action === 'pause') {
    if (HOLD.has(wf.status)) throw new HttpError(409, `Cannot pause a ${wf.status} workflow`);
    await db.prepare("UPDATE workflows SET status = 'paused', updated_at = ? WHERE id = ?").bind(now, id).run();
  } else if (action === 'resume') {
    if (wf.status !== 'paused') throw new HttpError(409, 'Workflow is not paused');
    await db.prepare("UPDATE workflows SET status = 'queued', updated_at = ? WHERE id = ?").bind(now, id).run();
  } else if (action === 'cancel') {
    if (['completed', 'cancelled'].includes(wf.status)) throw new HttpError(409, `Workflow is already ${wf.status}`);
    await db.batch([
      db.prepare("UPDATE tasks SET status = 'cancelled', lease_owner = NULL, lease_expires_at = NULL, updated_at = ?, finished_at = ? WHERE workflow_id = ? AND status NOT IN ('completed','failed')").bind(now, now, id),
      db.prepare("UPDATE approvals SET status = 'rejected', decided_by = 'system', decided_at = ?, note = 'workflow cancelled' WHERE workflow_id = ? AND status = 'pending'").bind(now, id),
      db.prepare("UPDATE workflows SET status = 'cancelled', updated_at = ? WHERE id = ?").bind(now, id),
    ]);
  } else throw new HttpError(400, 'action must be pause, resume or cancel');
  await event(db, id, null, `workflow_${action}`, `Owner ${action}d the workflow`);
  return action === 'resume' ? refreshWorkflow(db, id) : action === 'pause' ? 'paused' : 'cancelled';
}

/** Gives a failed task a fresh set of attempts (e.g. after adding a missing API key). */
export async function retryTask(db, taskId) {
  const t = await db.prepare('SELECT * FROM tasks WHERE id = ?').bind(taskId).first();
  if (!t) throw new HttpError(404, 'Task not found');
  if (t.status !== 'failed') throw new HttpError(409, `Only failed tasks can be retried (task is ${t.status})`);
  const now = nowIso();
  await db.batch([
    db.prepare("UPDATE tasks SET status = 'queued', attempts = 0, next_attempt_at = NULL, finished_at = NULL, updated_at = ? WHERE id = ?").bind(now, taskId),
    db.prepare("UPDATE workflows SET status = 'queued', updated_at = ? WHERE id = ? AND status = 'failed'").bind(now, t.workflow_id),
  ]);
  await event(db, t.workflow_id, t.id, 'task_retry_manual', 'Owner retried the task');
  return refreshWorkflow(db, t.workflow_id);
}
