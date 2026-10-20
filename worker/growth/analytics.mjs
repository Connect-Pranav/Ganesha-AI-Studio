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
