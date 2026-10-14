// GANESHA_CBO natural-language commands. Deterministic intent matching (no AI call, no cost):
// every answer is read from D1. Commands that would change something return a proposed action
// the owner confirms in the UI — the command itself never mutates state.
import { REGISTRY, agentById } from './agents.mjs';
import { TEMPLATES } from './orchestrator.mjs';
import { CBO_ID, cboReport, financeSummary, listTasks, planGoal } from './cbo.mjs';
import { listConnections } from './connections.mjs';
import { SEEDED_PRICING, getSettings, priceFor, tokenCostUsd, toInr } from './finance.mjs';
import { HttpError } from './util.mjs';

const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const countIn = (t) => {
  const m = /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.exec(t);
  return m ? Number(m[1]) || NUM[m[1].toLowerCase()] : 1;
};
function templateFor(t) {
  if (/littleloop|toddler|kids|episode|reel/i.test(t)) return 'littleloop_episode';
  if (/sunverse|song|music video|youtube/i.test(t)) return 'sunverse_song_release';
  if (/foliocraft|portfolio|feature/i.test(t)) return 'foliocraft_feature';
  if (/weekly review|ops/i.test(t)) return 'ops_weekly_review';
  return 'research_brief';
}

const INTENTS = [
  { id: 'pause', re: /\b(pause|stop)\b.*\b(charge|charges|api|tasks|dispatch|spend)/i },
  { id: 'resume', re: /\b(resume|unpause|restart)\b.*\b(dispatch|tasks|work)/i },
  { id: 'credits', re: /\b(credits?|balance|remaining|quota)\b/i },
  { id: 'usage', re: /\b(token|usage)\b.*\b(provider|model)|\bby provider\b/i },
  { id: 'approvals', re: /\b(waiting for (my )?approval|approvals?|pending decisions?)\b/i },
  { id: 'deadlines', re: /\b(deadline|at risk|overdue|late)\b/i },
  { id: 'cheapest', re: /\b(cheapest|cheaper|lowest cost)\b/i },
  { id: 'authorize', re: /\b(authori[sz]ation|authori[sz]e|requires? (setup|auth)|not connected)\b/i },
  { id: 'actual_vs_estimate', re: /\b(actual (vs|versus)|estimated (vs|versus)|vs\.? estimate|reconcil)/i },
  { id: 'why_assign', re: /\bwhy\b.*\bassign/i },
  { id: 'agents', re: /\b(which|what) agents?\b|\bagents? (are )?(working|doing)\b|\bworkload\b/i },
  { id: 'plan', re: /\b(plan|estimate|prepare|create|make)\b/i },
  { id: 'status', re: /\b(status|report|today|overview|summary|health)\b/i },
];

export async function runCommand(env, db, providers, text) {
  if (typeof text !== 'string' || !text.trim() || text.length > 500) throw new HttpError(400, 'text is required (max 500 chars)');
  const intent = INTENTS.find((i) => i.re.test(text))?.id ?? 'help';
  const base = { controller: CBO_ID, intent, source: 'D1 records (no AI call)' };

  switch (intent) {
    case 'status': {
      const r = await cboReport(env, db, providers);
      return { ...base, answer: `Tasks: ${Object.entries(r.tasks.byState).filter(([, n]) => n).map(([s, n]) => `${s} ${n}`).join(', ') || 'none recorded'}. Agents working ${r.agents.working}/${r.agents.total}. Pending approvals ${r.approvals.length}. Spend this month ${r.money.actualMonthInr === null ? 'unknown' : `₹${r.money.actualMonthInr}`}${r.money.unknownCostRows ? ' (some costs unknown)' : ''}. ${r.health.dispatchPaused ? 'Dispatch is PAUSED.' : ''}`, data: r };
    }
    case 'agents': {
      const tasks = await listTasks(db, { limit: 500 });
      const rows = REGISTRY.agents.map((a) => {
        const mine = tasks.filter((t) => t.agentId === a.id);
        const running = mine.filter((t) => t.state === 'RUNNING');
        return { id: a.id, name: a.name, role: a.role, running: running.map((t) => `${t.workflowTitle} · ${t.stepKey}`), ready: mine.filter((t) => t.state === 'READY').length, waiting: mine.filter((t) => ['ASSIGNED', 'WAITING_FOR_APPROVAL', 'BLOCKED'].includes(t.state)).length };
      });
      const busy = rows.filter((r) => r.running.length);
      return { ...base, answer: busy.length ? busy.map((r) => `${r.name}: ${r.running.join('; ')}`).join(' · ') : 'No agent is running a task right now.', data: rows };
    }
    case 'usage': {
      const f = await financeSummary(env, db);
      return { ...base, answer: f.tokensByModel.length ? f.tokensByModel.map((r) => `${r.provider}/${r.model} (${r.purpose}): ${r.calls} calls, ${r.input_tokens ?? '?'} in / ${r.output_tokens ?? '?'} out tokens`).join(' · ') : 'No provider calls recorded this month.', data: { month: f.month, byModel: f.tokensByModel, byProvider: f.actual.byProvider } };
    }
    case 'credits': {
      const f = await financeSummary(env, db);
      return { ...base, answer: `Remaining balances are UNKNOWN for every provider: ${f.quota.map((q) => `${q.provider} — ${q.note}`).join(' ')}`, data: f.quota };
    }
    case 'approvals': {
      const { results } = await db.prepare("SELECT a.id, a.action, a.summary, a.created_at, w.title FROM approvals a JOIN workflows w ON w.id = a.workflow_id WHERE a.status = 'pending' ORDER BY a.created_at").all();
      return { ...base, answer: results.length ? `${results.length} waiting: ${results.map((r) => `${r.title} → ${r.action}`).join('; ')}` : 'Nothing is waiting for your approval.', data: results };
    }
    case 'deadlines': {
      const tasks = await listTasks(db, { limit: 500 });
      const now = Date.now();
      const risk = tasks.filter((t) => t.deadline && !['COMPLETED', 'CANCELLED'].includes(t.state) && (t.overdue || ['BLOCKED', 'FAILED', 'WAITING_FOR_APPROVAL'].includes(t.state) || Date.parse(t.deadline) - now < 24 * 3600_000));
      const noDeadline = tasks.filter((t) => !t.deadline && !['COMPLETED', 'CANCELLED'].includes(t.state)).length;
      return { ...base, answer: risk.length ? risk.map((t) => `${t.workflowTitle} · ${t.stepKey} (${t.state}${t.overdue ? ', OVERDUE' : ''}, due ${t.deadline})`).join('; ') : `No task with a deadline is at risk.${noDeadline ? ` ${noDeadline} open task(s) have no deadline set.` : ''}`, data: risk };
    }
    case 'cheapest': {
      const settings = await getSettings(db);
      const day = new Date().toISOString().slice(0, 10);
      const rows = [];
      for (const m of [...new Set(SEEDED_PRICING.filter((p) => ['claude', 'gemini'].includes(p.provider)).map((p) => `${p.provider}|${p.model}`))]) {
        const [provider, model] = m.split('|');
        const p = await priceFor(db, provider, model, day);
        if (!p) continue;
        const usd = tokenCostUsd(p, 3000, 4000);
        rows.push({ provider, model, usdFor3kIn4kOut: Math.round(usd * 1e6) / 1e6, inr: toInr(usd, settings.fx_usd_inr), freeTier: p.freeTier, billing: settings.provider_billing[provider], configured: provider === 'claude' ? Boolean(env.ANTHROPIC_API_KEY) : Boolean(env.GEMINI_API_KEY) });
      }
      rows.sort((a, b) => a.usdFor3kIn4kOut - b.usdFor3kIn4kOut);
      return { ...base, answer: `Cheapest at paid rates for a typical step (3k in / 4k out tokens): ${rows.slice(0, 3).map((r) => `${r.model} $${r.usdFor3kIn4kOut}`).join(', ')}. Suitability still depends on the task; cheaper models can fail acceptance checks more often.`, data: rows };
    }
    case 'authorize': {
      const c = await listConnections(env, db, providers);
      const need = c.filter((x) => !['connected', 'manual_handoff'].includes(x.state));
      return { ...base, answer: need.map((x) => `${x.name}: ${x.state} — ${x.nextAction ?? ''}`).join(' · '), data: need };
    }
    case 'actual_vs_estimate': {
      const wf = await db.prepare('SELECT w.id, w.title FROM workflows w WHERE EXISTS (SELECT 1 FROM cost_ledger l WHERE l.workflow_id = w.id) ORDER BY w.updated_at DESC LIMIT 1').first();
      if (!wf) return { ...base, answer: 'No goal has recorded actual costs yet.', data: null };
      const est = await db.prepare("SELECT SUM(direct_inr) AS inr, SUM(direct_usd) AS usd, SUM(direct_inr IS NULL) AS unknown FROM cost_estimates e WHERE workflow_id = ? AND decision LIKE 'allowed%' AND created_at = (SELECT MAX(created_at) FROM cost_estimates e2 WHERE e2.task_id = e.task_id AND e2.decision LIKE 'allowed%')").bind(wf.id).first();
      const act = await db.prepare('SELECT SUM(amount_inr) AS inr, SUM(amount_usd) AS usd, SUM(amount_inr IS NULL) AS unknown FROM cost_ledger WHERE workflow_id = ?').bind(wf.id).first();
      const f = (v, u) => (v === null || u ? 'unknown (no INR rate or price)' : `₹${Math.round(v * 100) / 100}`);
      return { ...base, answer: `${wf.title}: estimated ${f(est.inr, est.unknown)}, actual ${f(act.inr, act.unknown)} (USD ${est.usd?.toFixed?.(4) ?? '?'} → ${act.usd?.toFixed?.(4) ?? '?'}).`, data: { workflow: wf, estimate: est, actual: act } };
    }
    case 'why_assign': {
      const id = /\b(tk_[a-z0-9]+)\b/i.exec(text)?.[1];
      const t = id ? await db.prepare('SELECT t.*, w.template FROM tasks t JOIN workflows w ON w.id = t.workflow_id WHERE t.id = ?').bind(id).first() : await db.prepare("SELECT t.*, w.template FROM tasks t JOIN workflows w ON w.id = t.workflow_id ORDER BY t.updated_at DESC LIMIT 1").first();
      if (!t) return { ...base, answer: 'No task found. Include a task id like tk_… in the question.', data: null };
      const a = agentById(t.agent_id);
      const step = TEMPLATES[t.template]?.steps.find((s) => s.key === t.step_key);
      const meta = await db.prepare('SELECT reassigned_from FROM task_meta WHERE task_id = ?').bind(t.id).first();
      const est = await db.prepare('SELECT provider, model, decision, confidence FROM cost_estimates WHERE task_id = ? ORDER BY created_at DESC LIMIT 1').bind(t.id).first();
      return { ...base, answer: `${t.step_key} → ${a?.name} (${a?.role}). ${meta?.reassigned_from ? `You reassigned it from ${meta.reassigned_from}.` : step ? `The "${TEMPLATES[t.template].name}" template assigns this step to ${step.agent} because its contract produces "${step.deliverable}".` : ''} Mission: ${a?.mission}${est ? ` Engine: ${est.provider}/${est.model} (first configured engine for this agent); dispatch decision: ${est.decision}.` : ''}`, data: { taskId: t.id } };
    }
    case 'pause':
      return { ...base, answer: 'This will stop NEW chargeable tasks from starting. Requests already sent to a provider finish normally (they cannot be recalled). Confirm to apply.', proposedAction: { label: 'Pause new chargeable tasks', method: 'PUT', path: '/api/settings', body: { dispatchPaused: true } } };
    case 'resume':
      return { ...base, answer: 'Confirm to let queued tasks start again (budgets and approvals still apply).', proposedAction: { label: 'Resume dispatch', method: 'PUT', path: '/api/settings', body: { dispatchPaused: false } } };
    case 'plan': {
      const template = templateFor(text);
      const n = Math.min(10, countIn(text));
      const plan = await planGoal(env, db, { template, title: text.slice(0, 120), count: n });
      const noPublish = /\b(do not|don't|dont|without) publish/i.test(text);
      const t = plan.totals;
      const extra = [];
      if (/\bvideo|reel|short/i.test(text)) extra.push('Video generation itself happens in Google Flow (manual handoff, uses your Google AI Pro credits); that cost is not counted here.');
      if (/\bvoice|male-only|female-only|toddler|dad|mom\b/i.test(text)) extra.push('Use Voice Library → Smart Voice Director with this brief; approved voices are locked per project and character.');
      if (/male[- ]only/i.test(text)) extra.push('Male-only requirement noted: no female duet will be suggested.');
      plan.notes = extra;
      return {
        ...base,
        answer: `DRAFT plan: ${n} × "${plan.templateName}" (${plan.steps.length} steps each). Estimated ${t.directInr !== null ? `₹${t.directInr}` : t.directUsd !== null ? `$${t.directUsd} (no INR rate)` : 'unknown'} (conservative ${t.conservativeInr !== null ? `₹${t.conservativeInr}` : t.conservativeUsd !== null ? `$${t.conservativeUsd}` : 'unknown'}), confidence ${plan.confidence}, about ${Math.round(t.durationSec / 60)} min per goal. Nothing has been started.${plan.approvalsInPlan.length ? ` Publishing steps (${plan.approvalsInPlan.join(', ')}) always stop for your approval${noPublish ? ' — nothing will be published' : ''}.` : ''}${extra.length ? ` ${extra.join(' ')}` : ''}`,
        data: plan,
        proposedAction: { label: `Start ${n === 1 ? 'this goal' : `${n} goals`}`, method: 'POST', path: '/api/workflows', body: { template, title: text.slice(0, 120), goal: text }, repeat: n },
      };
    }
    default:
      return { ...base, intent: 'help', answer: 'I answer from studio records. Try: "today’s status", "which agents are working", "plan five reels and estimate the cost", "token usage by provider", "remaining credits", "tasks at risk of missing deadlines", "cheapest model", "pause tasks that could incur API charges", "which provider requires authorization", "tasks waiting for my approval", "actual vs estimated cost of my last project", "why was tk_… assigned".' };
  }
}
