// GANESHA GROWTH AI — CRM core: campaigns, leads (dedupe + provenance), scoring, pipeline stages with
// audit history, suppression/opt-out, tasks & meetings. Every query is scoped by brand on the server.
import { HttpError, newId, nowIso } from '../util.mjs';
import { assertBrand, getBrandConfig, SCORE_COMPONENTS } from './brands.mjs';

export const STAGES = ['new', 'researching', 'qualified', 'outreach_drafted', 'pending_approval', 'approved', 'sent', 'replied', 'meeting_scheduled', 'proposal', 'negotiation', 'won', 'lost', 'suppressed'];
// Stages the owner may set by hand. Draft/approval/sent stages are owned by the outreach service so a
// draft can never be shown as sent; "suppressed" goes through suppress(); meetings need confirmation.
const MANUAL_STAGES = ['new', 'researching', 'qualified', 'replied', 'meeting_scheduled', 'proposal', 'negotiation', 'won', 'lost'];
export const OBJECTIVES = ['sponsorship', 'licensing', 'partnership', 'distribution', 'customer_acquisition', 'creator_collaboration'];
const ORG_TYPES = ['company', 'person', 'creator', 'agency', 'platform', 'community', 'other'];
const STALE_DAYS = 45;

const str = (v, max, name, { required = false } = {}) => {
  if (v === undefined || v === null || v === '') {
    if (required) throw new HttpError(400, `${name} is required`);
    return null;
  }
  if (typeof v !== 'string') throw new HttpError(400, `${name} must be text`);
  const t = v.trim();
  if (required && !t) throw new HttpError(400, `${name} is required`);
  if (t.length > max) throw new HttpError(400, `${name} is too long (max ${max})`);
  return t || null;
};
const int = (v, min, max, name, d) => {
  if (v === undefined || v === null || v === '') return d;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${name} must be a whole number ${min}–${max}`);
  return n;
};

export async function activity(db, { brand, leadId = null, campaignId = null, kind, from = null, to = null, note = null, data = null, actor = 'owner' }) {
  await db
    .prepare('INSERT INTO growth_activities (id, brand, lead_id, campaign_id, kind, from_stage, to_stage, note, data_json, actor, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .bind(newId('gact'), brand, leadId, campaignId, kind, from, to, note ? String(note).slice(0, 2000) : null, data ? JSON.stringify(data).slice(0, 8000) : null, actor, nowIso())
    .run();
  if (leadId) await db.prepare('UPDATE growth_leads SET last_activity_at = ? WHERE id = ?').bind(nowIso(), leadId).run();
}

/* ---------------- normalisation & dedupe ---------------- */
export function normDomain(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const u = new URL(/^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`);
    if (!/\./.test(u.hostname)) return null;
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}
// Big platforms host many unrelated people: a profile URL there is not a unique organisation.
const SHARED_HOSTS = new Set(['instagram.com', 'youtube.com', 'linkedin.com', 'x.com', 'twitter.com', 'facebook.com', 'tiktok.com', 'behance.net', 'dribbble.com', 'github.com', 'medium.com', 'substack.com', 'linktr.ee', 'spotify.com', 'soundcloud.com', 'open.spotify.com']);
export function normName(n) {
  return String(n ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\b(pvt|private|ltd|limited|llp|inc|llc|co|company|the)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
export function dedupeKey({ name, website }) {
  const d = normDomain(website);
  if (d && !SHARED_HOSTS.has(d)) return `d:${d}`;
  if (d && website) {
    try {
      const u = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`);
      const handle = u.pathname.split('/').filter(Boolean)[0];
      if (handle) return `p:${d}/${handle.toLowerCase().replace(/^@/, '')}`;
    } catch {
      /* fall through */
    }
  }
  const n = normName(name);
  if (!n) throw new HttpError(400, 'name is required');
  return `n:${n}`;
}

// Only generic role mailboxes are stored for business contacts — never guessed personal addresses.
const ROLE_LOCAL = /^(info|hello|hi|contact|partnerships?|partner|business|biz|collab|collabs|sponsor|sponsorships?|marketing|press|media|licensing|sales|team|support|bd|admin|enquiries|enquiry|inquiries|office|studio|booking|bookings|management)$/i;
export function isRoleEmail(email) {
  const m = /^([^@\s]+)@([a-z0-9.-]+\.[a-z]{2,})$/i.exec(String(email ?? '').trim());
  return Boolean(m && ROLE_LOCAL.test(m[1]));
}
const EMAIL_RE = /^[^@\s]{1,64}@[a-z0-9.-]+\.[a-z]{2,}$/i;

/* ---------------- suppression ---------------- */
export async function isSuppressed(db, brand, { email, website }) {
  const e = email ? String(email).trim().toLowerCase() : null;
  const domains = [normDomain(website), e ? e.split('@')[1] : null].filter(Boolean);
  const rows = (await db.prepare("SELECT * FROM growth_suppressions WHERE brand IN (?, '*')").bind(brand).all()).results;
  return rows.find((r) => (r.kind === 'email' && e && r.value === e) || (r.kind === 'domain' && domains.includes(r.value))) ?? null;
}
export async function addSuppression(db, { brand = '*', kind, value, reason }) {
  if (brand !== '*') assertBrand(brand);
  if (!['email', 'domain'].includes(kind)) throw new HttpError(400, 'kind must be email or domain');
  const v = kind === 'email' ? String(value ?? '').trim().toLowerCase() : normDomain(value);
  if (!v || (kind === 'email' && !EMAIL_RE.test(v))) throw new HttpError(400, `A valid ${kind} is required`);
  const r = str(reason, 300, 'reason', { required: true });
  await db.prepare('INSERT INTO growth_suppressions (id, brand, kind, value, reason, created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(brand, kind, value) DO NOTHING').bind(newId('gsup'), brand, kind, v, r, nowIso()).run();
  // Every matching lead moves to "suppressed" and any unsent draft is cancelled.
  const leads = (await db.prepare(`SELECT * FROM growth_leads WHERE ${brand === '*' ? '1=1' : 'brand = ?'}`).bind(...(brand === '*' ? [] : [brand])).all()).results;
  for (const l of leads) {
    const hit = kind === 'email' ? l.contact_email?.toLowerCase() === v : normDomain(l.website) === v || l.contact_email?.toLowerCase().endsWith(`@${v}`);
    if (!hit || l.stage === 'suppressed') continue;
    await db.prepare("UPDATE growth_leads SET stage = 'suppressed', contact_permission = 'denied', updated_at = ? WHERE id = ?").bind(nowIso(), l.id).run();
    await db.prepare("UPDATE growth_drafts SET status = 'cancelled', updated_at = ? WHERE lead_id = ? AND status IN ('pending_approval','approved')").bind(nowIso(), l.id).run();
    await activity(db, { brand: l.brand, leadId: l.id, kind: 'suppressed', from: l.stage, to: 'suppressed', note: r });
  }
  return { suppressed: v };
}
export async function listSuppressions(db, brand) {
  if (brand) assertBrand(brand);
  return (await (brand ? db.prepare("SELECT * FROM growth_suppressions WHERE brand IN (?, '*') ORDER BY created_at DESC").bind(brand) : db.prepare('SELECT * FROM growth_suppressions ORDER BY created_at DESC')).all()).results;
}
export async function removeSuppression(db, id) {
  const r = await db.prepare('DELETE FROM growth_suppressions WHERE id = ?').bind(id).run();
  if (!r.meta.changes) throw new HttpError(404, 'Suppression not found');
  return { removed: true, note: 'Leads stay suppressed until you reactivate each one explicitly.' };
}

/* ---------------- campaigns ---------------- */
const campaignOut = (c) => c && { id: c.id, brand: c.brand, name: c.name, objective: c.objective, segment: c.segment, audience: c.audience, geography: c.geography, criteria: c.criteria, threshold: c.threshold, dailyJobLimit: c.daily_job_limit, maxLeads: c.max_leads, budgetInr: c.budget_inr, researchDepth: c.research_depth, channel: c.channel, status: c.status, createdAt: c.created_at, updatedAt: c.updated_at };

export async function getCampaign(db, id, brand = null) {
  const c = await db.prepare('SELECT * FROM growth_campaigns WHERE id = ?').bind(id).first();
  if (!c || (brand && c.brand !== brand)) throw new HttpError(404, 'Campaign not found');
  return c;
}
export async function listCampaigns(db, brand) {
  if (brand) assertBrand(brand);
  const rows = (await (brand ? db.prepare('SELECT * FROM growth_campaigns WHERE brand = ? ORDER BY updated_at DESC').bind(brand) : db.prepare('SELECT * FROM growth_campaigns ORDER BY updated_at DESC')).all()).results;
  return rows.map(campaignOut);
}
function campaignFields(b, cur = {}) {
  const pick = (k, f) => (b[k] !== undefined ? f(b[k]) : cur[k]);
  return {
    name: pick('name', (v) => str(v, 120, 'name', { required: true })),
    objective: pick('objective', (v) => {
      if (!OBJECTIVES.includes(v)) throw new HttpError(400, `objective must be one of ${OBJECTIVES.join(', ')}`);
      return v;
    }),
    segment: pick('segment', (v) => {
      if (!['business', 'individual'].includes(v)) throw new HttpError(400, 'segment must be business or individual');
      return v;
    }) ?? 'business',
    audience: pick('audience', (v) => str(v, 1000, 'audience') ?? '') ?? '',
    geography: pick('geography', (v) => str(v, 200, 'geography') ?? '') ?? '',
    criteria: pick('criteria', (v) => str(v, 2000, 'criteria') ?? '') ?? '',
    threshold: pick('threshold', (v) => int(v, 0, 100, 'threshold', 60)) ?? 60,
    daily_job_limit: b.dailyJobLimit !== undefined ? int(b.dailyJobLimit, 1, 500, 'dailyJobLimit', 20) : (cur.daily_job_limit ?? 20),
    max_leads: b.maxLeads !== undefined ? int(b.maxLeads, 1, 5000, 'maxLeads', 50) : (cur.max_leads ?? 50),
    budget_inr: b.budgetInr !== undefined ? (() => {
      const n = Number(b.budgetInr);
      if (!(n >= 0) || n > 1e7) throw new HttpError(400, 'budgetInr must be 0 or more');
      return n;
    })() : (cur.budget_inr ?? 0),
    research_depth: b.researchDepth !== undefined ? (() => {
      if (!['light', 'standard', 'deep'].includes(b.researchDepth)) throw new HttpError(400, 'researchDepth must be light, standard or deep');
      return b.researchDepth;
    })() : (cur.research_depth ?? 'standard'),
    channel: pick('channel', (v) => {
      if (!['manual', 'email'].includes(v)) throw new HttpError(400, 'channel must be manual or email');
      return v;
    }) ?? 'manual',
  };
}
export async function createCampaign(db, b) {
  const brand = assertBrand(b?.brand);
  const f = campaignFields(b);
  if (!f.objective) throw new HttpError(400, 'objective is required');
  const cfg = await getBrandConfig(db, brand);
  if (!cfg.objectives.includes(f.objective)) throw new HttpError(400, `${cfg.name} campaigns support: ${cfg.objectives.join(', ')}`);
  if (brand !== 'foliocraft' && f.segment === 'individual' && f.objective === 'customer_acquisition') throw new HttpError(400, 'Individual customer campaigns are a Foliocraft feature');
  const id = newId('gcmp');
  const now = nowIso();
  try {
    await db
      .prepare('INSERT INTO growth_campaigns (id, brand, name, objective, segment, audience, geography, criteria, threshold, daily_job_limit, max_leads, budget_inr, research_depth, channel, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, brand, f.name, f.objective, f.segment, f.audience, f.geography, f.criteria, f.threshold, f.daily_job_limit, f.max_leads, f.budget_inr, f.research_depth, f.channel, 'draft', now, now)
      .run();
  } catch (e) {
    if (/UNIQUE/i.test(e.message)) throw new HttpError(409, `A ${cfg.name} campaign named "${f.name}" already exists`);
    throw e;
  }
  await activity(db, { brand, campaignId: id, kind: 'campaign_created', note: f.name });
  return campaignOut(await getCampaign(db, id));
}
export async function updateCampaign(db, id, b) {
  const c = await getCampaign(db, id);
  if (b.brand && b.brand !== c.brand) throw new HttpError(400, 'A campaign cannot move to another brand');
  const f = campaignFields(b, c);
  await db
    .prepare('UPDATE growth_campaigns SET name=?, objective=?, segment=?, audience=?, geography=?, criteria=?, threshold=?, daily_job_limit=?, max_leads=?, budget_inr=?, research_depth=?, channel=?, updated_at=? WHERE id=?')
    .bind(f.name, f.objective, f.segment, f.audience, f.geography, f.criteria, f.threshold, f.daily_job_limit, f.max_leads, f.budget_inr, f.research_depth, f.channel, nowIso(), id)
    .run();
  return campaignOut(await getCampaign(db, id));
}
const CAMPAIGN_MOVES = { activate: ['draft', 'paused'], pause: ['active'], resume: ['paused'], cancel: ['draft', 'active', 'paused'], complete: ['active', 'paused'] };
const CAMPAIGN_TO = { activate: 'active', pause: 'paused', resume: 'active', cancel: 'cancelled', complete: 'completed' };
export async function setCampaignStatus(db, id, action) {
  const c = await getCampaign(db, id);
  if (!CAMPAIGN_MOVES[action]) throw new HttpError(400, 'Unknown action');
  if (!CAMPAIGN_MOVES[action].includes(c.status)) throw new HttpError(409, `Cannot ${action} a ${c.status} campaign`);
  const to = CAMPAIGN_TO[action];
  await db.prepare('UPDATE growth_campaigns SET status = ?, updated_at = ? WHERE id = ?').bind(to, nowIso(), id).run();
  if (to === 'cancelled') await db.prepare("UPDATE growth_drafts SET status = 'cancelled', updated_at = ? WHERE campaign_id = ? AND status IN ('pending_approval','approved')").bind(nowIso(), id).run();
  await activity(db, { brand: c.brand, campaignId: id, kind: `campaign_${action}`, from: c.status, to });
  return campaignOut(await getCampaign(db, id));
}

/* ---------------- leads ---------------- */
export function leadOut(l) {
  if (!l) return l;
  const parse = (s, d) => {
    try {
      return s ? JSON.parse(s) : d;
    } catch {
      return d;
    }
  };
  const stale = l.researched_at ? Date.now() - Date.parse(l.researched_at) > STALE_DAYS * 86400_000 : false;
  return {
    id: l.id, brand: l.brand, campaignId: l.campaign_id, name: l.name, orgType: l.org_type, website: l.website, contactName: l.contact_name, contactRole: l.contact_role, contactEmail: l.contact_email,
    geography: l.geography, category: l.category, sources: parse(l.sources_json, []), evidence: l.evidence, researchedAt: l.researched_at, stale,
    score: l.score, scoreDetail: parse(l.score_json, null), confidence: l.confidence, stage: l.stage, lostReason: l.lost_reason, owner: l.owner,
    nextAction: l.next_action, followUpAt: l.follow_up_at, contactPermission: l.contact_permission, origin: l.origin, lastActivityAt: l.last_activity_at, createdAt: l.created_at, updatedAt: l.updated_at,
  };
}
export async function getLead(db, id, brand = null) {
  const l = await db.prepare('SELECT * FROM growth_leads WHERE id = ?').bind(id).first();
  if (!l || (brand && l.brand !== brand)) throw new HttpError(404, 'Lead not found');
  return l;
}
function sourcesOf(v) {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) throw new HttpError(400, 'sources must be a list');
  return v.slice(0, 25).map((s) => {
    const url = typeof s === 'string' ? s : s?.url;
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url) || url.length > 2000) throw new HttpError(400, 'each source needs an http(s) url');
    return { url, title: typeof s?.title === 'string' ? s.title.slice(0, 200) : null, verified: s?.verified === true, at: typeof s?.at === 'string' ? s.at : nowIso() };
  });
}

/** Creates a lead, or returns { duplicate } when the same brand already has it. Suppressed contacts are refused. */
export async function createLead(db, b, { actor = 'owner', origin = 'manual' } = {}) {
  const brand = assertBrand(b?.brand);
  if (b.campaignId) await getCampaign(db, b.campaignId, brand); // campaign must belong to the same brand
  const name = str(b.name, 160, 'name', { required: true });
  const website = str(b.website, 500, 'website');
  if (website && !normDomain(website)) throw new HttpError(400, 'website must be a valid web address');
  let email = str(b.contactEmail, 200, 'contactEmail');
  if (email) {
    email = email.toLowerCase();
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'contactEmail is not a valid email');
  }
  const orgType = b.orgType ? (ORG_TYPES.includes(b.orgType) ? b.orgType : (() => { throw new HttpError(400, `orgType must be one of ${ORG_TYPES.join(', ')}`); })()) : 'company';
  const permission = b.contactPermission ?? (email && isRoleEmail(email) ? 'business_public' : 'unknown');
  if (!['unknown', 'business_public', 'opted_in', 'denied'].includes(permission)) throw new HttpError(400, 'contactPermission is invalid');
  const key = dedupeKey({ name, website });
  const dup = await db.prepare('SELECT * FROM growth_leads WHERE brand = ? AND dedupe_key = ?').bind(brand, key).first();
  if (dup) return { duplicate: leadOut(dup) };
  const sup = await isSuppressed(db, brand, { email, website });
  if (sup) throw new HttpError(409, `This contact is on the do-not-contact list (${sup.kind}: ${sup.value}).`);
  const id = newId('glead');
  const now = nowIso();
  const sources = sourcesOf(b.sources) ?? [];
  await db
    .prepare(`INSERT INTO growth_leads (id, brand, campaign_id, name, org_type, website, dedupe_key, contact_name, contact_role, contact_email, geography, category, sources_json, evidence, contact_permission, origin, next_action, created_at, updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, brand, b.campaignId ?? null, name, orgType, website, key, str(b.contactName, 120, 'contactName'), str(b.contactRole, 120, 'contactRole'), email, str(b.geography, 120, 'geography'), str(b.category, 120, 'category'), JSON.stringify(sources), str(b.evidence, 8000, 'evidence') ?? '', permission, origin, 'Research this lead', now, now)
    .run();
  await activity(db, { brand, leadId: id, campaignId: b.campaignId ?? null, kind: 'lead_created', to: 'new', note: origin === 'discovery' ? 'Found by Lead Hunter' : `Added (${origin})`, data: sources.length ? { sources: sources.map((s) => s.url) } : null, actor });
  return { lead: leadOut(await getLead(db, id)) };
}

export async function importLeads(db, { brand, campaignId, leads }) {
  assertBrand(brand);
  if (!Array.isArray(leads) || !leads.length || leads.length > 500) throw new HttpError(400, 'leads must be a list of 1–500 rows');
  const out = { created: 0, duplicates: 0, suppressed: 0, errors: [] };
  for (const [i, row] of leads.entries()) {
    try {
      const r = await createLead(db, { ...row, brand, campaignId }, { origin: 'import' });
      if (r.duplicate) out.duplicates++;
      else out.created++;
    } catch (e) {
      if (/do-not-contact/.test(e.message)) out.suppressed++;
      else out.errors.push({ row: i + 1, error: e.message });
    }
  }
  return out;
}

export async function listLeads(db, { brand, campaignId, stage, minScore, q, includeDemo = true, limit = 200 } = {}) {
  assertBrand(brand);
  const where = ['brand = ?'];
  const args = [brand];
  if (campaignId) (where.push('campaign_id = ?'), args.push(campaignId));
  if (stage) {
    if (!STAGES.includes(stage)) throw new HttpError(400, 'Unknown stage');
    where.push('stage = ?');
    args.push(stage);
  }
  if (minScore !== undefined && minScore !== null && minScore !== '') (where.push('score >= ?'), args.push(int(minScore, 0, 100, 'minScore', 0)));
  if (q) (where.push('(name LIKE ? OR website LIKE ? OR category LIKE ?)'), args.push(`%${q}%`, `%${q}%`, `%${q}%`));
  if (!includeDemo) where.push("origin != 'demo'");
  const n = Math.min(500, Math.max(1, Number(limit) || 200));
  return (await db.prepare(`SELECT * FROM growth_leads WHERE ${where.join(' AND ')} ORDER BY COALESCE(score, -1) DESC, updated_at DESC LIMIT ${n}`).bind(...args).all()).results.map(leadOut);
}

export async function leadDetail(db, id) {
  const l = await getLead(db, id);
  const acts = (await db.prepare('SELECT * FROM growth_activities WHERE lead_id = ? ORDER BY created_at DESC LIMIT 100').bind(id).all()).results;
  const drafts = (await db.prepare('SELECT * FROM growth_drafts WHERE lead_id = ? ORDER BY created_at DESC').bind(id).all()).results;
  const replies = (await db.prepare('SELECT * FROM growth_replies WHERE lead_id = ? ORDER BY received_at DESC').bind(id).all()).results;
  const tasks = (await db.prepare('SELECT * FROM growth_tasks WHERE lead_id = ? ORDER BY COALESCE(due_at, created_at)').bind(id).all()).results;
  return { lead: leadOut(l), activities: acts.map((a) => ({ ...a, data: a.data_json ? JSON.parse(a.data_json) : null })), drafts, replies, tasks };
}

export async function updateLead(db, id, b) {
  const l = await getLead(db, id);
  if (b.brand && b.brand !== l.brand) throw new HttpError(400, 'A lead cannot move to another brand');
  if (b.campaignId) await getCampaign(db, b.campaignId, l.brand);
  const set = {};
  const map = { name: ['name', 160], website: ['website', 500], contactName: ['contact_name', 120], contactRole: ['contact_role', 120], geography: ['geography', 120], category: ['category', 120], nextAction: ['next_action', 300], owner: ['owner', 60] };
  for (const [k, [col, max]] of Object.entries(map)) if (b[k] !== undefined) set[col] = str(b[k], max, k);
  if (b.contactEmail !== undefined) {
    const e = str(b.contactEmail, 200, 'contactEmail')?.toLowerCase() ?? null;
    if (e && !EMAIL_RE.test(e)) throw new HttpError(400, 'contactEmail is not a valid email');
    set.contact_email = e;
  }
  if (b.followUpAt !== undefined) {
    if (b.followUpAt && Number.isNaN(Date.parse(b.followUpAt))) throw new HttpError(400, 'followUpAt must be a date');
    set.follow_up_at = b.followUpAt || null;
  }
  if (b.contactPermission !== undefined) {
    if (!['unknown', 'business_public', 'opted_in', 'denied'].includes(b.contactPermission)) throw new HttpError(400, 'contactPermission is invalid');
    set.contact_permission = b.contactPermission;
  }
  if (b.campaignId !== undefined) set.campaign_id = b.campaignId || null;
  if (set.name !== undefined || set.website !== undefined) {
    const key = dedupeKey({ name: set.name ?? l.name, website: set.website !== undefined ? set.website : l.website });
    const dup = await db.prepare('SELECT id FROM growth_leads WHERE brand = ? AND dedupe_key = ? AND id != ?').bind(l.brand, key, id).first();
    if (dup) throw new HttpError(409, 'Another lead in this brand already has that name/website');
    set.dedupe_key = key;
  }
  if (!Object.keys(set).length) return leadOut(l);
  set.updated_at = nowIso();
  await db.prepare(`UPDATE growth_leads SET ${Object.keys(set).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).bind(...Object.values(set), id).run();
  await activity(db, { brand: l.brand, leadId: id, kind: 'lead_edited', note: Object.keys(set).filter((k) => k !== 'updated_at').join(', ') });
  return leadOut(await getLead(db, id));
}

/** Manual pipeline move with audit. `confirm` is required for meetings; `reason` for lost; reactivation of a suppressed lead needs `unsuppress`. */
export async function moveStage(db, id, { stage, reason, confirm = false, unsuppress = false, actor = 'owner' }) {
  const l = await getLead(db, id);
  if (!STAGES.includes(stage)) throw new HttpError(400, 'Unknown stage');
  if (l.stage === stage) return leadOut(l);
  if (l.stage === 'suppressed') {
    if (!unsuppress || !str(reason, 300, 'reason')) throw new HttpError(409, 'This lead is suppressed (do-not-contact). Reactivating needs unsuppress: true and a reason.');
    const sup = await isSuppressed(db, l.brand, { email: l.contact_email, website: l.website });
    if (sup) throw new HttpError(409, `Still on the do-not-contact list (${sup.kind}: ${sup.value}). Remove that entry first.`);
  }
  if (!MANUAL_STAGES.includes(stage)) throw new HttpError(409, stage === 'suppressed' ? 'Use the do-not-contact action to suppress a lead.' : `"${stage}" is set by the outreach approval flow, not by hand.`);
  if (stage === 'meeting_scheduled' && !confirm) throw new HttpError(409, 'Only mark a meeting as scheduled once it is confirmed (send confirm: true).');
  if (stage === 'lost' && !str(reason, 300, 'reason')) throw new HttpError(400, 'A reason is required when a lead is lost');
  await db.prepare('UPDATE growth_leads SET stage = ?, lost_reason = ?, contact_permission = CASE WHEN ? THEN \'unknown\' ELSE contact_permission END, updated_at = ? WHERE id = ?').bind(stage, stage === 'lost' ? reason : l.lost_reason, l.stage === 'suppressed' ? 1 : 0, nowIso(), id).run();
  await activity(db, { brand: l.brand, leadId: id, kind: 'stage_changed', from: l.stage, to: stage, note: reason ?? null, actor });
  return leadOut(await getLead(db, id));
}
/** Internal stage moves by Growth services (research, drafts, sends, replies). */
export async function setStage(db, l, stage, note, actor) {
  if (l.stage === stage || l.stage === 'suppressed') return;
  await db.prepare('UPDATE growth_leads SET stage = ?, updated_at = ? WHERE id = ?').bind(stage, nowIso(), l.id).run();
  await activity(db, { brand: l.brand, leadId: l.id, campaignId: l.campaign_id, kind: 'stage_changed', from: l.stage, to: stage, note, actor });
}

/* ---------------- scoring ---------------- */
/**
 * Server-side score: each component is clamped to its (brand-weighted) maximum; components the agent
 * could not support with evidence count 0 and are listed as missing. Total is the plain sum (0–100).
 */
export function computeScore(components, weights) {
  const out = {};
  const missing = [];
  let total = 0;
  for (const [k, def] of Object.entries(SCORE_COMPONENTS)) {
    const max = weights?.[k] ?? def.max;
    const c = components?.[k];
    const raw = Number(c?.score);
    const evidence = typeof c?.evidence === 'string' ? c.evidence.trim().slice(0, 600) : '';
    // A score without evidence is not accepted — unknown is not the same as weak.
    const pts = Number.isFinite(raw) && evidence ? Math.max(0, Math.min(max, Math.round(raw))) : 0;
    if (!evidence) missing.push(def.label);
    out[k] = { label: def.label, max, score: pts, evidence: evidence || null };
    total += pts;
  }
  return { total: Math.max(0, Math.min(100, total)), components: out, missing };
}

export async function saveQualification(db, l, { components, missing = [], nextAction, confidence }, weights, threshold, actor) {
  const s = computeScore(components, weights);
  const allMissing = [...new Set([...s.missing, ...(Array.isArray(missing) ? missing.map(String).slice(0, 10) : [])])];
  const conf = ['low', 'medium', 'high'].includes(confidence) ? confidence : 'low';
  const detail = { components: s.components, missing: allMissing, nextAction: nextAction ? String(nextAction).slice(0, 300) : null, threshold, at: nowIso() };
  await db.prepare('UPDATE growth_leads SET score = ?, score_json = ?, confidence = ?, next_action = ?, updated_at = ? WHERE id = ?').bind(s.total, JSON.stringify(detail), conf, detail.nextAction ?? l.next_action, nowIso(), l.id).run();
  await activity(db, { brand: l.brand, leadId: l.id, campaignId: l.campaign_id, kind: 'qualified', note: `Score ${s.total}/100 (${conf} confidence)`, data: { missing: allMissing }, actor });
  if (s.total >= threshold && ['new', 'researching'].includes(l.stage)) await setStage(db, l, 'qualified', `Score ${s.total} ≥ threshold ${threshold}`, actor);
  return { score: s.total, ...detail, confidence: conf };
}

/* ---------------- tasks & meetings ---------------- */
export async function listTasks(db, brand) {
  assertBrand(brand);
  return (await db.prepare('SELECT t.*, l.name AS lead_name FROM growth_tasks t LEFT JOIN growth_leads l ON l.id = t.lead_id WHERE t.brand = ? ORDER BY t.done, COALESCE(t.due_at, t.created_at)').bind(brand).all()).results;
}
export async function createTask(db, b) {
  const brand = assertBrand(b?.brand);
  if (b.leadId) await getLead(db, b.leadId, brand);
  if (!['task', 'meeting'].includes(b.kind)) throw new HttpError(400, 'kind must be task or meeting');
  const title = str(b.title, 200, 'title', { required: true });
  if (b.dueAt && Number.isNaN(Date.parse(b.dueAt))) throw new HttpError(400, 'dueAt must be a date');
  const id = newId('gtask');
  const now = nowIso();
  await db.prepare('INSERT INTO growth_tasks (id, brand, lead_id, kind, title, due_at, confirmed, done, created_at, updated_at) VALUES (?,?,?,?,?,?,?,0,?,?)').bind(id, brand, b.leadId ?? null, b.kind, title, b.dueAt ?? null, b.kind === 'meeting' && b.confirmed === true ? 1 : 0, now, now).run();
  if (b.leadId) await activity(db, { brand, leadId: b.leadId, kind: b.kind === 'meeting' ? (b.confirmed ? 'meeting_confirmed' : 'meeting_proposed') : 'task_added', note: title });
  return db.prepare('SELECT * FROM growth_tasks WHERE id = ?').bind(id).first();
}
export async function updateTask(db, id, b) {
  const t = await db.prepare('SELECT * FROM growth_tasks WHERE id = ?').bind(id).first();
  if (!t) throw new HttpError(404, 'Task not found');
  const done = b.done !== undefined ? (b.done ? 1 : 0) : t.done;
  const confirmed = b.confirmed !== undefined ? (b.confirmed ? 1 : 0) : t.confirmed;
  if (confirmed && t.kind !== 'meeting') throw new HttpError(400, 'Only meetings can be confirmed');
  await db.prepare('UPDATE growth_tasks SET done = ?, confirmed = ?, updated_at = ? WHERE id = ?').bind(done, confirmed, nowIso(), id).run();
  if (t.lead_id && confirmed && !t.confirmed) await activity(db, { brand: t.brand, leadId: t.lead_id, kind: 'meeting_confirmed', note: t.title });
  return db.prepare('SELECT * FROM growth_tasks WHERE id = ?').bind(id).first();
}
