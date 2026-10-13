// Read-only aggregates for the dashboard. Every number is counted from D1 rows;
// nothing is estimated. `null` means "no data source", 0 means "counted, none".
import { REGISTRY } from './agents.mjs';
import { BRAND_SOURCES } from './analytics.mjs';

const DAY = 86400_000;
const since = (days) => new Date(Date.now() - days * DAY).toISOString();
const all = async (stmt) => (await stmt.all()).results ?? [];

/** Seconds between two ISO timestamps, or null. */
const secs = (a, b) => (a && b ? Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000)) : null);

export async function studioSummary(env, db, providers) {
  const [workflows, taskRows, agentRows, approvalRows, failures7d, events, usage, gates, durations, snapshots] = await Promise.all([
    all(
      db.prepare(`SELECT w.id, w.template, w.brand, w.title, w.status, w.created_at, w.updated_at,
                    SUM(t.status = 'completed') AS done, COUNT(t.id) AS steps,
                    SUM(t.status = 'failed') AS failed_steps, SUM(t.status = 'running') AS running_steps
                  FROM workflows w LEFT JOIN tasks t ON t.workflow_id = w.id
                  GROUP BY w.id ORDER BY w.updated_at DESC LIMIT 100`),
    ),
    all(db.prepare('SELECT status, COUNT(*) AS n FROM tasks GROUP BY status')),
    all(
      db.prepare(`SELECT agent_id,
                    COUNT(*) AS total,
                    SUM(status = 'running') AS running,
                    SUM(status = 'queued') AS queued,
                    SUM(status = 'completed') AS completed,
                    SUM(status = 'failed') AS failed,
                    SUM(status IN ('waiting_for_approval','waiting_for_external_action')) AS waiting,
                    SUM(status = 'failed' AND updated_at >= ?) AS recent_failed,
                    MAX(updated_at) AS last_activity
                  FROM tasks GROUP BY agent_id`).bind(since(2)),
    ),
    all(db.prepare('SELECT status, COUNT(*) AS n FROM approvals GROUP BY status')),
    db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE status = 'failed' AND updated_at >= ?").bind(since(7)).first(),
    all(db.prepare('SELECT e.id, e.workflow_id, e.task_id, e.kind, e.message, e.created_at, w.brand, w.title AS workflow_title FROM events e LEFT JOIN workflows w ON w.id = e.workflow_id ORDER BY e.id DESC LIMIT 30')),
    all(
      db
        .prepare(`SELECT provider, COUNT(*) AS calls, SUM(status = 'error') AS errors,
                    SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
                    SUM(cost_usd) AS cost_usd, AVG(latency_ms) AS avg_latency_ms
                  FROM provider_calls WHERE created_at >= ? GROUP BY provider`)
        .bind(since(30)),
    ),
    all(db.prepare("SELECT agent_id, qa, COUNT(*) AS n FROM tasks WHERE is_gate = 1 AND qa IS NOT NULL GROUP BY agent_id, qa")),
    all(db.prepare("SELECT started_at, finished_at FROM tasks WHERE status = 'completed' AND started_at IS NOT NULL AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 500")),
    all(db.prepare('SELECT brand, MAX(fetched_at) AS fetched_at, COUNT(*) AS n FROM analytics_snapshots GROUP BY brand')).catch(() => []),
  ]);

  const byStatus = (rows) => Object.fromEntries(rows.map((r) => [r.status, r.n]));
  const wfStatus = {};
  const byBrand = {};
  for (const w of workflows) {
    wfStatus[w.status] = (wfStatus[w.status] ?? 0) + 1;
    byBrand[w.brand] ??= {};
    byBrand[w.brand][w.status] = (byBrand[w.brand][w.status] ?? 0) + 1;
  }
  const d = durations.map((r) => secs(r.started_at, r.finished_at)).filter((x) => x !== null).sort((a, b) => a - b);

  const agentStats = Object.fromEntries(agentRows.map((r) => [r.agent_id, r]));
  const gateStats = {};
  for (const g of gates) {
    gateStats[g.agent_id] ??= { pass: 0, fail: 0 };
    gateStats[g.agent_id][g.qa] = g.n;
  }

  return {
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    windowNote: 'Workflow lists cover the latest 100 goals; provider usage covers the last 30 days.',
    workflows: workflows.map((w) => ({ ...w, done: w.done ?? 0, steps: w.steps ?? 0, failed_steps: w.failed_steps ?? 0, running_steps: w.running_steps ?? 0 })),
    counts: {
      workflowsByStatus: wfStatus,
      workflowsByBrand: byBrand,
      tasksByStatus: byStatus(taskRows),
      approvalsByStatus: byStatus(approvalRows),
      failedTasks7d: failures7d?.n ?? 0,
    },
    taskDurationSec: d.length ? { samples: d.length, median: d[Math.floor(d.length / 2)], p90: d[Math.floor(d.length * 0.9)] } : null,
    agents: REGISTRY.agents.map((a) => ({
      id: a.id,
      ...(agentStats[a.id] ?? { total: 0, running: 0, queued: 0, completed: 0, failed: 0, waiting: 0, recent_failed: 0, last_activity: null }),
      gate: gateStats[a.id] ?? null,
    })),
    providers,
    usage30d: usage,
    events,
    integrations: {
      youtubeStats: { configured: Boolean(env.YOUTUBE_API_KEY), brand: 'sunverse', account: BRAND_SOURCES.sunverse?.handle ?? null },
      analyticsSnapshots: snapshots,
      youtubeUpload: { configured: false, reason: 'Channel sign-in (Google OAuth) is not set up; uploads are done by you after approval.' },
      instagram: { configured: false, reason: 'On hold.' },
      googleFlow: { configured: false, reason: 'Google Flow has no public API. Agents write prompts; you generate in Flow and mark the step done.' },
      spotify: { configured: false, reason: 'Not started.' },
    },
  };
}

/** Deliverables (no content) for one brand, newest first. Content via /api/artifacts/:id. */
export async function brandArtifacts(db, brand, limit = 60) {
  return all(
    db
      .prepare(`SELECT a.id, a.kind, a.version, a.created_at, a.agent_id, t.step_key, t.deliverable, t.status AS task_status,
                  w.id AS workflow_id, w.title AS workflow_title, w.template, w.status AS workflow_status
                FROM artifacts a JOIN tasks t ON t.id = a.task_id JOIN workflows w ON w.id = a.workflow_id
                WHERE w.brand = ? AND a.kind IN ('deliverable','review')
                ORDER BY a.created_at DESC LIMIT ?`)
      .bind(brand, Math.min(Math.max(Number(limit) || 60, 1), 200)),
  );
}
