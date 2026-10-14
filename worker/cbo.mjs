// GANESHA_CBO — executive layer over the GANESHA orchestrator (ganesha_orchestrator).
// CFO: preflight estimate → approval policy → atomic budget reservation → dispatch → reconcile actuals.
// Operations: lifecycle view, deadlines, workload, reassignment. Reporting: status report + commands.
// Everything is computed from D1 rows. Estimates are labelled as estimates; unknowns stay null.
import { REGISTRY, agentById, buildAgentPrompt } from './agents.mjs';
import { providerConfig } from './providers.mjs';
import { TEMPLATES, enginesFor, getTasks, getWorkflow, refreshWorkflow } from './orchestrator.mjs';
import { chargeFor, getSettings, monthStart, priceFor, subscriptionsMonthly, toInr, tokenCostUsd, SEEDED_PRICING } from './finance.mjs';
import { HttpError, newId, nowIso } from './util.mjs';

export const CBO_ID = 'GANESHA_CBO';
const DEFAULT_OUTPUT_TOKENS = 4000;
const DEFAULT_INPUT_TOKENS = 3000;
const DEFAULT_DURATION_SEC = 90;
const CHARS_PER_TOKEN = { claude: 3.0, gemini: 3.5 }; // Claude 4.7+ tokenizer yields ~30% more tokens per text

export async function audit(db, kind, message, data = null, workflowId = null, taskId = null) {
  await db
    .prepare('INSERT INTO events (workflow_id, task_id, kind, message, data_json, created_at) VALUES (?,?,?,?,?,?)')
    .bind(workflowId, taskId, kind, String(message).slice(0, 1000), data ? JSON.stringify(data).slice(0, 4000) : null, nowIso())
    .run();
}

/* ---------------- history (real records only) ---------------- */
async function agentHistory(db, agentId) {
  const tok = await db
    .prepare(`SELECT COUNT(*) AS n, AVG(pc.input_tokens) AS avg_in, AVG(pc.output_tokens) AS avg_out, MAX(pc.output_tokens) AS max_out
              FROM provider_calls pc JOIN tasks t ON t.id = pc.task_id
              WHERE t.agent_id = ? AND pc.status = 'success' AND pc.purpose = 'task' AND pc.output_tokens IS NOT NULL`)
    .bind(agentId)
    .first();
  const att = await db
    .prepare(`SELECT COUNT(*) AS n, AVG(attempts) AS avg_attempts,
              AVG((julianday(finished_at) - julianday(started_at)) * 86400) AS avg_sec
              FROM tasks WHERE agent_id = ? AND status = 'completed' AND started_at IS NOT NULL AND finished_at IS NOT NULL`)
    .bind(agentId)
    .first();
  return {
    samples: tok?.n ?? 0,
    avgIn: tok?.avg_in ?? null,
    avgOut: tok?.avg_out ?? null,
    maxOut: tok?.max_out ?? null,
    completed: att?.n ?? 0,
    avgAttempts: att?.avg_attempts ?? null,
    avgSec: att?.avg_sec ?? null,
  };
}

/* ---------------- estimates ---------------- */
/**
 * Pure estimate arithmetic (exported for tests). Inputs are token counts and the price row.
 * Returns USD + INR for a direct (expected) and a conservative (worst bounded) case.
 */
export function computeEstimate({ provider, model, inputTokens, outputTokens, history, remainingAttempts, price, tier, fx, maxOutputCap }) {
  const assumptions = [];
  const expectedCalls = history.avgAttempts ? Math.max(1, history.avgAttempts) : 1;
  const conservativeCalls = Math.max(1, Math.min(remainingAttempts, 3));
  const outConservative = Math.min(maxOutputCap ?? Infinity, Math.max(history.maxOut ?? 0, outputTokens * 2));
  const directUsdRaw = tokenCostUsd(price, inputTokens * expectedCalls, outputTokens * expectedCalls);
  const consUsdRaw = tokenCostUsd(price, inputTokens * conservativeCalls, outConservative * conservativeCalls);
  const direct = chargeFor(price, tier, directUsdRaw);
  const cons = chargeFor(price, tier, consUsdRaw);
  if (!price) assumptions.push(`No verified price for ${provider}/${model}: cost unknown. Add one in CFO → Pricing.`);
  else {
    assumptions.push(`Price ${price.input}/${price.output} USD per 1M input/output tokens (${price.origin}, verified ${price.verifiedAt}).`);
    if (direct.basis === 'free_tier') assumptions.push('You marked this provider as free tier: no charge, but it uses free-tier rate limits (quota is not visible through the API).');
    if (direct.basis === 'paid_rate_assumed_tier_unknown') assumptions.push('Billing tier unknown: paid rate assumed. If your key is on the free tier the charge is 0.');
  }
  if (!history.samples) assumptions.push(`No history for this agent: ${DEFAULT_OUTPUT_TOKENS} output tokens assumed.`);
  else assumptions.push(`Output tokens from ${history.samples} past call(s) of this agent.`);
  assumptions.push(`Input tokens counted from the prompt text at ~${CHARS_PER_TOKEN[provider] ?? 3.5} characters per token.`);
  if (expectedCalls > 1) assumptions.push(`Past attempts per completed task: ${expectedCalls.toFixed(2)}.`);
  assumptions.push(`Conservative case: ${conservativeCalls} attempt(s) at ${outConservative} output tokens each.`);
  if (!fx?.rate) assumptions.push('No USD→INR rate set: INR values unavailable.');
  const confidence = price && tier !== 'unknown' && history.samples >= 5 ? 'high' : price && history.samples >= 1 ? 'medium' : 'low';
  return {
    provider,
    model,
    estInputTokens: Math.round(inputTokens * expectedCalls),
    estOutputTokens: Math.round(outputTokens * expectedCalls),
    estCalls: Math.round(expectedCalls * 100) / 100,
    estMediaUnits: 0,
    directUsd: direct.usd,
    conservativeUsd: cons.usd,
    directInr: toInr(direct.usd, fx),
    conservativeInr: toInr(cons.usd, fx),
    basis: direct.basis,
    confidence,
    assumptions,
    pricing: price ? { input: price.input, output: price.output, source: price.source, verifiedAt: price.verifiedAt, origin: price.origin } : null,
  };
}

async function pickEngine(db, env, agent) {
  const engines = await enginesFor(db, env, agent);
  const configured = engines.find((e) => providerConfig(env, e).configured);
  const provider = configured ?? engines[0] ?? 'claude';
  return { provider, model: providerConfig(env, provider).model, configured: Boolean(configured), engines };
}

/** Estimate for a real task about to run: the prompt is built from the actual upstream deliverables. */
export async function estimateTask(env, db, task, settings) {
  const agent = agentById(task.agent_id);
  const wf = await getWorkflow(db, task.workflow_id);
  const siblings = await getTasks(db, task.workflow_id);
  const upstream = [];
  for (const key of task.depends_on) {
    const dep = siblings.find((s) => s.step_key === key);
    const art = dep && (await db.prepare('SELECT content_json FROM artifacts WHERE task_id = ? ORDER BY version DESC LIMIT 1').bind(dep.id).first());
    let content = '';
    try {
      const c = art ? JSON.parse(art.content_json) : {};
      content = c.deliverable ?? JSON.stringify(c);
    } catch {
      content = '';
    }
    upstream.push({ step_key: key, agent_id: dep?.agent_id ?? '', deliverable: dep?.deliverable ?? '', content });
  }
  const { system, prompt } = buildAgentPrompt({ agent, task, workflow: wf, upstream });
  const eng = await pickEngine(db, env, agent);
  const history = await agentHistory(db, agent.id);
  const price = await priceFor(db, eng.provider, eng.model);
  const est = computeEstimate({
    provider: eng.provider,
    model: eng.model,
    inputTokens: Math.ceil((system.length + prompt.length) / (CHARS_PER_TOKEN[eng.provider] ?? 3.5)),
    outputTokens: Math.round(history.avgOut ?? DEFAULT_OUTPUT_TOKENS),
    history,
    remainingAttempts: task.max_attempts - task.attempts,
    price,
    tier: settings.provider_billing[eng.provider] ?? 'unknown',
    fx: settings.fx_usd_inr,
    maxOutputCap: eng.provider === 'claude' ? 8000 : null,
  });
  if (!eng.configured) est.assumptions.unshift(`No configured engine for ${agent.id}; the task will fail until ${providerConfig(env, eng.provider).secretName} is set.`);
  return { ...est, durationSec: Math.round(history.avgSec ?? DEFAULT_DURATION_SEC), engineConfigured: eng.configured };
}

/** History-only estimate for a planned step (no workflow exists yet). */
export async function estimatePlannedStep(env, db, step, settings) {
  const agent = agentById(step.agent);
  const eng = await pickEngine(db, env, agent);
  const history = await agentHistory(db, agent.id);
  const price = await priceFor(db, eng.provider, eng.model);
  const est = computeEstimate({
    provider: eng.provider,
    model: eng.model,
    inputTokens: Math.round(history.avgIn ?? DEFAULT_INPUT_TOKENS + 1500 * (step.dependsOn?.length ?? 0)),
    outputTokens: Math.round(history.avgOut ?? DEFAULT_OUTPUT_TOKENS),
    history,
    remainingAttempts: agent.maxRetries + 1,
    price,
    tier: settings.provider_billing[eng.provider] ?? 'unknown',
    fx: settings.fx_usd_inr,
    maxOutputCap: eng.provider === 'claude' ? 8000 : null,
  });
  if (!history.avgIn) est.assumptions.push('Input size not measured yet for this agent: rough default used.');
  return { ...est, durationSec: Math.round(history.avgSec ?? DEFAULT_DURATION_SEC), engineConfigured: eng.configured };
}

/* ---------------- budgets: atomic reservation ---------------- */
const SPENT_MONTH = "(SELECT COALESCE(SUM(amount_inr),0) FROM cost_ledger WHERE created_at >= ?1)";
const RESERVED = "(SELECT COALESCE(SUM(amount_inr),0) FROM budget_reservations WHERE status = 'active')";
const SUBS = "(SELECT COALESCE(SUM(CASE billing_cycle WHEN 'yearly' THEN amount_inr / 12.0 ELSE amount_inr END),0) FROM subscriptions WHERE amount_inr IS NOT NULL)";

/**
 * Reserves `amountInr` for a task in ONE SQL statement: the row is inserted only if every applicable
 * budget still has room (spent this month + active reservations + this amount ≤ limit). SQLite
 * executes a single statement atomically, so two concurrent dispatches can't both take the last rupees.
 * Returns the reservation id, or null when a budget would be exceeded.
 */
export async function reserveBudget(db, { taskId, workflowId, provider, amountInr }) {
  const id = newId('rv');
  const now = nowIso();
  const sql = `INSERT INTO budget_reservations (id, task_id, workflow_id, provider, amount_inr, status, created_at)
    SELECT ?2, ?3, ?4, ?5, ?6, 'active', ?7
    WHERE
      ((SELECT limit_inr FROM budgets WHERE scope = 'monthly_total' AND scope_ref = '') IS NULL
        OR ${SPENT_MONTH} + ${RESERVED} + ${SUBS} + ?6 <= (SELECT limit_inr FROM budgets WHERE scope = 'monthly_total' AND scope_ref = ''))
      AND ((SELECT limit_inr FROM budgets WHERE scope = 'provider' AND scope_ref = ?5) IS NULL
        OR (SELECT COALESCE(SUM(amount_inr),0) FROM cost_ledger WHERE created_at >= ?1 AND provider = ?5)
         + (SELECT COALESCE(SUM(amount_inr),0) FROM budget_reservations WHERE status = 'active' AND provider = ?5) + ?6
         <= (SELECT limit_inr FROM budgets WHERE scope = 'provider' AND scope_ref = ?5))
      AND ((SELECT limit_inr FROM budgets WHERE scope = 'project' AND scope_ref = ?4) IS NULL
        OR (SELECT COALESCE(SUM(amount_inr),0) FROM cost_ledger WHERE workflow_id = ?4)
         + (SELECT COALESCE(SUM(amount_inr),0) FROM budget_reservations WHERE status = 'active' AND workflow_id = ?4) + ?6
         <= (SELECT limit_inr FROM budgets WHERE scope = 'project' AND scope_ref = ?4))
      AND ((SELECT limit_inr FROM budgets WHERE scope = 'task' AND scope_ref = '*') IS NULL
        OR ?6 <= (SELECT limit_inr FROM budgets WHERE scope = 'task' AND scope_ref = '*'))`;
  const r = await db.prepare(sql).bind(monthStart(), id, taskId, workflowId, provider, amountInr, now).run();
  return r.meta.changes === 1 ? id : null;
}

/** Same reservation without limit checks: used after the owner approved going over budget. */
async function reserveOverride(db, { taskId, workflowId, provider, amountInr }) {
  const id = newId('rv');
  await db.prepare("INSERT INTO budget_reservations (id, task_id, workflow_id, provider, amount_inr, status, created_at) VALUES (?,?,?,?,?,'active',?)").bind(id, taskId, workflowId, provider, amountInr, nowIso()).run();
  return id;
}

async function anyBudget(db) {
  return Boolean(await db.prepare('SELECT 1 FROM budgets LIMIT 1').first());
}

/** Headroom per applicable budget, for explanations. */
export async function budgetStatus(db, { provider = null, workflowId = null } = {}) {
  const ms = monthStart();
  const spent = (await db.prepare('SELECT COALESCE(SUM(amount_inr),0) AS v FROM cost_ledger WHERE created_at >= ?').bind(ms).first()).v;
  const reserved = (await db.prepare("SELECT COALESCE(SUM(amount_inr),0) AS v FROM budget_reservations WHERE status = 'active'").first()).v;
  const subs = await subscriptionsMonthly(db);
  const out = [];
  for (const b of (await db.prepare('SELECT * FROM budgets').all()).results) {
    let used = null;
    if (b.scope === 'monthly_total') used = spent + reserved + subs.inr;
    else if (b.scope === 'provider' && (!provider || b.scope_ref === provider))
      used =
        (await db.prepare('SELECT COALESCE(SUM(amount_inr),0) AS v FROM cost_ledger WHERE created_at >= ? AND provider = ?').bind(ms, b.scope_ref).first()).v +
        (await db.prepare("SELECT COALESCE(SUM(amount_inr),0) AS v FROM budget_reservations WHERE status = 'active' AND provider = ?").bind(b.scope_ref).first()).v;
    else if (b.scope === 'project' && (!workflowId || b.scope_ref === workflowId))
      used =
        (await db.prepare('SELECT COALESCE(SUM(amount_inr),0) AS v FROM cost_ledger WHERE workflow_id = ?').bind(b.scope_ref).first()).v +
        (await db.prepare("SELECT COALESCE(SUM(amount_inr),0) AS v FROM budget_reservations WHERE status = 'active' AND workflow_id = ?").bind(b.scope_ref).first()).v;
    else if (b.scope === 'task') used = 0;
    if (used === null) continue;
    const remaining = b.limit_inr - used;
    out.push({ id: b.id, scope: b.scope, scopeRef: b.scope_ref, limitInr: b.limit_inr, usedInr: round(used), remainingInr: round(remaining), warnPct: b.warn_pct, warning: b.scope !== 'task' && b.limit_inr > 0 && (used / b.limit_inr) * 100 >= b.warn_pct });
  }
  return out;
}
const round = (v) => (v === null || v === undefined ? null : Math.round(v * 100) / 100);

/* ---------------- dispatch gate (called by the orchestrator tick) ---------------- */
/**
 * Decides whether a ready task may start. Returns { ok:true, reservationId, estimateId, startedAt }
 * or { ok:false, reason } after putting the task on hold (approval) or leaving it queued (pause).
 */
export async function gateDispatch(env, db, task, settings) {
  if (settings.dispatch_paused) return { ok: false, reason: 'dispatch_paused' };
  const est = await estimateTask(env, db, task, settings);
  const meta = await db.prepare('SELECT budget_override FROM task_meta WHERE task_id = ?').bind(task.id).first();
  const override = Boolean(meta?.budget_override);
  const budgeted = await anyBudget(db);

  let decision = 'allowed';
  let hold = null;
  const amount = est.conservativeInr;
  if (!override) {
    if (settings.task_approval_inr !== null && amount !== null && amount > settings.task_approval_inr) {
      hold = `Conservative estimate ₹${amount.toFixed(2)} is above your approval threshold ₹${settings.task_approval_inr}.`;
    } else if (amount === null && budgeted && settings.unknown_cost_policy === 'require_approval') {
      hold = `Cost can't be estimated in INR (${est.pricing ? 'no USD→INR rate set' : `no verified price for ${est.provider}/${est.model}`}) and a budget is active.`;
    } else if (amount === null && settings.task_approval_inr !== null && settings.unknown_cost_policy === 'require_approval') {
      hold = `Cost can't be estimated in INR and an approval threshold is set.`;
    }
  }
  let reservationId = null;
  if (!hold) {
    const args = { taskId: task.id, workflowId: task.workflow_id, provider: est.provider, amountInr: amount ?? 0 };
    if (settings.max_concurrent_paid_tasks && (amount ?? 0) > 0) {
      const n = (await db.prepare("SELECT COUNT(*) AS n FROM budget_reservations WHERE status = 'active' AND amount_inr > 0").first()).n;
      if (n >= settings.max_concurrent_paid_tasks) {
        await saveEstimate(db, task, est, 'deferred_concurrency');
        return { ok: false, reason: 'concurrency_limit' };
      }
    }
    reservationId = override ? await reserveOverride(db, args) : await reserveBudget(db, args);
    // An owner override covers one dispatch only.
    if (override) await db.prepare('UPDATE task_meta SET budget_override = 0, updated_at = ? WHERE task_id = ?').bind(nowIso(), task.id).run();
    if (!reservationId) {
      const st = await budgetStatus(db, { provider: est.provider, workflowId: task.workflow_id });
      const tight = st.filter((b) => b.remainingInr < (amount ?? 0)).map((b) => `${b.scope}${b.scopeRef && b.scopeRef !== '*' ? ` ${b.scopeRef}` : ''}: ₹${b.remainingInr} left of ₹${b.limitInr}`);
      hold = `Budget would be exceeded (needs ₹${(amount ?? 0).toFixed(2)}). ${tight.join('; ')}`;
    }
    decision = override ? 'allowed_override' : 'allowed';
  }
  if (hold) decision = 'held_for_approval';
  const estimateId = await saveEstimate(db, task, est, decision);

  if (hold) {
    const alts = await cheaperAlternatives(db, est);
    const summary = `${hold} Task ${task.step_key} (${task.agent_id}) on ${est.provider}/${est.model}: direct ${fmtInr(est.directInr, est.directUsd)}, conservative ${fmtInr(est.conservativeInr, est.conservativeUsd)}.${alts.length ? ` Cheaper options: ${alts.map((a) => `${a.model} ≈ ${fmtInr(a.inr, a.usd)}`).join(', ')}.` : ''} Approve = run anyway once; reject = cancel the goal.`;
    const now = nowIso();
    const r = await db.prepare("UPDATE tasks SET status = 'waiting_for_approval', updated_at = ? WHERE id = ? AND status = 'queued'").bind(now, task.id).run();
    if (r.meta.changes === 1) {
      await db.prepare("INSERT INTO approvals (id, workflow_id, task_id, action, summary, status, created_at) VALUES (?,?,?,?,?,'pending',?)").bind(newId('ap'), task.workflow_id, task.id, `budget:${task.step_key}`, summary.slice(0, 500), now).run();
      await audit(db, 'budget_hold', summary, { estimateId }, task.workflow_id, task.id);
      await refreshWorkflow(db, task.workflow_id);
    }
    return { ok: false, reason: 'held_for_approval' };
  }
  await audit(db, 'budget_reserved', `Reserved ${fmtInr(amount ?? 0, est.conservativeUsd)} for ${task.step_key} (${decision})`, { reservationId, estimateId }, task.workflow_id, task.id);
  return { ok: true, reservationId, estimateId, startedAt: nowIso() };
}

const fmtInr = (inr, usd) => (inr !== null && inr !== undefined ? `₹${inr.toFixed(2)}` : usd !== null && usd !== undefined ? `$${usd.toFixed(4)} (no INR rate)` : 'unknown');

async function cheaperAlternatives(db, est) {
  if (!est.pricing || est.conservativeUsd === null) return [];
  const day = nowIso().slice(0, 10);
  const models = [...new Set(SEEDED_PRICING.filter((p) => p.provider === est.provider && p.model !== est.model).map((p) => p.model))];
  const out = [];
  for (const m of models) {
    const p = await priceFor(db, est.provider, m, day);
    if (!p) continue;
    const usd = tokenCostUsd(p, est.estInputTokens, est.estOutputTokens);
    if (usd !== null && usd < (est.directUsd ?? Infinity)) out.push({ model: m, usd: Math.round(usd * 1e6) / 1e6, inr: est.directInr !== null && est.directUsd ? Math.round((usd * est.directInr) / est.directUsd * 100) / 100 : null });
  }
  return out.sort((a, b) => a.usd - b.usd).slice(0, 3);
}

async function saveEstimate(db, task, est, decision) {
  const id = newId('es');
  await db
    .prepare(`INSERT INTO cost_estimates (id, task_id, workflow_id, agent_id, provider, model, est_input_tokens, est_output_tokens, est_calls, direct_usd, conservative_usd, direct_inr, conservative_inr, duration_sec, confidence, decision, assumptions_json, pricing_json, created_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, task.id ?? null, task.workflow_id ?? null, task.agent_id, est.provider, est.model, est.estInputTokens, est.estOutputTokens, est.estCalls, est.directUsd, est.conservativeUsd, est.directInr, est.conservativeInr, est.durationSec, est.confidence, decision, JSON.stringify(est.assumptions), est.pricing ? JSON.stringify(est.pricing) : null, nowIso())
    .run();
  return id;
}

/** Releases a reservation that was taken but never used (lost the claim race). */
export async function releaseReservation(db, reservationId) {
  if (!reservationId) return;
  await db.prepare("UPDATE budget_reservations SET status = 'released', closed_at = ? WHERE id = ? AND status = 'active'").bind(nowIso(), reservationId).run();
}

/** After a task attempt: record actual usage/cost from provider_calls, close the reservation. */
export async function reconcileTask(env, db, task, gate, settingsIn) {
  const settings = settingsIn ?? (await getSettings(db));
  const { results } = await db
    .prepare(`SELECT provider, model, COUNT(*) AS calls, SUM(input_tokens) AS i, SUM(output_tokens) AS o, SUM(cost_usd) AS c, SUM(cost_usd IS NULL) AS unpriced
              FROM provider_calls WHERE task_id = ? AND created_at >= ? GROUP BY provider, model`)
    .bind(task.id, gate.startedAt)
    .all();
  let total = 0;
  let unknown = false;
  const now = nowIso();
  for (const r of results) {
    let usd;
    let basis;
    if (r.unpriced === 0 && r.c !== null) {
      usd = r.c;
      basis = 'env_price';
    } else {
      const price = await priceFor(db, r.provider, r.model);
      const ch = chargeFor(price, settings.provider_billing[r.provider] ?? 'unknown', tokenCostUsd(price, r.i ?? 0, r.o ?? 0));
      usd = r.i === null && r.o === null ? null : ch.usd;
      basis = ch.basis;
    }
    const inr = toInr(usd, settings.fx_usd_inr);
    if (inr === null) unknown = true;
    else total += inr;
    await db
      .prepare(`INSERT INTO cost_ledger (id, task_id, workflow_id, provider, model, purpose, calls, input_tokens, output_tokens, amount_usd, amount_inr, fx_rate, fx_at, basis, estimate_id, created_at)
                VALUES (?,?,?,?,?,'task',?,?,?,?,?,?,?,?,?,?)`)
      .bind(newId('cl'), task.id, task.workflow_id, r.provider, r.model, r.calls, r.i, r.o, usd, inr, settings.fx_usd_inr?.rate ?? null, settings.fx_usd_inr?.at ?? null, basis, gate.estimateId ?? null, now)
      .run();
  }
  await db.prepare("UPDATE budget_reservations SET status = ?, closed_at = ? WHERE id = ? AND status = 'active'").bind(results.length ? 'consumed' : 'released', now, gate.reservationId).run();
  if (results.length) await audit(db, 'cost_actual', `Actual ${unknown ? 'cost partly unknown' : `₹${total.toFixed(2)}`} for ${task.step_key} (${results.reduce((a, r) => a + r.calls, 0)} call(s))`, { estimateId: gate.estimateId }, task.workflow_id, task.id);
}

/* ---------------- planning (DRAFT: nothing is written or run) ---------------- */
export async function planGoal(env, db, { template, title = '', count = 1 }) {
  const tpl = TEMPLATES[template];
  if (!tpl) throw new HttpError(400, `Unknown template "${template}". Known: ${Object.keys(TEMPLATES).join(', ')}`);
  const n = Number.isInteger(count) && count >= 1 && count <= 10 ? count : 1;
  const settings = await getSettings(db);
  const steps = [];
  for (const s of tpl.steps) {
    const agent = agentById(s.agent);
    const est = await estimatePlannedStep(env, db, s, settings);
    steps.push({ key: s.key, agent: s.agent, agentName: agent.name, deliverable: s.deliverable, dependsOn: s.dependsOn ?? [], gate: Boolean(s.gate), approval: Boolean(s.approval), state: 'DRAFT', estimate: est });
  }
  const sumOf = (k) => (steps.some((s) => s.estimate[k] === null) ? null : round(steps.reduce((a, s) => a + s.estimate[k], 0) * n));
  const totals = { directInr: sumOf('directInr'), conservativeInr: sumOf('conservativeInr'), directUsd: sumOf('directUsd'), conservativeUsd: sumOf('conservativeUsd'), durationSec: critical(steps) };
  const budgets = await budgetStatus(db);
  const over = budgets.filter((b) => b.scope !== 'task' && totals.conservativeInr !== null && b.remainingInr < totals.conservativeInr);
  return {
    controller: CBO_ID,
    state: 'DRAFT',
    template,
    templateName: tpl.name,
    brand: tpl.brand,
    title,
    count: n,
    steps,
    totals,
    confidence: steps.every((s) => s.estimate.confidence === 'high') ? 'high' : steps.some((s) => s.estimate.confidence === 'low') ? 'low' : 'medium',
    approvalsInPlan: steps.filter((s) => s.approval).map((s) => s.key),
    budgetCheck: budgets.length ? (over.length ? { ok: false, over } : { ok: true, budgets }) : { ok: null, note: 'No budget configured: nothing blocks this plan. Set one in CFO → Budgets.' },
    note: 'Estimate only. Nothing has been created or run. Start the goal to execute; every step is estimated again with real inputs before it runs.',
  };
}

/** Longest dependency chain duration (seconds) — the plan's expected wall time. */
function critical(steps) {
  const by = new Map(steps.map((s) => [s.key, s]));
  const memo = new Map();
  const f = (k) => {
    if (memo.has(k)) return memo.get(k);
    const s = by.get(k);
    const v = (s.estimate.durationSec ?? 0) + Math.max(0, ...s.dependsOn.map(f));
    memo.set(k, v);
    return v;
  };
  return Math.max(0, ...steps.map((s) => f(s.key)));
}

/* ---------------- operations: lifecycle, task list, reassignment ---------------- */
export const LIFECYCLE = ['DRAFT', 'READY', 'ASSIGNED', 'RUNNING', 'WAITING_FOR_APPROVAL', 'BLOCKED', 'FAILED', 'COMPLETED', 'CANCELLED'];

/** Maps a stored task to the CBO lifecycle (see docs/CBO_AUDIT.md §4). */
export function lifecycleOf(task, siblingStatus, workflowStatus, dispatchPaused) {
  switch (task.status) {
    case 'running':
      return { state: 'RUNNING' };
    case 'waiting_for_approval':
      return { state: 'WAITING_FOR_APPROVAL' };
    case 'waiting_for_external_action':
      return { state: 'BLOCKED', reason: 'Waiting for you to carry out and confirm the approved action.' };
    case 'completed':
      return { state: 'COMPLETED' };
    case 'failed':
      return { state: 'FAILED' };
    case 'cancelled':
      return { state: 'CANCELLED' };
  }
  const deps = task.depends_on.map((d) => siblingStatus.get(d));
  const dead = task.depends_on.filter((d) => ['failed', 'cancelled'].includes(siblingStatus.get(d)));
  if (dead.length) return { state: 'BLOCKED', reason: `Upstream step ${dead.join(', ')} ${siblingStatus.get(dead[0])}.` };
  if (workflowStatus === 'paused') return { state: 'BLOCKED', reason: 'Goal is paused.' };
  if (!deps.every((s) => s === 'completed')) return { state: 'ASSIGNED', reason: 'Waiting for upstream steps.' };
  if (dispatchPaused) return { state: 'BLOCKED', reason: 'Global dispatch pause is on.' };
  return { state: 'READY' };
}

export async function listTasks(db, { brand = null, state = null, limit = 300 } = {}) {
  const settings = await getSettings(db);
  const { results } = await db
    .prepare(`SELECT t.*, w.title AS workflow_title, w.brand, w.status AS workflow_status, w.template,
                m.priority, m.deadline, m.reassigned_from, wm.deadline AS workflow_deadline, wm.priority AS workflow_priority,
                (SELECT json_object('direct_inr', e.direct_inr, 'conservative_inr', e.conservative_inr, 'direct_usd', e.direct_usd, 'conservative_usd', e.conservative_usd, 'confidence', e.confidence, 'decision', e.decision, 'created_at', e.created_at)
                   FROM cost_estimates e WHERE e.task_id = t.id ORDER BY e.created_at DESC, e.rowid DESC LIMIT 1) AS estimate_json,
                (SELECT json_object('inr', SUM(l.amount_inr), 'usd', SUM(l.amount_usd), 'calls', SUM(l.calls), 'input', SUM(l.input_tokens), 'output', SUM(l.output_tokens), 'unknown', SUM(l.amount_inr IS NULL))
                   FROM cost_ledger l WHERE l.task_id = t.id) AS actual_json,
                (SELECT amount_inr FROM budget_reservations r WHERE r.task_id = t.id AND r.status = 'active') AS reserved_inr
              FROM tasks t JOIN workflows w ON w.id = t.workflow_id
              LEFT JOIN task_meta m ON m.task_id = t.id
              LEFT JOIN workflow_meta wm ON wm.workflow_id = w.id
              ${brand ? 'WHERE w.brand = ?' : ''}
              ORDER BY w.updated_at DESC, t.created_at, t.rowid LIMIT ${Math.min(Math.max(1, limit), 500)}`)
    .bind(...(brand ? [brand] : []))
    .all();
  const byWf = new Map();
  for (const t of results) {
    if (!byWf.has(t.workflow_id)) byWf.set(t.workflow_id, new Map());
    byWf.get(t.workflow_id).set(t.step_key, t.status);
  }
  const now = nowIso();
  const out = results.map((t) => {
    const deps = JSON.parse(t.depends_on);
    const lc = lifecycleOf({ ...t, depends_on: deps }, byWf.get(t.workflow_id), t.workflow_status, settings.dispatch_paused);
    const deadline = t.deadline ?? t.workflow_deadline ?? null;
    const actual = t.actual_json ? JSON.parse(t.actual_json) : null;
    return {
      id: t.id,
      workflowId: t.workflow_id,
      workflowTitle: t.workflow_title,
      brand: t.brand,
      template: t.template,
      stepKey: t.step_key,
      agentId: t.agent_id,
      deliverable: t.deliverable,
      dependsOn: deps,
      gate: Boolean(t.is_gate),
      approvalStep: Boolean(t.needs_approval),
      status: t.status,
      state: lc.state,
      stateReason: lc.reason ?? null,
      priority: t.priority ?? t.workflow_priority ?? 'normal',
      deadline,
      overdue: Boolean(deadline && deadline < now && !['completed', 'cancelled'].includes(t.status)),
      attempts: t.attempts,
      maxAttempts: t.max_attempts,
      provider: t.provider,
      model: t.model,
      error: t.error,
      reassignedFrom: t.reassigned_from ?? null,
      estimate: t.estimate_json ? JSON.parse(t.estimate_json) : null,
      actual: actual && actual.calls ? actual : null,
      reservedInr: t.reserved_inr,
      createdAt: t.created_at,
      startedAt: t.started_at,
      finishedAt: t.finished_at,
      updatedAt: t.updated_at,
    };
  });
  return state ? out.filter((t) => t.state === state) : out;
}

const PRIORITIES = ['urgent', 'high', 'normal', 'low'];
const isIso = (s) => typeof s === 'string' && !Number.isNaN(Date.parse(s)) && /^\d{4}-\d{2}-\d{2}/.test(s);

export async function setTaskMeta(db, taskId, { priority, deadline }) {
  const t = await db.prepare('SELECT id, workflow_id, step_key FROM tasks WHERE id = ?').bind(taskId).first();
  if (!t) throw new HttpError(404, 'Task not found');
  if (priority !== undefined && !PRIORITIES.includes(priority)) throw new HttpError(400, `priority must be ${PRIORITIES.join('/')}`);
  if (deadline !== undefined && deadline !== null && !isIso(deadline)) throw new HttpError(400, 'deadline must be an ISO date');
  const cur = await db.prepare('SELECT * FROM task_meta WHERE task_id = ?').bind(taskId).first();
  const p = priority ?? cur?.priority ?? 'normal';
  const d = deadline === undefined ? (cur?.deadline ?? null) : deadline ? new Date(deadline).toISOString().replace(/\.\d{3}Z$/, 'Z') : null;
  await db
    .prepare('INSERT INTO task_meta (task_id, priority, deadline, updated_at) VALUES (?,?,?,?) ON CONFLICT(task_id) DO UPDATE SET priority = excluded.priority, deadline = excluded.deadline, updated_at = excluded.updated_at')
    .bind(taskId, p, d, nowIso())
    .run();
  await audit(db, 'task_meta', `Set ${t.step_key} priority ${p}${d ? `, deadline ${d}` : ''}`, null, t.workflow_id, taskId);
  return { taskId, priority: p, deadline: d };
}

export async function setWorkflowMeta(db, workflowId, { priority, deadline }) {
  await getWorkflow(db, workflowId);
  if (priority !== undefined && !PRIORITIES.includes(priority)) throw new HttpError(400, `priority must be ${PRIORITIES.join('/')}`);
  if (deadline !== undefined && deadline !== null && !isIso(deadline)) throw new HttpError(400, 'deadline must be an ISO date');
  const cur = await db.prepare('SELECT * FROM workflow_meta WHERE workflow_id = ?').bind(workflowId).first();
  const p = priority ?? cur?.priority ?? 'normal';
  const d = deadline === undefined ? (cur?.deadline ?? null) : deadline ? new Date(deadline).toISOString().replace(/\.\d{3}Z$/, 'Z') : null;
  await db
    .prepare('INSERT INTO workflow_meta (workflow_id, priority, deadline, updated_at) VALUES (?,?,?,?) ON CONFLICT(workflow_id) DO UPDATE SET priority = excluded.priority, deadline = excluded.deadline, updated_at = excluded.updated_at')
    .bind(workflowId, p, d, nowIso())
    .run();
  await audit(db, 'workflow_meta', `Set goal priority ${p}${d ? `, deadline ${d}` : ''}`, null, workflowId);
  return { workflowId, priority: p, deadline: d };
}

const GATE_AGENTS = new Set(['ops_dharma_safety', 'chitragupta_quality_audit']);

/** Reassigns a not-yet-running task. Gates stay with gate agents; approval steps with approval agents. */
export async function reassignTask(db, taskId, agentId) {
  const t = await db.prepare('SELECT * FROM tasks WHERE id = ?').bind(taskId).first();
  if (!t) throw new HttpError(404, 'Task not found');
  const agent = agentById(agentId);
  if (!agent) throw new HttpError(400, 'Unknown agent');
  if (!['queued', 'failed'].includes(t.status)) throw new HttpError(409, `Only queued or failed tasks can be reassigned (task is ${t.status})`);
  if (Boolean(t.is_gate) !== GATE_AGENTS.has(agentId)) throw new HttpError(400, t.is_gate ? 'A review gate can only go to DHARMA or CHITRAGUPTA' : 'Review agents can only run gate steps');
  if (t.needs_approval && !agent.approvalRequired?.length) throw new HttpError(400, 'This step needs an agent whose contract requires human approval');
  if (agentId === 'ganesha_orchestrator') throw new HttpError(400, 'GANESHA orchestrates; it does not take steps');
  if (agentId === t.agent_id) throw new HttpError(409, 'Task is already assigned to that agent');
  const now = nowIso();
  await db.batch([
    db.prepare('UPDATE tasks SET agent_id = ?, updated_at = ? WHERE id = ? AND status IN (\'queued\',\'failed\')').bind(agentId, now, taskId),
    db
      .prepare("INSERT INTO task_meta (task_id, reassigned_from, updated_at) VALUES (?,?,?) ON CONFLICT(task_id) DO UPDATE SET reassigned_from = excluded.reassigned_from, updated_at = excluded.updated_at")
      .bind(taskId, t.agent_id, now),
  ]);
  await audit(db, 'task_reassigned', `${t.step_key}: ${t.agent_id} → ${agentId}`, null, t.workflow_id, taskId);
  return { taskId, from: t.agent_id, to: agentId };
}

/** Global pause for new chargeable dispatches. Running provider requests are not interrupted. */
export async function setDispatchPause(db, paused) {
  await db
    .prepare('INSERT INTO studio_settings (key, value_json, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at')
    .bind('dispatch_paused', JSON.stringify(Boolean(paused)), nowIso())
    .run();
  await audit(db, 'dispatch_pause', paused ? 'Global dispatch pause ON: no new chargeable tasks will start. Requests already sent to a provider are not interrupted.' : 'Global dispatch pause OFF.');
}

/* ---------------- finance aggregate ---------------- */
export async function financeSummary(env, db) {
  const settings = await getSettings(db);
  const ms = monthStart();
  const byProvider = (
    await db
      .prepare(`SELECT provider, COUNT(*) AS rows, SUM(calls) AS calls, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
                SUM(amount_usd) AS usd, SUM(amount_inr) AS inr, SUM(amount_inr IS NULL) AS unknown_rows FROM cost_ledger WHERE created_at >= ? GROUP BY provider`)
      .bind(ms)
      .all()
  ).results;
  const byModel = (
    await db
      .prepare(`SELECT provider, model, purpose, COUNT(*) AS calls, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens
                FROM provider_calls WHERE created_at >= ? AND status = 'success' GROUP BY provider, model, purpose ORDER BY provider, model`)
      .bind(ms)
      .all()
  ).results;
  const reserved = (await db.prepare("SELECT COALESCE(SUM(amount_inr),0) AS v, COUNT(*) AS n FROM budget_reservations WHERE status = 'active'").first());
  const actualInr = byProvider.reduce((a, r) => a + (r.inr ?? 0), 0);
  const unknownRows = byProvider.reduce((a, r) => a + (r.unknown_rows ?? 0), 0);
  const subs = await subscriptionsMonthly(db);
  // Estimate vs actual per finished task (latest allowed estimate vs summed ledger).
  const evsa = (
    await db
      .prepare(`SELECT t.id AS task_id, t.step_key, t.agent_id, w.title AS workflow_title, w.brand,
                  (SELECT direct_inr FROM cost_estimates e WHERE e.task_id = t.id AND e.decision LIKE 'allowed%' ORDER BY e.created_at DESC, e.rowid DESC LIMIT 1) AS est_inr,
                  (SELECT direct_usd FROM cost_estimates e WHERE e.task_id = t.id AND e.decision LIKE 'allowed%' ORDER BY e.created_at DESC, e.rowid DESC LIMIT 1) AS est_usd,
                  (SELECT SUM(amount_inr) FROM cost_ledger l WHERE l.task_id = t.id) AS act_inr,
                  (SELECT SUM(amount_usd) FROM cost_ledger l WHERE l.task_id = t.id) AS act_usd
                FROM tasks t JOIN workflows w ON w.id = t.workflow_id
                WHERE EXISTS (SELECT 1 FROM cost_ledger l WHERE l.task_id = t.id)
                ORDER BY t.updated_at DESC LIMIT 50`)
      .all()
  ).results;
  // Cost per completed deliverable workflow, by brand/template (only when every ledger row has INR).
  const perDeliverable = (
    await db
      .prepare(`SELECT w.template, w.brand, COUNT(DISTINCT w.id) AS completed,
                  SUM(l.amount_inr) AS inr, SUM(l.amount_inr IS NULL) AS unknown_rows
                FROM workflows w LEFT JOIN cost_ledger l ON l.workflow_id = w.id
                WHERE w.status = 'completed' GROUP BY w.template, w.brand`)
      .all()
  ).results.map((r) => ({ ...r, perDeliverableInr: r.unknown_rows || r.inr === null ? null : round(r.inr / r.completed) }));
  // Queued work, estimated from history (not reserved).
  const queued = (await db.prepare("SELECT t.agent_id, COUNT(*) AS n FROM tasks t JOIN workflows w ON w.id = t.workflow_id WHERE t.status = 'queued' AND w.status NOT IN ('cancelled','failed','completed') GROUP BY t.agent_id").all()).results;
  let queuedInr = 0;
  let queuedUnknown = 0;
  for (const q of queued) {
    const e = await estimatePlannedStep(env, db, { agent: q.agent_id, dependsOn: [] }, settings);
    if (e.directInr === null) queuedUnknown += q.n;
    else queuedInr += e.directInr * q.n;
  }
  const day = new Date();
  const daysIn = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0)).getUTCDate();
  const dayOf = day.getUTCDate();
  const forecast = unknownRows || actualInr === 0 ? null : round((actualInr / dayOf) * daysIn + subs.inr);
  const pendingFinancial = (await db.prepare("SELECT a.*, w.title AS workflow_title FROM approvals a JOIN workflows w ON w.id = a.workflow_id WHERE a.status = 'pending' AND a.action LIKE 'budget:%' ORDER BY a.created_at DESC").all()).results;
  return {
    controller: CBO_ID,
    month: ms.slice(0, 7),
    currency: 'INR',
    fx: settings.fx_usd_inr,
    providerBilling: settings.provider_billing,
    actual: { inr: round(actualInr), unknownRows, byProvider },
    tokensByModel: byModel,
    reserved: { inr: round(reserved.v), active: reserved.n },
    queuedEstimate: { inr: round(queuedInr), tasksWithUnknownCost: queuedUnknown, tasks: queued.reduce((a, q) => a + q.n, 0), note: 'History-based estimate for queued tasks; not reserved.' },
    subscriptions: { monthlyInr: round(subs.inr), count: subs.count, unconverted: subs.unconverted },
    forecastMonthInr: forecast,
    forecastNote: forecast === null ? 'Not enough priced spend this month to forecast (or some costs are unknown).' : 'Linear projection of this month’s API spend + subscriptions.',
    budgets: await budgetStatus(db),
    estimateVsActual: evsa,
    perDeliverable,
    pendingFinancialApprovals: pendingFinancial,
    quota: [
      { provider: 'claude', remaining: null, note: 'The Anthropic API does not report a remaining balance to the Worker. Check console.anthropic.com → Billing.' },
      { provider: 'gemini', remaining: null, note: 'The Gemini API does not expose remaining free-tier quota or credit balance. Check aistudio.google.com / Google Cloud Billing.' },
      { provider: 'google_ai_pro', remaining: null, note: 'Google AI Pro (consumer) credits for Flow are not available to any API.' },
      { provider: 'canva', remaining: null, note: 'Not connected.' },
    ],
    limitation: 'A local budget cannot stop billing instantly on a provider. Set provider-side limits too (Anthropic console spend limits; Google Cloud budget alerts).',
  };
}

/* ---------------- executive report ---------------- */
export async function cboReport(env, db, providers) {
  const settings = await getSettings(db);
  const tasks = await listTasks(db, { limit: 500 });
  const byState = Object.fromEntries(LIFECYCLE.map((s) => [s, 0]));
  for (const t of tasks) byState[t.state]++;
  const busy = new Set(tasks.filter((t) => t.state === 'RUNNING').map((t) => t.agentId));
  const now = Date.now();
  const soon = tasks.filter((t) => t.deadline && !['COMPLETED', 'CANCELLED'].includes(t.state) && Date.parse(t.deadline) >= now && Date.parse(t.deadline) - now < 7 * 86400_000);
  const overdue = tasks.filter((t) => t.overdue);
  const delayed = (
    await db
      .prepare("SELECT w.id, w.title, w.brand, w.status, m.deadline FROM workflows w JOIN workflow_meta m ON m.workflow_id = w.id WHERE m.deadline IS NOT NULL AND m.deadline < ? AND w.status NOT IN ('completed','cancelled')")
      .bind(nowIso())
      .all()
  ).results;
  const approvals = (await db.prepare("SELECT a.id, a.action, a.summary, a.created_at, a.workflow_id, w.title AS workflow_title, w.brand FROM approvals a JOIN workflows w ON w.id = a.workflow_id WHERE a.status = 'pending' ORDER BY a.created_at").all()).results;
  const fin = await financeSummary(env, db);
  const providerProblems = providers.filter((p) => p.state !== 'last_request_ok');
  const blocked = tasks.filter((t) => t.state === 'BLOCKED' || t.state === 'FAILED').slice(0, 20);

  const actions = [];
  if (settings.dispatch_paused) actions.push('Global dispatch pause is ON — turn it off in CFO when you want work to continue.');
  if (approvals.length) actions.push(`Decide ${approvals.length} pending approval(s).`);
  if (byState.FAILED) actions.push(`Review ${byState.FAILED} failed task(s): fix the cause (often a missing key) and press Retry.`);
  if (overdue.length) actions.push(`${overdue.length} task(s) are past their deadline.`);
  for (const p of providerProblems) actions.push(p.state === 'not_configured' ? `${p.provider}: set its API key to enable it.` : p.state === 'key_set_untested' ? `${p.provider}: run a connection test.` : `${p.provider}: last request failed — open AI Connection.`);
  if (!settings.fx_usd_inr) actions.push('Set a USD→INR rate (CFO → Settings) so costs can be shown in INR and budgets can be enforced.');
  if (!fin.budgets.length) actions.push('No budget is set. Add a monthly budget in CFO → Budgets.');
  for (const b of fin.budgets.filter((b) => b.warning)) actions.push(`Budget ${b.scope}${b.scopeRef && b.scopeRef !== '*' ? ` ${b.scopeRef}` : ''} is at ${Math.round((b.usedInr / b.limitInr) * 100)}%.`);

  return {
    controller: CBO_ID,
    generatedAt: nowIso(),
    health: { dispatchPaused: settings.dispatch_paused, providers: providers.map((p) => ({ provider: p.provider, state: p.state, model: p.model })) },
    tasks: { byState, total: tasks.length },
    agents: { total: REGISTRY.agents.length, working: busy.size, available: REGISTRY.agents.length - busy.size, workingIds: [...busy] },
    deadlines: { upcoming7d: soon.map(slim), overdue: overdue.map(slim), delayedGoals: delayed },
    approvals,
    blockers: blocked.map(slim),
    money: { actualMonthInr: fin.actual.inr, unknownCostRows: fin.actual.unknownRows, reservedInr: fin.reserved.inr, queuedEstimateInr: fin.queuedEstimate.inr, subscriptionsMonthlyInr: fin.subscriptions.monthlyInr, forecastMonthInr: fin.forecastMonthInr, budgets: fin.budgets, fxSet: Boolean(settings.fx_usd_inr) },
    recommendedActions: actions,
  };
}
const slim = (t) => ({ id: t.id, workflowId: t.workflowId, workflowTitle: t.workflowTitle, brand: t.brand, stepKey: t.stepKey, agentId: t.agentId, state: t.state, reason: t.stateReason, deadline: t.deadline, error: t.error });
