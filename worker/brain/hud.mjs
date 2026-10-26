// Game-style HUD for the "Neon Coast" skin: level/XP, attention stars, month spend, brand radar.
// Every number is counted from real rows (missions, reels, growth, provider calls) — nothing is invented.
import { overview as growthOverview } from '../growth/analytics.mjs';

export const XP = { mission: 250, step: 40, reel: 100, outreach: 20, won: 500 };

/** Level curve: level n needs 100·n² XP in total (L1 = 0, L2 = 400, L3 = 900 …). */
export function levelFor(xp) {
  let level = 1;
  while (100 * (level + 1) ** 2 - 100 <= xp) level++;
  const base = 100 * level ** 2 - 100;
  const next = 100 * (level + 1) ** 2 - 100;
  return { level, xpInLevel: xp - base, xpForNext: next - base };
}

const one = async (db, sql, ...b) => (await db.prepare(sql).bind(...b).first().catch(() => null)) ?? {};

export async function hudStats(db) {
  const monthStart = `${new Date().toISOString().slice(0, 7)}-01T00:00:00Z`;
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const [m, s, r, rv, cost, failed] = await Promise.all([
    one(db, "SELECT SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS done, SUM(CASE WHEN status='awaiting_approval' THEN 1 ELSE 0 END) AS awaiting, SUM(CASE WHEN status='running' THEN 1 ELSE 0 END) AS running FROM missions"),
    one(db, "SELECT COUNT(*) AS n FROM mission_steps WHERE status = 'done'"),
    one(db, "SELECT COUNT(*) AS n FROM reels WHERE status = 'published'"),
    one(db, "SELECT COUNT(*) AS n FROM reels WHERE status = 'review'"),
    one(db, 'SELECT SUM(cost_usd) AS usd, COUNT(*) AS calls, SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS unknown FROM provider_calls WHERE created_at >= ?', monthStart),
    one(db, "SELECT COUNT(*) AS n FROM missions WHERE status = 'failed' AND updated_at >= ?", weekAgo),
  ]);
  const g = await growthOverview(db).catch(() => null);
  const counts = {
    missions: m.done ?? 0,
    steps: s.n ?? 0,
    reels: r.n ?? 0,
    outreach: g?.total?.sent ?? 0,
    won: g?.total?.won ?? 0,
  };
  const xp = counts.missions * XP.mission + counts.steps * XP.step + counts.reels * XP.reel + counts.outreach * XP.outreach + counts.won * XP.won;
  const attention = {
    missionApprovals: m.awaiting ?? 0,
    reelReviews: rv.n ?? 0,
    outreachApprovals: g?.total?.pendingApprovals ?? 0,
    failedMissions7d: failed.n ?? 0,
  };
  const attentionTotal = Object.values(attention).reduce((a, b) => a + b, 0);
  const brands = {};
  for (const b of ['littleloop', 'sunverse', 'foliocraft']) {
    const x = await one(db, "SELECT SUM(CASE WHEN status='awaiting_approval' THEN 1 ELSE 0 END) AS awaiting, SUM(CASE WHEN status='running' THEN 1 ELSE 0 END) AS running, SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS done FROM missions WHERE brand = ?", b);
    brands[b] = { awaiting: x.awaiting ?? 0, running: x.running ?? 0, done: x.done ?? 0, leads: g?.brands?.[b]?.leads ?? 0 };
  }
  return {
    xp,
    ...levelFor(xp),
    counts,
    xpRules: XP,
    attention,
    stars: Math.min(5, attentionTotal),
    attentionTotal,
    running: m.running ?? 0,
    spend: { monthUsd: Number(cost.usd ?? 0), calls: cost.calls ?? 0, callsWithUnknownCost: cost.unknown ?? 0 },
    brands,
  };
}
