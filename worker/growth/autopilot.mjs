// MUSHAK autopilot — a growth cycle every N hours (default 4), fully recorded:
//   INPUTS  what Mushak saw (campaigns, pipeline per campaign, limits used, approvals waiting)
//   PLAN    the steps it chose and why (finish the pipeline first: score → draft → research → find)
//   OUTPUTS what each step produced (leads with sources, facts, scores, drafts) or why it stopped
// Steps run a few per cron tick (every 5 min), so a cycle never hits the Worker time limit.
// Every step goes through the existing agent jobs, so campaign/brand budgets, daily job limits,
// the CFO pause switch and the approval gate all still apply. Mushak NEVER approves or sends:
// drafts wait in Growth → Approvals for the owner.
import { HttpError, newId, nowIso } from '../util.mjs';
import { GROWTH_BRAND_IDS, GROWTH_BRANDS, getBrandConfig } from './brands.mjs';
import { createCampaign, setCampaignStatus } from './core.mjs';
import * as agents from './agents.mjs';

const STEPS_PER_TICK = 3;
const STALE_CYCLE_MS = 3 * 3_600_000; // a cycle not finished in 3 h is closed as partial

/** Starting campaigns Mushak opens for a brand that has none yet (the owner can edit/pause/cancel). */
const STARTERS = {
  littleloop: { name: 'Mushak · Kids & family brands', objective: 'sponsorship', segment: 'business', audience: "Children's and family brands, kids edtech and children's publishers", geography: 'India' },
  sunverse: { name: 'Mushak · Artists & music partners', objective: 'creator_collaboration', segment: 'business', audience: 'Independent artists, producers, small labels and music curators', geography: 'India' },
  foliocraft: { name: 'Mushak · Bootcamps & career communities', objective: 'partnership', segment: 'business', audience: 'Design/dev bootcamps, colleges and career communities', geography: 'India' },
};

export async function getSettings(db) {
  let s = await db.prepare('SELECT * FROM growth_settings WHERE id = 1').first();
  if (!s) {
    await db.prepare('INSERT INTO growth_settings (id, autopilot, every_hours, max_steps, updated_at) VALUES (1, 1, 4, 8, ?) ON CONFLICT(id) DO NOTHING').bind(nowIso()).run();
    s = await db.prepare('SELECT * FROM growth_settings WHERE id = 1').first();
  }
  return { autopilot: Boolean(s.autopilot), everyHours: s.every_hours, maxSteps: s.max_steps, updatedAt: s.updated_at };
}

export async function saveSettings(db, b) {
  const cur = await getSettings(db);
  const autopilot = b.autopilot === undefined ? cur.autopilot : Boolean(b.autopilot);
  const every = b.everyHours === undefined ? cur.everyHours : Number(b.everyHours);
  const steps = b.maxSteps === undefined ? cur.maxSteps : Number(b.maxSteps);
  if (!Number.isInteger(every) || every < 1 || every > 24) throw new HttpError(400, 'everyHours must be 1–24');
  if (!Number.isInteger(steps) || steps < 1 || steps > 30) throw new HttpError(400, 'maxSteps must be 1–30');
  await db.prepare('UPDATE growth_settings SET autopilot = ?, every_hours = ?, max_steps = ?, updated_at = ? WHERE id = 1').bind(autopilot ? 1 : 0, every, steps, nowIso()).run();
  return getSettings(db);
}

/* ---------------- inputs ---------------- */
async function ensureStarterCampaigns(db) {
  const opened = [];
  for (const brand of GROWTH_BRAND_IDS) {
    const any = await db.prepare('SELECT id FROM growth_campaigns WHERE brand = ? LIMIT 1').bind(brand).first();
    if (any) continue; // respect the owner's own campaigns (and any they cancelled)
    const cfg = await getBrandConfig(db, brand);
    const st = STARTERS[brand];
    const c = await createCampaign(db, { brand, ...st, criteria: cfg.idealProfile, threshold: 60, dailyJobLimit: 20, maxLeads: 60, budgetInr: 0, researchDepth: 'standard', channel: 'manual' });
    await setCampaignStatus(db, c.id, 'activate');
    opened.push({ brand, campaign: c.name, objective: c.objective });
  }
  return opened;
}

async function campaignState(db, c) {
  const n = async (sql, ...args) => (await db.prepare(sql).bind(...args).first())?.n ?? 0;
  const today = `${nowIso().slice(0, 10)}T00:00:00Z`;
  return {
    id: c.id,
    brand: c.brand,
    name: c.name,
    objective: c.objective,
    status: c.status,
    threshold: c.threshold,
    leads: await n("SELECT COUNT(*) AS n FROM growth_leads WHERE campaign_id = ? AND origin != 'demo'", c.id),
    maxLeads: c.max_leads,
    unresearched: await n("SELECT COUNT(*) AS n FROM growth_leads WHERE campaign_id = ? AND origin != 'demo' AND stage IN ('new','researching') AND researched_at IS NULL", c.id),
    unscored: await n("SELECT COUNT(*) AS n FROM growth_leads WHERE campaign_id = ? AND origin != 'demo' AND researched_at IS NOT NULL AND score IS NULL AND stage NOT IN ('suppressed','lost')", c.id),
    readyToDraft: await n(
      "SELECT COUNT(*) AS n FROM growth_leads l WHERE l.campaign_id = ? AND l.origin != 'demo' AND l.stage = 'qualified' AND l.score >= ? AND NOT EXISTS (SELECT 1 FROM growth_drafts d WHERE d.lead_id = l.id AND d.status NOT IN ('rejected','cancelled'))",
      c.id,
      c.threshold,
    ),
    waitingApproval: await n("SELECT COUNT(*) AS n FROM growth_drafts WHERE campaign_id = ? AND status = 'pending_approval'", c.id),
    jobsToday: await n("SELECT COUNT(*) AS n FROM growth_jobs WHERE campaign_id = ? AND created_at >= ? AND status != 'blocked'", c.id, today),
    dailyJobLimit: c.daily_job_limit,
  };
}

/* ---------------- planning ---------------- */
async function leadsFor(db, sql, ...args) {
  return (await db.prepare(sql).bind(...args).all()).results;
}

/** Finish what is in the pipeline before finding more: score → draft → research → discover. */
async function buildPlan(db, camps, maxSteps) {
  const plan = [];
  const push = (s) => plan.length < maxSteps && plan.push({ id: `s${plan.length + 1}`, status: 'pending', ...s });
  for (const kind of ['qualify', 'draft', 'research', 'discover']) {
    for (const c of camps) {
      const room = Math.max(0, c.dailyJobLimit - c.jobsToday - plan.filter((p) => p.campaignId === c.id).length);
      if (!room) continue;
      if (kind === 'qualify')
        for (const l of await leadsFor(db, "SELECT id, name FROM growth_leads WHERE campaign_id = ? AND origin != 'demo' AND researched_at IS NOT NULL AND score IS NULL AND stage NOT IN ('suppressed','lost') ORDER BY updated_at LIMIT 2", c.id))
          push({ kind, agent: 'SOMA', brand: c.brand, campaignId: c.id, campaign: c.name, leadId: l.id, lead: l.name, why: `${l.name} is researched but has no score yet.` });
      if (kind === 'draft')
        for (const l of await leadsFor(
          db,
          "SELECT l.id, l.name, l.score FROM growth_leads l WHERE l.campaign_id = ? AND l.origin != 'demo' AND l.stage = 'qualified' AND l.score >= ? AND NOT EXISTS (SELECT 1 FROM growth_drafts d WHERE d.lead_id = l.id AND d.status NOT IN ('rejected','cancelled')) ORDER BY l.score DESC LIMIT 2",
          c.id,
          c.threshold,
        ))
          push({ kind, agent: 'SAMVADA', brand: c.brand, campaignId: c.id, campaign: c.name, leadId: l.id, lead: l.name, why: `${l.name} scored ${l.score} (≥ ${c.threshold}); write a first message for your approval.` });
      if (kind === 'research')
        for (const l of await leadsFor(db, "SELECT id, name FROM growth_leads WHERE campaign_id = ? AND origin != 'demo' AND stage IN ('new','researching') AND researched_at IS NULL ORDER BY created_at LIMIT 2", c.id))
          push({ kind, agent: 'NARADA', brand: c.brand, campaignId: c.id, campaign: c.name, leadId: l.id, lead: l.name, why: `${l.name} is new; verify facts and find the right contact role.` });
      if (kind === 'discover' && c.status === 'active' && c.leads < c.maxLeads && c.unresearched < 3)
        push({ kind, agent: 'NARADA', brand: c.brand, campaignId: c.id, campaign: c.name, count: 3, why: `Only ${c.unresearched} unresearched lead(s) left and ${c.maxLeads - c.leads} slot(s) free; find 3 more.` });
    }
  }
  return plan;
}

/* ---------------- running ---------------- */
/** Blueprint steps may leave the lead open ("research the next new lead"); pick it when the step runs. */
async function resolveLead(db, s) {
  if (s.leadId || s.kind === 'discover') return true;
  const sql = {
    research: "SELECT id, name FROM growth_leads WHERE campaign_id = ? AND origin != 'demo' AND stage IN ('new','researching') AND researched_at IS NULL ORDER BY created_at LIMIT 1",
    qualify: "SELECT id, name FROM growth_leads WHERE campaign_id = ? AND origin != 'demo' AND researched_at IS NOT NULL AND score IS NULL AND stage NOT IN ('suppressed','lost') ORDER BY updated_at LIMIT 1",
    draft: "SELECT l.id, l.name FROM growth_leads l JOIN growth_campaigns c ON c.id = l.campaign_id WHERE l.campaign_id = ? AND l.origin != 'demo' AND l.stage = 'qualified' AND l.score >= c.threshold AND NOT EXISTS (SELECT 1 FROM growth_drafts d WHERE d.lead_id = l.id AND d.status NOT IN ('rejected','cancelled')) ORDER BY l.score DESC LIMIT 1",
  }[s.kind];
  const l = sql ? await db.prepare(sql).bind(s.campaignId).first() : null;
  if (!l) return false;
  s.leadId = l.id;
  s.lead = l.name;
  return true;
}

async function runStep(env, db, s, deps) {
  if (s.kind === 'discover') {
    const r = await agents.discover(env, db, s.campaignId, { count: s.count ?? 3 }, deps);
    return {
      jobId: r.jobId,
      text: `Found ${r.created.length} new lead(s)${r.skipped.length ? `, skipped ${r.skipped.length}` : ''}.`,
      leads: r.created.map((l) => ({ id: l.id, name: l.name, website: l.website, category: l.category, sources: (l.sources ?? []).slice(0, 3).map((x) => x.url) })),
      skipped: r.skipped.slice(0, 10),
    };
  }
  if (s.kind === 'research') {
    const r = await agents.research(env, db, s.leadId, deps);
    const facts = (r.lead.evidence.match(/^- /gm) ?? []).length;
    return { jobId: r.jobId, text: `Researched ${r.lead.name}: ${facts} fact line(s), ${r.lead.sources.length} source(s)${r.lead.contactRole ? `, contact role: ${r.lead.contactRole}` : ''}.`, summary: r.lead.evidence.split('\n')[0].replace(/\*\*/g, '').slice(0, 300), sources: r.lead.sources.slice(0, 5).map((x) => x.url) };
  }
  if (s.kind === 'qualify') {
    const r = await agents.qualify(env, db, s.leadId, deps);
    return { jobId: r.jobId, text: `Scored ${r.lead.name}: ${r.qualification.score}/100 (${r.qualification.confidence} confidence)${r.lead.stage === 'qualified' ? ' → qualified' : ''}.`, score: r.qualification.score, missing: r.qualification.missing, nextAction: r.qualification.nextAction };
  }
  if (s.kind === 'draft') {
    const r = await agents.draftOutreach(env, db, s.leadId, {}, deps);
    return { jobId: r.jobId, text: `Draft ready for your approval: “${r.draft.subject || '(no subject)'}”.`, draftId: r.draft.id, subject: r.draft.subject, preview: r.draft.body.slice(0, 280) };
  }
  throw new Error(`Unknown step ${s.kind}`);
}

async function finish(db, cycle, plan, status, error = null) {
  const jobs = (await db.prepare('SELECT status, cost_usd, input_tokens, output_tokens FROM growth_jobs WHERE created_at >= ?').bind(cycle.started_at).all()).results;
  const done = plan.filter((p) => p.status === 'done');
  const outputs = {
    stepsPlanned: plan.length,
    stepsDone: done.length,
    stepsFailed: plan.filter((p) => p.status === 'failed').length,
    stepsSkipped: plan.filter((p) => p.status === 'skipped').length,
    leadsFound: done.filter((p) => p.kind === 'discover').reduce((a, p) => a + (p.result?.leads?.length ?? 0), 0),
    researched: done.filter((p) => p.kind === 'research').length,
    scored: done.filter((p) => p.kind === 'qualify').length,
    draftsForApproval: done.filter((p) => p.kind === 'draft').map((p) => ({ lead: p.lead, draftId: p.result?.draftId, subject: p.result?.subject })),
    costUsd: jobs.reduce((a, j) => a + (j.cost_usd ?? 0), 0),
    tokens: jobs.reduce((a, j) => a + (j.input_tokens ?? 0) + (j.output_tokens ?? 0), 0),
  };
  const parts = [];
  if (outputs.leadsFound) parts.push(`found ${outputs.leadsFound} lead(s)`);
  if (outputs.researched) parts.push(`researched ${outputs.researched}`);
  if (outputs.scored) parts.push(`scored ${outputs.scored}`);
  if (outputs.draftsForApproval.length) parts.push(`${outputs.draftsForApproval.length} draft(s) waiting for your approval`);
  if (outputs.stepsFailed) parts.push(`${outputs.stepsFailed} step(s) failed`);
  const summary = error ?? (parts.length ? `Mushak ${parts.join(', ')}.` : plan.length ? 'Steps ran but produced nothing new.' : 'Nothing to do this cycle.');
  await db.prepare('UPDATE growth_cycles SET status = ?, finished_at = ?, plan_json = ?, outputs_json = ?, summary = ?, error = ? WHERE id = ?').bind(status, nowIso(), JSON.stringify(plan), JSON.stringify(outputs), summary.slice(0, 600), error, cycle.id).run();
}

/** Start a cycle: read inputs, open starter campaigns if a brand has none, write the plan. */
export async function startCycle(env, db, trigger = 'manual') {
  const open = await db.prepare("SELECT id FROM growth_cycles WHERE status = 'running'").first();
  if (open) throw new HttpError(409, 'A Mushak cycle is already running');
  const settings = await getSettings(db);
  const id = newId('gcyc');
  const started = nowIso();
  if (!env.GEMINI_API_KEY) {
    const inputs = { settings, problem: 'GEMINI_API_KEY is not set' };
    await db.prepare("INSERT INTO growth_cycles (id, trigger_kind, status, started_at, finished_at, inputs_json, plan_json, summary, error) VALUES (?,?,'skipped',?,?,?,'[]',?,?)").bind(id, trigger, started, started, JSON.stringify(inputs), 'Skipped: Gemini is not configured.', 'GEMINI_API_KEY is not set (Settings → API keys).').run();
    return getCycle(db, id);
  }
  const openedCampaigns = await ensureStarterCampaigns(db);
  const camps = (await db.prepare("SELECT * FROM growth_campaigns WHERE status = 'active' ORDER BY updated_at").all()).results;
  const state = [];
  for (const c of camps) state.push(await campaignState(db, c));
  const plan = await buildPlan(db, state, settings.maxSteps);
  const inputs = {
    settings,
    openedCampaigns,
    campaigns: state,
    waitingForApproval: (await db.prepare("SELECT COUNT(*) AS n FROM growth_drafts WHERE status = 'pending_approval'").first()).n,
    rules: ['Finish the pipeline first: score → draft → research → find new leads', `At most ${settings.maxSteps} steps per cycle`, 'Campaign daily job limits, ₹ budgets, monthly caps and the CFO pause switch apply', 'Mushak never approves or sends — drafts wait for you'],
    brands: GROWTH_BRAND_IDS.map((b) => GROWTH_BRANDS[b].name),
  };
  await db.prepare("INSERT INTO growth_cycles (id, trigger_kind, status, started_at, inputs_json, plan_json) VALUES (?,?,'running',?,?,?)").bind(id, trigger, started, JSON.stringify(inputs), JSON.stringify(plan)).run();
  if (!plan.length) await finish(db, { id, started_at: started }, plan, 'done');
  return getCycle(db, id);
}

/** Run up to `n` pending steps of the open cycle; close it when nothing is left. */
export async function advance(env, db, { n = STEPS_PER_TICK, deps = {} } = {}) {
  const cycle = await db.prepare("SELECT * FROM growth_cycles WHERE status = 'running' ORDER BY started_at LIMIT 1").first();
  if (!cycle) return null;
  const plan = JSON.parse(cycle.plan_json);
  if (Date.now() - Date.parse(cycle.started_at) > STALE_CYCLE_MS) {
    for (const p of plan) if (p.status === 'pending') Object.assign(p, { status: 'skipped', result: { text: 'Cycle ran out of time.' } });
    await finish(db, cycle, plan, 'partial');
    return getCycle(db, cycle.id);
  }
  let ran = 0;
  let fatal = null;
  for (const s of plan) {
    if (s.status !== 'pending' || ran >= n) continue;
    ran++;
    s.startedAt = nowIso();
    try {
      if (!(await resolveLead(db, s))) {
        Object.assign(s, { status: 'skipped', result: { text: `No lead ready to ${s.kind} in this campaign yet.` }, finishedAt: nowIso() });
        await db.prepare('UPDATE growth_cycles SET plan_json = ? WHERE id = ?').bind(JSON.stringify(plan), cycle.id).run();
        continue;
      }
      s.result = await runStep(env, db, s, deps);
      s.status = 'done';
    } catch (e) {
      s.status = 'failed';
      s.result = { text: String(e.message ?? e).slice(0, 400) };
      if (/not configured|dispatch is paused|Monthly agent-job limit/i.test(s.result.text)) fatal = s.result.text;
    }
    s.finishedAt = nowIso();
    await db.prepare('UPDATE growth_cycles SET plan_json = ? WHERE id = ?').bind(JSON.stringify(plan), cycle.id).run();
    if (fatal) break;
  }
  if (fatal) for (const p of plan) if (p.status === 'pending') Object.assign(p, { status: 'skipped', result: { text: `Skipped: ${fatal}` } });
  if (!plan.some((p) => p.status === 'pending')) {
    const anyDone = plan.some((p) => p.status === 'done');
    await finish(db, cycle, plan, fatal && !anyDone ? 'failed' : plan.every((p) => p.status === 'done') ? 'done' : 'partial', fatal && !anyDone ? `Stopped: ${fatal}` : null);
  }
  return getCycle(db, cycle.id);
}

/** Cron (every 5 min): advance the open cycle, or start a new one when the interval has passed. */
export async function scheduledMushak(env, db, deps = {}) {
  const s = await getSettings(db);
  const open = await db.prepare("SELECT id FROM growth_cycles WHERE status = 'running'").first();
  if (open) return advance(env, db, { deps });
  if (!s.autopilot) return null;
  const last = await db.prepare("SELECT started_at FROM growth_cycles WHERE trigger_kind = 'schedule' ORDER BY started_at DESC LIMIT 1").first();
  if (last && Date.now() - Date.parse(last.started_at) < s.everyHours * 3_600_000 - 5 * 60_000) return null;
  await startCycle(env, db, 'schedule');
  return advance(env, db, { deps });
}

function cycleOut(r) {
  return r && { id: r.id, trigger: r.trigger_kind, status: r.status, startedAt: r.started_at, finishedAt: r.finished_at, inputs: JSON.parse(r.inputs_json || '{}'), plan: JSON.parse(r.plan_json || '[]'), outputs: r.outputs_json ? JSON.parse(r.outputs_json) : null, summary: r.summary, error: r.error };
}
export async function getCycle(db, id) {
  const r = await db.prepare('SELECT * FROM growth_cycles WHERE id = ?').bind(id).first();
  if (!r) throw new HttpError(404, 'Cycle not found');
  return cycleOut(r);
}
export async function listCycles(db, limit = 30) {
  const rows = (await db.prepare('SELECT * FROM growth_cycles ORDER BY started_at DESC LIMIT ?').bind(Math.min(100, limit)).all()).results;
  const s = await getSettings(db);
  const lastSched = await db.prepare("SELECT started_at FROM growth_cycles WHERE trigger_kind = 'schedule' ORDER BY started_at DESC LIMIT 1").first();
  const nextRunAt = s.autopilot ? new Date(lastSched ? Date.parse(lastSched.started_at) + s.everyHours * 3_600_000 : Date.now() + 5 * 60_000).toISOString() : null;
  return { settings: s, nextRunAt, cycles: rows.map(cycleOut) };
}

/* ---------------- owner commands → blueprint → run ---------------- */
const KINDS = ['discover', 'research', 'qualify', 'draft'];
const AGENT_OF = { discover: 'NARADA', research: 'NARADA', qualify: 'SOMA', draft: 'SAMVADA' };

/**
 * Validates a blueprint Mushak wrote from the owner's command, opens its campaign if needed, and puts
 * the steps into a run (a new one, or appended to the run already going). Returns what was queued.
 * Shape: { title, brand, campaign: { id } | { new: {name, objective, segment?, audience?, geography?, criteria?} },
 *          steps: [{ kind, count? }], expected? }
 */
export async function runBlueprint(env, db, bp, command) {
  if (!bp || typeof bp !== 'object') throw new HttpError(400, 'Blueprint missing');
  const brand = String(bp.brand ?? '');
  if (!GROWTH_BRAND_IDS.includes(brand)) throw new HttpError(400, 'Blueprint brand must be littleloop, sunverse or foliocraft');
  if (!env.GEMINI_API_KEY) throw new HttpError(409, 'Gemini is not configured (Settings → API keys), so Mushak cannot run.');
  let campaign;
  if (bp.campaign?.id) {
    campaign = await db.prepare('SELECT * FROM growth_campaigns WHERE id = ? AND brand = ?').bind(String(bp.campaign.id), brand).first();
    if (!campaign) throw new HttpError(400, 'Blueprint campaign not found for that brand');
    if (['cancelled', 'completed'].includes(campaign.status)) throw new HttpError(409, `Campaign "${campaign.name}" is ${campaign.status}`);
    if (campaign.status !== 'active') await setCampaignStatus(db, campaign.id, campaign.status === 'draft' ? 'activate' : 'resume');
  } else if (bp.campaign?.new) {
    const n = bp.campaign.new;
    const name = String(n.name ?? bp.title ?? 'Mushak campaign').slice(0, 110);
    const existing = await db.prepare('SELECT * FROM growth_campaigns WHERE brand = ? AND name = ?').bind(brand, name).first();
    if (existing) campaign = existing;
    else {
      const c = await createCampaign(db, { brand, name, objective: n.objective, segment: n.segment ?? 'business', audience: n.audience ?? '', geography: n.geography ?? 'India', criteria: n.criteria ?? '', threshold: 60, dailyJobLimit: 30, maxLeads: 100, budgetInr: 0, researchDepth: 'standard', channel: 'manual' });
      await setCampaignStatus(db, c.id, 'activate');
      campaign = await db.prepare('SELECT * FROM growth_campaigns WHERE id = ?').bind(c.id).first();
    }
    if (campaign.status !== 'active') await setCampaignStatus(db, campaign.id, campaign.status === 'draft' ? 'activate' : 'resume');
  } else throw new HttpError(400, 'Blueprint needs a campaign (existing id or new)');

  const steps = [];
  for (const raw of Array.isArray(bp.steps) ? bp.steps.slice(0, 12) : []) {
    const kind = String(raw?.kind ?? '');
    if (!KINDS.includes(kind)) continue;
    const count = Math.max(1, Math.min(10, Math.round(Number(raw.count) || (kind === 'discover' ? 5 : 3))));
    if (kind === 'discover') {
      for (let left = count; left > 0; left -= 5) steps.push({ kind, count: Math.min(5, left), why: `Your command: find ${count} lead(s).` });
    } else for (let i = 0; i < count; i++) steps.push({ kind, why: `Your command: ${kind} the next lead that is ready.` });
  }
  if (!steps.length) throw new HttpError(400, 'Blueprint has no runnable steps');
  const queued = steps.slice(0, 20).map((s) => ({ status: 'pending', agent: AGENT_OF[s.kind], brand, campaignId: campaign.id, campaign: campaign.name, source: 'command', ...s }));

  const open = await db.prepare("SELECT * FROM growth_cycles WHERE status = 'running' ORDER BY started_at LIMIT 1").first();
  if (open) {
    const plan = JSON.parse(open.plan_json);
    const base = plan.length;
    queued.forEach((s, i) => (s.id = `s${base + i + 1}`));
    const inputs = JSON.parse(open.inputs_json || '{}');
    inputs.commands = [...(inputs.commands ?? []), { at: nowIso(), command, blueprint: bp }];
    await db.prepare('UPDATE growth_cycles SET plan_json = ?, inputs_json = ? WHERE id = ?').bind(JSON.stringify([...plan, ...queued]), JSON.stringify(inputs), open.id).run();
    return { cycleId: open.id, appended: true, campaign: { id: campaign.id, name: campaign.name }, steps: queued.length };
  }
  const id = newId('gcyc');
  queued.forEach((s, i) => (s.id = `s${i + 1}`));
  const inputs = { source: 'Owner command in chat', commands: [{ at: nowIso(), command, blueprint: bp }], campaigns: [await campaignState(db, campaign)], rules: ['Runs inside the campaign daily job limit and ₹0 budget (free Gemini)', 'Mushak never approves or sends — drafts wait for you'] };
  await db.prepare("INSERT INTO growth_cycles (id, trigger_kind, status, started_at, inputs_json, plan_json) VALUES (?, 'manual', 'running', ?, ?, ?)").bind(id, nowIso(), JSON.stringify(inputs), JSON.stringify(queued)).run();
  return { cycleId: id, appended: false, campaign: { id: campaign.id, name: campaign.name }, steps: queued.length };
}
