// GANESHA GROWTH AI — outreach drafts, the mandatory human approval gate, and the only code path that
// can mark a message as sent. Rules enforced here (not in the UI):
//   • Nothing is sent without an approval whose hash matches the current content — any edit after
//     approval invalidates it.
//   • Suppressed / opted-out / permission-denied contacts are re-checked at approval AND at send time.
//   • Each draft sends at most once (status compare-and-set + unique idempotency key).
//   • A send is "sent" only when the channel confirms it. Manual channel = the owner confirms they sent it.
import { HttpError, newId, nowIso } from '../util.mjs';
import { activity, getLead, isSuppressed, setStage } from './core.mjs';

const EMAIL_RE = /^[^@\s]{1,64}@[a-z0-9.-]+\.[a-z]{2,}$/i;

export async function contentHash({ channel, recipient, subject, body }) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([channel, recipient.trim().toLowerCase(), subject.trim(), body.trim()])));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Channel adapters. Only adapters that are actually configured can deliver. */
export function channels(env) {
  return {
    manual: { id: 'manual', connected: true, note: 'You send the message yourself (email, DM or form), then confirm it here.' },
    email: { id: 'email', connected: false, note: 'No email integration is connected. Use the manual channel, or add an email provider integration first.' },
  };
}

function validateContent({ channel, recipient, subject, body }) {
  if (!['manual', 'email'].includes(channel)) throw new HttpError(400, 'channel must be manual or email');
  if (typeof recipient !== 'string' || !recipient.trim() || recipient.length > 300) throw new HttpError(400, 'recipient is required');
  if (channel === 'email' && !EMAIL_RE.test(recipient.trim())) throw new HttpError(400, 'email drafts need a valid recipient email');
  if (typeof body !== 'string' || body.trim().length < 20 || body.length > 6000) throw new HttpError(400, 'body must be 20–6000 characters');
  if (typeof subject !== 'string' || subject.length > 200) throw new HttpError(400, 'subject must be under 200 characters');
}

async function blockers(db, lead, recipient) {
  const out = [];
  const email = EMAIL_RE.test(recipient.trim()) ? recipient.trim() : lead.contact_email;
  const sup = await isSuppressed(db, lead.brand, { email, website: lead.website });
  if (sup) out.push(`On the do-not-contact list (${sup.kind}: ${sup.value})`);
  if (lead.stage === 'suppressed') out.push('Lead is suppressed');
  if (lead.contact_permission === 'denied') out.push('Contact permission is denied');
  return out;
}

export async function createDraft(env, db, { leadId, kind = 'first_contact', channel, recipient, subject = '', body, personalization = '' }, actor = 'owner') {
  const lead = await getLead(db, leadId);
  const camp = lead.campaign_id ? await db.prepare('SELECT * FROM growth_campaigns WHERE id = ?').bind(lead.campaign_id).first() : null;
  if (camp && ['cancelled', 'completed'].includes(camp.status)) throw new HttpError(409, `Campaign is ${camp.status}`);
  const ch = channel ?? camp?.channel ?? 'manual';
  const rcpt = String(recipient ?? lead.contact_email ?? lead.website ?? lead.name).trim();
  validateContent({ channel: ch, recipient: rcpt, subject, body });
  if (!['first_contact', 'follow_up', 'reply'].includes(kind)) throw new HttpError(400, 'kind is invalid');
  const blocked = await blockers(db, lead, rcpt);
  if (blocked.length) throw new HttpError(409, `Cannot draft outreach: ${blocked.join('; ')}`);
  const hash = await contentHash({ channel: ch, recipient: rcpt, subject, body });
  const id = newId('gdraft');
  const now = nowIso();
  await db
    .prepare('INSERT INTO growth_drafts (id, brand, lead_id, campaign_id, kind, channel, recipient, subject, body, personalization, content_hash, status, idempotency_key, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(id, lead.brand, lead.id, lead.campaign_id, kind, ch, rcpt, subject.trim(), body.trim(), String(personalization).slice(0, 2000), hash, 'pending_approval', `send:${id}`, now, now)
    .run();
  await activity(db, { brand: lead.brand, leadId: lead.id, campaignId: lead.campaign_id, kind: 'draft_created', note: `${kind} via ${ch}`, data: { draftId: id }, actor });
  if (['new', 'researching', 'qualified', 'outreach_drafted', 'replied'].includes(lead.stage)) {
    await setStage(db, lead, 'outreach_drafted', 'Draft prepared', actor);
    await setStage(db, { ...lead, stage: 'outreach_drafted' }, 'pending_approval', 'Waiting for your approval', actor);
  }
  return draftOut(await getDraft(db, id));
}

export function draftOut(d) {
  return d && { id: d.id, brand: d.brand, leadId: d.lead_id, campaignId: d.campaign_id, kind: d.kind, channel: d.channel, recipient: d.recipient, subject: d.subject, body: d.body, personalization: d.personalization, status: d.status, approvalValid: d.status === 'approved' && d.approved_hash === d.content_hash, approvedBy: d.approved_by, approvedAt: d.approved_at, rejectedReason: d.rejected_reason, sentAt: d.sent_at, delivery: d.delivery_json ? JSON.parse(d.delivery_json) : null, createdAt: d.created_at, updatedAt: d.updated_at };
}
export async function getDraft(db, id, brand = null) {
  const d = await db.prepare('SELECT * FROM growth_drafts WHERE id = ?').bind(id).first();
  if (!d || (brand && d.brand !== brand)) throw new HttpError(404, 'Draft not found');
  return d;
}
export async function listDrafts(db, { brand, status } = {}) {
  const where = [];
  const args = [];
  if (brand) (where.push('d.brand = ?'), args.push(brand));
  if (status) (where.push('d.status = ?'), args.push(status));
  const rows = (await db.prepare(`SELECT d.*, l.name AS lead_name, l.website AS lead_website, l.stage AS lead_stage, l.contact_permission, l.score FROM growth_drafts d JOIN growth_leads l ON l.id = d.lead_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY d.updated_at DESC LIMIT 200`).bind(...args).all()).results;
  const out = [];
  for (const r of rows) {
    const lead = { brand: r.brand, website: r.lead_website, contact_email: null, stage: r.lead_stage, contact_permission: r.contact_permission };
    out.push({ ...draftOut(r), leadName: r.lead_name, leadScore: r.score, warnings: ['pending_approval', 'approved'].includes(r.status) ? await blockers(db, lead, r.recipient) : [] });
  }
  return out;
}

/** Edit content. If it was approved, the approval no longer matches and the draft goes back for review. */
export async function editDraft(db, id, b, actor = 'owner') {
  const d = await getDraft(db, id);
  if (!['pending_approval', 'approved', 'rejected'].includes(d.status)) throw new HttpError(409, `A ${d.status} draft cannot be edited`);
  const next = { channel: b.channel ?? d.channel, recipient: b.recipient ?? d.recipient, subject: b.subject ?? d.subject, body: b.body ?? d.body };
  validateContent(next);
  const hash = await contentHash(next);
  if (hash === d.content_hash) return draftOut(d);
  const invalidated = d.status === 'approved';
  await db.prepare("UPDATE growth_drafts SET channel = ?, recipient = ?, subject = ?, body = ?, content_hash = ?, status = 'pending_approval', approved_hash = NULL, approved_by = NULL, approved_at = NULL, updated_at = ? WHERE id = ?").bind(next.channel, next.recipient.trim(), next.subject.trim(), next.body.trim(), hash, nowIso(), id).run();
  await activity(db, { brand: d.brand, leadId: d.lead_id, kind: invalidated ? 'approval_invalidated' : 'draft_edited', note: invalidated ? 'Edited after approval — needs a new review' : 'Draft edited', data: { draftId: id }, actor });
  if (invalidated) {
    const lead = await getLead(db, d.lead_id);
    if (lead.stage === 'approved') await setStage(db, lead, 'pending_approval', 'Edited after approval', actor);
  }
  return draftOut(await getDraft(db, id));
}

export async function approveDraft(db, id, actor = 'owner') {
  const d = await getDraft(db, id);
  if (d.status !== 'pending_approval') throw new HttpError(409, `Only drafts waiting for approval can be approved (this one is ${d.status})`);
  const lead = await getLead(db, d.lead_id);
  const blocked = await blockers(db, lead, d.recipient);
  if (blocked.length) throw new HttpError(409, `Cannot approve: ${blocked.join('; ')}`);
  const at = nowIso();
  const r = await db.prepare("UPDATE growth_drafts SET status = 'approved', approved_hash = content_hash, approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ? AND status = 'pending_approval' AND content_hash = ?").bind(actor, at, at, id, d.content_hash).run();
  if (!r.meta.changes) throw new HttpError(409, 'The draft changed while you were approving it — review it again');
  await activity(db, { brand: d.brand, leadId: d.lead_id, kind: 'draft_approved', note: `Approved by ${actor}`, data: { draftId: id, hash: d.content_hash }, actor });
  await setStage(db, lead, 'approved', 'Outreach approved', actor);
  return draftOut(await getDraft(db, id));
}

export async function rejectDraft(db, id, reason, actor = 'owner') {
  const d = await getDraft(db, id);
  if (!['pending_approval', 'approved'].includes(d.status)) throw new HttpError(409, `A ${d.status} draft cannot be rejected`);
  await db.prepare("UPDATE growth_drafts SET status = 'rejected', rejected_reason = ?, approved_hash = NULL, updated_at = ? WHERE id = ?").bind(String(reason ?? '').slice(0, 500) || null, nowIso(), id).run();
  await activity(db, { brand: d.brand, leadId: d.lead_id, kind: 'draft_rejected', note: reason || 'Rejected', data: { draftId: id }, actor });
  const lead = await getLead(db, d.lead_id);
  if (['pending_approval', 'approved'].includes(lead.stage)) await setStage(db, lead, 'qualified', 'Draft rejected — back to qualified', actor);
  return draftOut(await getDraft(db, id));
}

/**
 * The single execution path. Requires a valid approval. Manual channel needs `confirmSent: true`
 * (the owner says they sent it). Email channel delivers only through a connected adapter.
 */
export async function sendDraft(env, db, id, { confirmSent = false, actor = 'owner' } = {}, deps = {}) {
  const d = await getDraft(db, id);
  if (d.status === 'sent') return { ...draftOut(d), alreadySent: true };
  if (d.status !== 'approved' || d.approved_hash !== d.content_hash) throw new HttpError(409, 'This message has no valid approval. Approve the current version first.');
  const lead = await getLead(db, d.lead_id);
  const blocked = await blockers(db, lead, d.recipient);
  if (blocked.length) throw new HttpError(409, `Not sent: ${blocked.join('; ')}`);
  const ch = channels(env)[d.channel];
  if (!ch?.connected) throw new HttpError(409, ch?.note ?? 'Channel not available');
  if (d.channel === 'manual' && confirmSent !== true) throw new HttpError(400, 'Send it yourself, then confirm with confirmSent: true. Nothing is marked sent until you confirm.');
  // Compare-and-set so a double click or retry can never deliver twice.
  const lock = await db.prepare("UPDATE growth_drafts SET status = 'sending', updated_at = ? WHERE id = ? AND status = 'approved' AND approved_hash = content_hash").bind(nowIso(), id).run();
  if (!lock.meta.changes) {
    const cur = await getDraft(db, id);
    if (cur.status === 'sent') return { ...draftOut(cur), alreadySent: true };
    throw new HttpError(409, 'Another send is already in progress for this draft');
  }
  let delivery;
  try {
    if (d.channel === 'manual') delivery = { channel: 'manual', result: 'confirmed_by_owner', confirmedBy: actor, idempotencyKey: d.idempotency_key };
    else delivery = await deps.emailAdapter.send({ to: d.recipient, subject: d.subject, body: d.body, idempotencyKey: d.idempotency_key });
  } catch (e) {
    await db.prepare("UPDATE growth_drafts SET status = 'failed', delivery_json = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify({ error: String(e.message).slice(0, 300) }), nowIso(), id).run();
    await activity(db, { brand: d.brand, leadId: d.lead_id, kind: 'send_failed', note: String(e.message).slice(0, 300), data: { draftId: id }, actor });
    throw new HttpError(502, `Send failed: ${e.message}`);
  }
  const at = nowIso();
  await db.prepare("UPDATE growth_drafts SET status = 'sent', sent_at = ?, delivery_json = ?, updated_at = ? WHERE id = ?").bind(at, JSON.stringify(delivery), at, id).run();
  await activity(db, { brand: d.brand, leadId: d.lead_id, kind: 'message_sent', note: `${d.kind} via ${d.channel}`, data: { draftId: id, approvedBy: d.approved_by, approvedAt: d.approved_at, hash: d.content_hash, delivery }, actor });
  await setStage(db, lead, 'sent', 'Message sent', actor);
  return draftOut(await getDraft(db, id));
}
