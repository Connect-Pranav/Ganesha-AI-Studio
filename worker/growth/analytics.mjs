// GANESHA GROWTH AI — dashboard numbers. Everything is counted from persisted rows. Demo rows
// (origin = 'demo') are counted separately and never mixed into real metrics.
import { getSettings, toInr } from '../finance.mjs';
import { nowIso, newId } from '../util.mjs';
import { assertBrand, GROWTH_BRAND_IDS, getBrandConfig } from './brands.mjs';
import { activity } from './core.mjs';

const AFTER_SENT = ['sent', 'replied', 'meeting_scheduled', 'proposal', 'negotiation', 'won'];
const rate = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

async function brandMetrics(db, brand, fx) {
  const real = "origin != 'demo'";
  const q = async (sql, ...args) => (await db.prepare(sql).bind(brand, ...args).first())?.n ?? 0;
  const inList = (xs) => xs.map((x) => `'${x}'`).join(',');
  const leads = await q(`SELECT COUNT(*) AS n FROM growth_leads WHERE brand = ? AND ${real}`);
  // Qualified = scored at or above its campaign threshold (60 when no campaign), or already won/meeting.
  const qualified = await q(`SELECT COUNT(*) AS n FROM growth_leads l LEFT JOIN growth_campaigns c ON c.id = l.campaign_id WHERE l.brand = ? AND l.${real} AND ((l.score IS NOT NULL AND l.score >= COALESCE(c.threshold, 60) AND l.stage != 'suppressed') OR l.stage IN ('meeting_scheduled','proposal','negotiation','won'))`);
  const sentLeads = await q(`SELECT COUNT(*) AS n FROM growth_leads WHERE brand = ? AND ${real} AND stage IN (${inList(AFTER_SENT)})`);
  const repliedLeads = await q(`SELECT COUNT(DISTINCT r.lead_id) AS n FROM growth_replies r JOIN growth_leads l ON l.id = r.lead_id WHERE r.brand = ? AND l.${real}`);
  const pending = await q("SELECT COUNT(*) AS n FROM growth_drafts d JOIN growth_leads l ON l.id = d.lead_id WHERE d.brand = ? AND d.status = 'pending_approval' AND l.origin != 'demo'");
  const approved = await q("SELECT COUNT(*) AS n FROM growth_drafts d JOIN growth_leads l ON l.id = d.lead_id WHERE d.brand = ? AND d.status = 'approved' AND l.origin != 'demo'");
  const sent = await q("SELECT COUNT(*) AS n FROM growth_drafts d JOIN growth_leads l ON l.id = d.lead_id WHERE d.brand = ? AND d.status = 'sent' AND l.origin != 'demo'");
  const meetings = await q("SELECT COUNT(*) AS n FROM growth_tasks t LEFT JOIN growth_leads l ON l.id = t.lead_id WHERE t.brand = ? AND t.kind = 'meeting' AND t.confirmed = 1 AND COALESCE(l.origin,'manual') != 'demo'");
  const active = await q(`SELECT COUNT(*) AS n FROM growth_leads WHERE brand = ? AND ${real} AND stage IN ('replied','meeting_scheduled','proposal','negotiation')`);
  const won = await q(`SELECT COUNT(*) AS n FROM growth_leads WHERE brand = ? AND ${real} AND stage = 'won'`);
  const lost = await q(`SELECT COUNT(*) AS n FROM growth_leads WHERE brand = ? AND ${real} AND stage = 'lost'`);
  const demo = await q("SELECT COUNT(*) AS n FROM growth_leads WHERE brand = ? AND origin = 'demo'");
  const cost = await db.prepare("SELECT COALESCE(SUM(cost_usd),0) AS usd, COUNT(*) AS jobs, SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed, SUM(CASE WHEN status='blocked' THEN 1 ELSE 0 END) AS blocked, SUM(CASE WHEN status='succeeded' AND cost_usd IS NULL THEN 1 ELSE 0 END) AS unknown, COALESCE(SUM(input_tokens),0) AS tin, COALESCE(SUM(output_tokens),0) AS tout FROM growth_jobs WHERE brand = ?").bind(brand).first();
  return {
    leads, qualified, pendingApprovals: pending, approved, sent, repliedLeads, replyRate: rate(repliedLeads, sentLeads), meetingsConfirmed: meetings, activeOpportunities: active, won, lost,
    qualificationRate: rate(qualified, leads), costUsd: cost.usd, costInr: toInr(cost.usd, fx), jobs: cost.jobs, failedJobs: cost.failed ?? 0, blockedJobs: cost.blocked ?? 0, jobsWithUnknownCost: cost.unknown ?? 0,
    tokens: { input: cost.tin, output: cost.tout }, costPerQualifiedUsd: qualified && cost.unknown === 0 ? cost.usd / qualified : null, costPerMeetingUsd: meetings && cost.unknown === 0 ? cost.usd / meetings : null, demoLeads: demo,
  };
}

export async function overview(db, brand = null) {
  const brands = brand ? [assertBrand(brand)] : GROWTH_BRAND_IDS;
  const fx = (await getSettings(db)).fx_usd_inr;
  const per = {};
  for (const b of brands) per[b] = { name: (await getBrandConfig(db, b)).name, ...(await brandMetrics(db, b, fx)) };
  const keys = ['leads', 'qualified', 'pendingApprovals', 'approved', 'sent', 'repliedLeads', 'meetingsConfirmed', 'activeOpportunities', 'won', 'lost', 'costUsd', 'jobs', 'demoLeads', 'jobsWithUnknownCost'];
  const total = Object.fromEntries(keys.map((k) => [k, brands.reduce((a, b) => a + (per[b][k] ?? 0), 0)]));
  total.costInr = toInr(total.costUsd, fx);
  const placeholders = brands.map(() => '?').join(',');
  const recent = (await db.prepare(`SELECT a.*, l.name AS lead_name FROM growth_activities a LEFT JOIN growth_leads l ON l.id = a.lead_id WHERE a.brand IN (${placeholders}) ORDER BY a.created_at DESC LIMIT 20`).bind(...brands).all()).results;
  const now = nowIso();
  const attention = [];
  for (const c of (await db.prepare(`SELECT * FROM growth_campaigns WHERE brand IN (${placeholders}) AND status IN ('active','paused')`).bind(...brands).all()).results) {
    const pend = (await db.prepare("SELECT COUNT(*) AS n FROM growth_drafts WHERE campaign_id = ? AND status = 'pending_approval'").bind(c.id).first()).n;
    const stalled = (await db.prepare("SELECT COUNT(*) AS n FROM growth_leads WHERE campaign_id = ? AND follow_up_at IS NOT NULL AND follow_up_at < ? AND stage NOT IN ('won','lost','suppressed')").bind(c.id, now).first()).n;
    const blocked = (await db.prepare("SELECT error FROM growth_jobs WHERE campaign_id = ? AND status = 'blocked' ORDER BY created_at DESC LIMIT 1").bind(c.id).first())?.error;
    const why = [pend && `${pend} draft(s) waiting for approval`, stalled && `${stalled} overdue follow-up(s)`, c.status === 'paused' && 'paused', blocked && `last job stopped: ${blocked}`].filter(Boolean);
    if (why.length) attention.push({ id: c.id, brand: c.brand, name: c.name, why });
  }
  // Foliocraft: individual and business campaigns are reported separately, never mixed.
  const segments = {};
  if (brands.includes('foliocraft')) {
    for (const seg of ['individual', 'business']) {
      const r = await db.prepare("SELECT COUNT(*) AS leads, SUM(CASE WHEN l.stage = 'won' THEN 1 ELSE 0 END) AS won, SUM(CASE WHEN l.stage IN ('sent','replied','meeting_scheduled','proposal','negotiation','won') THEN 1 ELSE 0 END) AS sent FROM growth_leads l JOIN growth_campaigns c ON c.id = l.campaign_id WHERE l.brand = 'foliocraft' AND c.segment = ? AND l.origin != 'demo'").bind(seg).first();
      segments[seg] = { leads: r.leads ?? 0, sent: r.sent ?? 0, won: r.won ?? 0, conversionRate: rate(r.won ?? 0, r.sent ?? 0) };
    }
  }
  return { brands: per, total, recent, attention, foliocraftSegments: brands.includes('foliocraft') ? segments : null, note: 'Counted from saved records. Demo leads are excluded from these numbers. Cost is the sum of agent-job costs where a price is known.' };
}

/* ---------------- demo mode (clearly labelled, removable) ---------------- */
const DEMO = {
  littleloop: [{ name: 'DEMO — Sample Kids Book Publisher', website: 'https://demo-kidsbooks.example', category: "children's publishers" }, { name: 'DEMO — Sample Toddler Learning App', website: 'https://demo-toddlerapp.example', category: 'kids edtech' }],
  sunverse: [{ name: 'DEMO — Sample Indie Label', website: 'https://demo-indielabel.example', category: 'labels & distributors' }],
  foliocraft: [{ name: 'DEMO — Sample Design Bootcamp', website: 'https://demo-bootcamp.example', category: 'career & education communities' }],
};
export async function loadDemo(db) {
  let n = 0;
  for (const [brand, rows] of Object.entries(DEMO)) {
    for (const [i, r] of rows.entries()) {
      const key = `demo:${brand}:${i}`;
      const exists = await db.prepare('SELECT id FROM growth_leads WHERE brand = ? AND dedupe_key = ?').bind(brand, key).first();
      if (exists) continue;
      const id = newId('glead');
      const now = nowIso();
      await db.prepare("INSERT INTO growth_leads (id, brand, name, org_type, website, dedupe_key, category, sources_json, evidence, stage, origin, contact_permission, next_action, created_at, updated_at) VALUES (?,?,?,'company',?,?,?,'[]',?, 'new','demo','denied','Demo only — never contacted',?,?)").bind(id, brand, r.name, r.website, key, r.category, 'DEMO DATA — fictional record for trying the screens. Not a real organisation.', now, now).run();
      await activity(db, { brand, leadId: id, kind: 'demo_created', note: 'Demo record', actor: 'system' });
      n++;
    }
  }
  return { created: n };
}
export async function clearDemo(db) {
  const n = (await db.prepare("SELECT COUNT(*) AS n FROM growth_leads WHERE origin = 'demo'").first()).n;
  await db.prepare("DELETE FROM growth_leads WHERE origin = 'demo'").run();
  return { removed: n };
}

/* ---------------- MUSHAK daily report ---------------- */
// One Indian-time (IST) day of Growth work, built only from saved rows: every agent job (with tokens,
// cost, result or error) and every pipeline event. The headline is assembled from the counts — no AI.
const IST_MS = 5.5 * 3_600_000;
const AGENT_NAMES = { narada_market_intelligence: 'NARADA', ops_soma_analytics: 'SOMA', samvada_handoffs: 'SAMVADA' };
const JOB_LABEL = { discover: 'Searched for new leads', research: 'Researched a lead', qualify: 'Scored a lead', draft: 'Wrote an outreach draft', classify_reply: 'Read a reply' };
export function istDay(d = new Date()) {
  return new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
}
function istWindow(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? '')) day = istDay();
  const start = new Date(Date.parse(`${day}T00:00:00Z`) - IST_MS);
  const end = new Date(start.getTime() + 86_400_000);
  return { day, from: start.toISOString(), to: end.toISOString() };
}

export async function dailyReport(db, dayIn) {
  const { day, from, to } = istWindow(dayIn);
  const fx = (await getSettings(db)).fx_usd_inr;
  const jobs = (await db.prepare('SELECT j.*, c.name AS campaign_name, l.name AS lead_name FROM growth_jobs j LEFT JOIN growth_campaigns c ON c.id = j.campaign_id LEFT JOIN growth_leads l ON l.id = j.lead_id WHERE j.created_at >= ? AND j.created_at < ? ORDER BY j.created_at').bind(from, to).all()).results;
  const acts = (await db.prepare("SELECT a.*, l.name AS lead_name, l.origin AS lead_origin, c.name AS campaign_name FROM growth_activities a LEFT JOIN growth_leads l ON l.id = a.lead_id LEFT JOIN growth_campaigns c ON c.id = a.campaign_id WHERE a.created_at >= ? AND a.created_at < ? AND a.kind != 'demo_created' ORDER BY a.created_at").bind(from, to).all()).results.filter((a) => a.lead_origin !== 'demo');
  const count = (k) => acts.filter((a) => a.kind === k).length;
  const toStage = (s) => acts.filter((a) => a.kind === 'stage_changed' && a.to_stage === s).length;
  const counts = {
    jobs: jobs.length,
    jobsSucceeded: jobs.filter((j) => j.status === 'succeeded').length,
    jobsFailed: jobs.filter((j) => j.status === 'failed').length,
    jobsBlocked: jobs.filter((j) => j.status === 'blocked').length,
    searches: jobs.filter((j) => j.kind === 'discover' && j.status === 'succeeded').length,
    leadsFound: acts.filter((a) => a.kind === 'lead_created').length,
    researched: count('researched'),
    scored: count('qualified'),
    qualified: toStage('qualified'),
    drafts: count('draft_created'),
    approved: count('draft_approved'),
    rejected: count('draft_rejected'),
    sent: count('message_sent'),
    replies: count('reply_received'),
    meetings: count('meeting_confirmed'),
    won: toStage('won'),
    lost: toStage('lost'),
    optOuts: count('suppressed'),
  };
  const usd = jobs.reduce((a, j) => a + (j.cost_usd ?? 0), 0);
  const unknownCost = jobs.filter((j) => j.status === 'succeeded' && j.cost_usd === null).length;
  const tokens = { input: jobs.reduce((a, j) => a + (j.input_tokens ?? 0), 0), output: jobs.reduce((a, j) => a + (j.output_tokens ?? 0), 0) };
  const byBrand = {};
  for (const b of GROWTH_BRAND_IDS) {
    const ja = jobs.filter((j) => j.brand === b);
    const aa = acts.filter((a) => a.brand === b);
    byBrand[b] = { jobs: ja.length, leadsFound: aa.filter((a) => a.kind === 'lead_created').length, drafts: aa.filter((a) => a.kind === 'draft_created').length, sent: aa.filter((a) => a.kind === 'message_sent').length, replies: aa.filter((a) => a.kind === 'reply_received').length, costUsd: ja.reduce((x, j) => x + (j.cost_usd ?? 0), 0) };
  }
  const parts = [];
  if (counts.searches) parts.push(`searched ${counts.searches} time(s)`);
  if (counts.leadsFound) parts.push(`found ${counts.leadsFound} lead(s)`);
  if (counts.researched) parts.push(`researched ${counts.researched}`);
  if (counts.scored) parts.push(`scored ${counts.scored}`);
  if (counts.drafts) parts.push(`wrote ${counts.drafts} draft(s)`);
  if (counts.sent) parts.push(`${counts.sent} message(s) went out after your approval`);
  if (counts.replies) parts.push(`read ${counts.replies} repl${counts.replies === 1 ? 'y' : 'ies'}`);
  const headline = parts.length ? `Mushak ${parts.join(', ')}.` : 'No Growth work was recorded on this day.';
  const pending = (await db.prepare("SELECT COUNT(*) AS n FROM growth_drafts d JOIN growth_leads l ON l.id = d.lead_id WHERE d.status = 'pending_approval' AND l.origin != 'demo'").first()).n;
  return {
    day,
    window: { from, to, timezone: 'Asia/Kolkata' },
    headline,
    counts,
    cost: { usd, inr: toInr(usd, fx), unknownCostJobs: unknownCost },
    tokens,
    byBrand,
    waitingForYouNow: pending,
    jobs: jobs.map((j) => ({
      id: j.id, at: j.created_at, brand: j.brand, agent: AGENT_NAMES[j.agent_id] ?? j.agent_id, kind: j.kind, what: JOB_LABEL[j.kind] ?? j.kind,
      campaign: j.campaign_name, lead: j.lead_name, status: j.status, attempts: j.attempts, model: j.model,
      tokens: j.input_tokens === null && j.output_tokens === null ? null : { input: j.input_tokens, output: j.output_tokens },
      costUsd: j.cost_usd, result: j.summary, error: j.error,
    })),
    timeline: acts.map((a) => ({ id: a.id, at: a.created_at, brand: a.brand, kind: a.kind, lead: a.lead_name, campaign: a.campaign_name, from: a.from_stage, to: a.to_stage, note: a.note, actor: AGENT_NAMES[a.actor] ?? a.actor })),
    note: 'Built from saved Growth records (demo leads excluded). Mushak works when a campaign runs or you press its buttons; nothing is sent without your approval.',
  };
}

/** Days with any Growth work in the last `limit` IST days, newest first. */
export async function reportDays(db, limit = 30) {
  const since = new Date(Date.now() - limit * 86_400_000).toISOString();
  const rows = [
    ...(await db.prepare('SELECT created_at FROM growth_jobs WHERE created_at >= ?').bind(since).all()).results,
    ...(await db.prepare("SELECT created_at FROM growth_activities WHERE created_at >= ? AND kind != 'demo_created'").bind(since).all()).results,
  ];
  const m = new Map();
  for (const r of rows) {
    const d = istDay(new Date(r.created_at));
    m.set(d, (m.get(d) ?? 0) + 1);
  }
  const today = istDay();
  if (!m.has(today)) m.set(today, 0);
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([day, events]) => ({ day, events }));
}
