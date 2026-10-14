// GANESHA_CBO Autopilot: the CBO decides what the studio should work on next and assigns it.
// Once a day it reads real records — SOMA's YouTube snapshot + analysis, recent goals per brand,
// open work — and turns them into goals (max N per day, no duplicates, no AI call needed to plan).
// Mode 'auto' starts a goal only when its conservative cost estimate fits the autopilot daily cap
// (default ₹0 → only provably free work starts by itself); otherwise it is proposed for one-tap
// approval. Publishing/spending steps inside every goal still stop for the owner, as always.
import { createWorkflow, TEMPLATES } from './orchestrator.mjs';
import { planGoal, audit } from './cbo.mjs';
import { getSettings } from './finance.mjs';
import { HttpError, newId, nowIso } from './util.mjs';

const DAY = 86400_000;
const daysAgo = (iso) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / DAY) : null);
const fmtDay = (d = new Date()) => d.toISOString().slice(0, 10);

async function lastWorkflow(db, template) {
  return db.prepare('SELECT id, status, created_at FROM workflows WHERE template = ? ORDER BY created_at DESC LIMIT 1').bind(template).first();
}
async function openWorkflow(db, template) {
  return db.prepare("SELECT id FROM workflows WHERE template = ? AND status NOT IN ('completed','failed','cancelled') LIMIT 1").bind(template).first();
}

/** Builds candidate goals from studio records. Pure read; returns them in priority order. */
export async function candidates(db) {
  const out = [];
  const today = fmtDay();

  // Sunverse — driven by SOMA's real YouTube data.
  const snap = await db.prepare("SELECT data_json, insights_json, fetched_at FROM analytics_snapshots WHERE brand = 'sunverse' ORDER BY fetched_at DESC LIMIT 1").first();
  if (!(await openWorkflow(db, 'sunverse_song_release'))) {
    const last = await lastWorkflow(db, 'sunverse_song_release');
    const since = daysAgo(last?.created_at);
    if (since === null || since >= 7) {
      const evidence = [];
      let why = since === null ? 'No Sunverse song has been planned in the studio yet.' : `Last Sunverse song goal was ${since} days ago.`;
      let goal = 'Create one original Hindi song for the Sunverse YouTube channel: concept, lyrics, vocal direction, mix brief, artwork and music-video plan. Prepare the YouTube release package for my approval; do not publish.';
      if (snap) {
        const data = JSON.parse(snap.data_json);
        const vids = (data.videos ?? []).filter((v) => v.views !== null).sort((a, b) => b.views - a.views);
        const latest = data.videos?.[0]?.publishedAt ?? null;
        const top = vids[0];
        if (latest) evidence.push(`Latest upload ${daysAgo(latest)} days ago (YouTube Data API, fetched ${snap.fetched_at}).`);
        if (top) evidence.push(`Best video so far: "${top.title}" with ${top.views} views.`);
        if (data.channel?.subscribers !== undefined && data.channel?.subscribers !== null) evidence.push(`Channel subscribers: ${data.channel.subscribers}.`);
        if (top) goal += ` Build on what already works on the channel: the best performer is "${top.title}" (${top.views} views) — keep a similar mood but write something new and original.`;
        if (snap.insights_json) {
          const ins = JSON.parse(snap.insights_json);
          const next = ins.nextActions?.[0];
          if (next?.action) {
            goal += ` SOMA's top recommendation: ${next.action}.`;
            evidence.push(`SOMA recommends: ${next.action}`);
          }
        }
        if (latest && daysAgo(latest) >= 14) why += ` The channel has not uploaded for ${daysAgo(latest)} days.`;
      } else evidence.push('No SOMA snapshot yet — goal based on cadence only.');
      out.push({ brand: 'sunverse', template: 'sunverse_song_release', title: `Autopilot · Sunverse song (${today})`, goal, reason: why, evidence });
    }
  }

  // LittleLoop — weekly episode cadence.
  if (!(await openWorkflow(db, 'littleloop_episode'))) {
    const last = await lastWorkflow(db, 'littleloop_episode');
    const since = daysAgo(last?.created_at);
    if (since === null || since >= 7)
      out.push({
        brand: 'littleloop',
        template: 'littleloop_episode',
        title: `Autopilot · LittleLoop episode (${today})`,
        goal: 'Create one short, safe, funny LittleLoop episode (Instagram Reel, 20–40 s) with the recurring toddler, dad and mom characters: concept, character sheet updates, script, scene prompts for Google Flow, voice and edit plan. Prepare the posting package for my approval; do not post.',
        reason: since === null ? 'No LittleLoop episode has been planned in the studio yet.' : `Last LittleLoop episode goal was ${since} days ago (weekly cadence).`,
        evidence: [],
      });
  }

  // Ops — weekly review of the studio itself.
  if (!(await openWorkflow(db, 'ops_weekly_review'))) {
    const last = await lastWorkflow(db, 'ops_weekly_review');
    const since = daysAgo(last?.created_at);
    if (since === null || since >= 7) {
      const failed = (await db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE status = 'failed' AND updated_at >= ?").bind(new Date(Date.now() - 7 * DAY).toISOString()).first()).n;
      out.push({
        brand: 'studio',
        template: 'ops_weekly_review',
        title: `Autopilot · Weekly studio review (${today})`,
        goal: `Review the last 7 days of studio work: what was produced, what failed (${failed} failed task(s) recorded) and why, costs, and the top 3 fixes for next week.`,
        reason: since === null ? 'No weekly review has run yet.' : `Last weekly review was ${since} days ago.`,
        evidence: [`${failed} failed task(s) in the last 7 days.`],
      });
    }
  }

  // Foliocraft — fortnightly product feature.
  if (!(await openWorkflow(db, 'foliocraft_feature'))) {
    const last = await lastWorkflow(db, 'foliocraft_feature');
    const since = daysAgo(last?.created_at);
    if (since === null || since >= 14)
      out.push({
        brand: 'foliocraft',
        template: 'foliocraft_feature',
        title: `Autopilot · Foliocraft feature (${today})`,
        goal: 'Pick the most valuable next Foliocraft premium feature, specify it, design the UX and prepare the implementation plan. Any code change goes to a pull request for my approval; do not merge or deploy.',
        reason: since === null ? 'No Foliocraft feature has been planned in the studio yet.' : `Last Foliocraft feature goal was ${since} days ago (fortnightly cadence).`,
        evidence: [],
      });
  }
  return out.filter((c) => TEMPLATES[c.template]);
}

/**
 * One autopilot pass. Safe to call repeatedly: (day, template) is unique, so a goal is never
 * proposed or started twice on the same day. Returns what it did.
 */
export async function runAutopilot(env, db, { force = false } = {}) {
  const s = await getSettings(db);
  if (s.autopilot_mode === 'off') return { mode: 'off', actions: [] };
  const today = fmtDay();
  const already = (await db.prepare('SELECT * FROM autopilot_proposals WHERE day = ?').bind(today).all()).results;
  if (already.length && !force) return { mode: s.autopilot_mode, actions: [], note: 'Already planned today.' };
  const slots = Math.max(0, s.autopilot_max_goals - already.length);
  const list = (await candidates(db)).filter((c) => !already.some((a) => a.template === c.template)).slice(0, slots);
  const actions = [];
  let spentToday = already.filter((a) => a.status === 'started').reduce((a, x) => a + (x.est_inr ?? 0), 0);
  for (const c of list) {
    const plan = await planGoal(env, db, { template: c.template, title: c.title, count: 1 });
    const est = plan.totals.conservativeInr;
    const fits = est !== null && spentToday + est <= s.autopilot_daily_inr;
    const now = nowIso();
    const id = newId('apg');
    let status = 'proposed';
    let workflowId = null;
    let why = c.reason;
    if (s.autopilot_mode === 'auto' && s.dispatch_paused) why += ' Dispatch is paused, so it waits for you.';
    else if (s.autopilot_mode === 'auto' && fits) {
      const wf = await createWorkflow(db, { template: c.template, title: c.title, goal: c.goal, idempotencyKey: `autopilot:${today}:${c.template}`, createdBy: 'GANESHA_CBO' });
      workflowId = wf.id;
      status = 'started';
      spentToday += est;
    } else if (s.autopilot_mode === 'auto') {
      why += est === null ? ' Cost can’t be confirmed (set the USD→INR rate and your Gemini billing tier), so it waits for your tap.' : ` Estimated up to ₹${est.toFixed(2)}, above your autopilot daily limit of ₹${s.autopilot_daily_inr}, so it waits for your tap.`;
    }
    try {
      await db
        .prepare(`INSERT INTO autopilot_proposals (id, day, brand, template, title, goal, reason, evidence_json, est_inr, est_usd, status, decided_by, workflow_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(id, today, c.brand, c.template, c.title, c.goal, why.slice(0, 1000), JSON.stringify(c.evidence), est, plan.totals.conservativeUsd, status, status === 'started' ? 'GANESHA_CBO' : null, workflowId, now, now)
        .run();
    } catch (e) {
      if (/UNIQUE/i.test(e.message)) continue; // a concurrent pass already handled it
      throw e;
    }
    await audit(db, status === 'started' ? 'autopilot_started' : 'autopilot_proposed', `${c.title}: ${why}`.slice(0, 900), { template: c.template, est }, workflowId);
    actions.push({ id, template: c.template, title: c.title, status, workflowId, estInr: est, reason: why });
  }
  // Older proposals nobody acted on expire, so the list stays current.
  await db.prepare("UPDATE autopilot_proposals SET status = 'expired', updated_at = ? WHERE status = 'proposed' AND day < ?").bind(nowIso(), fmtDay(new Date(Date.now() - 2 * DAY))).run();
  return { mode: s.autopilot_mode, actions };
}

/** Cron hook: one pass per day after 03:30 UTC (09:00 IST). */
export async function scheduledAutopilot(env, db) {
  const now = new Date();
  if (now.getUTCHours() * 60 + now.getUTCMinutes() < 210) return null;
  const done = await db.prepare('SELECT 1 FROM autopilot_proposals WHERE day = ? LIMIT 1').bind(fmtDay(now)).first();
  const ran = await db.prepare("SELECT 1 FROM events WHERE kind = 'autopilot_pass' AND created_at >= ? LIMIT 1").bind(`${fmtDay(now)}T00:00:00Z`).first();
  if (done || ran) return null;
  const r = await runAutopilot(env, db);
  await audit(db, 'autopilot_pass', `Autopilot (${r.mode}) ran: ${r.actions.length} goal(s)`, null);
  return r;
}

export async function listProposals(db) {
  return (await db.prepare('SELECT * FROM autopilot_proposals ORDER BY created_at DESC LIMIT 30').all()).results.map((p) => ({ ...p, evidence: JSON.parse(p.evidence_json), evidence_json: undefined }));
}

export async function decideProposal(db, id, decision) {
  const p = await db.prepare('SELECT * FROM autopilot_proposals WHERE id = ?').bind(id).first();
  if (!p) throw new HttpError(404, 'Proposal not found');
  if (p.status !== 'proposed') throw new HttpError(409, `Proposal is already ${p.status}`);
  const now = nowIso();
  if (decision === 'reject') {
    await db.prepare("UPDATE autopilot_proposals SET status = 'rejected', decided_by = 'owner', updated_at = ? WHERE id = ? AND status = 'proposed'").bind(now, id).run();
    await audit(db, 'autopilot_rejected', `Owner skipped ${p.title}`);
    return { id, status: 'rejected' };
  }
  if (decision !== 'approve') throw new HttpError(400, 'decision must be approve or reject');
  const wf = await createWorkflow(db, { template: p.template, title: p.title, goal: p.goal, idempotencyKey: `autopilot:${p.day}:${p.template}`, createdBy: 'owner' });
  await db.prepare("UPDATE autopilot_proposals SET status = 'started', decided_by = 'owner', workflow_id = ?, updated_at = ? WHERE id = ?").bind(wf.id, now, id).run();
  await audit(db, 'autopilot_started', `Owner approved ${p.title}`, null, wf.id);
  return { id, status: 'started', workflowId: wf.id };
}
