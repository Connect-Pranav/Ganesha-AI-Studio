// Finished work: completed goals with each step's deliverable (artifact id to open), plus reels that
// are done (posted, approved/posting, or waiting for the owner). Read-only, straight from D1.
import * as reels from './reels.mjs';

export async function finishedWork(env, db, limit = 30) {
  const n = Math.min(100, Math.max(1, Number(limit) || 30));
  const wfs = (await db.prepare("SELECT id, title, brand, template, status, updated_at FROM workflows WHERE status = 'completed' ORDER BY updated_at DESC LIMIT ?").bind(n).all()).results;
  const goals = [];
  for (const w of wfs) {
    const steps = (await db.prepare("SELECT id, step_key, agent_id, deliverable, output_artifact, finished_at FROM tasks WHERE workflow_id = ? AND status = 'completed' ORDER BY finished_at").bind(w.id).all()).results;
    goals.push({ ...w, steps });
  }
  const recentSteps = (
    await db
      .prepare(`SELECT t.id, t.step_key, t.agent_id, t.deliverable, t.output_artifact, t.finished_at, w.id AS workflow_id, w.title AS workflow_title, w.brand
                FROM tasks t JOIN workflows w ON w.id = t.workflow_id
                WHERE t.status = 'completed' AND t.output_artifact IS NOT NULL ORDER BY t.finished_at DESC LIMIT ?`)
      .bind(n)
      .all()
  ).results;
  const rf = await reels.overview(env, db);
  const doneReels = rf.reels.filter((r) => ['published', 'approved', 'publishing', 'review'].includes(r.status));
  return { goals, recentSteps, reels: doneReels };
}
