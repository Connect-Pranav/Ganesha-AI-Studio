// AI engine status, derived ONLY from real run records in runs.json.
// The browser never holds provider keys and never calls a provider.
//   no runs for an engine         → Not configured
//   last run failed               → Error
//   last run older than 48h       → Disconnected (stale)
//   last run success/partial      → Connected
import { STALE_AFTER_HOURS } from '../config';
import type { AiConnectionState, AiStatus, EngineId, EngineStatus, Run } from '../types';

const ENGINES: { engine: EngineId; label: string; where: string }[] = [
  { engine: 'claude', label: 'Claude', where: 'Scheduled tasks · research + coding' },
  { engine: 'gemini', label: 'Gemini (free tier)', where: 'GitHub Actions · daily backup' },
];

function engineStatus(engine: EngineId, label: string, where: string, runs: Run[]): EngineStatus {
  const last = runs.filter((r) => r.engine === engine).sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt))[0];
  if (!last) return { engine, label, where, state: 'not_configured', message: 'No runs yet.' };
  const hours = (Date.now() - Date.parse(last.finishedAt)) / 3_600_000;
  if (last.status === 'failed') return { engine, label, where, state: 'error', message: last.error ?? 'Last run failed.', lastRun: last };
  if (hours > STALE_AFTER_HOURS)
    return { engine, label, where, state: 'disconnected', message: `No run in the last ${STALE_AFTER_HOURS}h.`, lastRun: last };
  return {
    engine,
    label,
    where,
    state: 'connected',
    message: last.status === 'partial' ? `Last run partial: ${last.error ?? ''}`.trim() : last.summary,
    lastRun: last,
  };
}

const RANK: Record<AiConnectionState, number> = { connected: 3, error: 2, disconnected: 1, not_configured: 0 };

export function deriveAiStatus(runs: Run[]): AiStatus {
  const engines = ENGINES.map((e) => engineStatus(e.engine, e.label, e.where, runs));
  const best = engines.reduce((a, b) => (RANK[b.state] > RANK[a.state] ? b : a));
  const connected = engines.filter((e) => e.state === 'connected');
  const message =
    best.state === 'not_configured'
      ? 'No agent engine has run yet. Sections stay empty until the first run.'
      : best.state === 'connected'
        ? `${connected.map((e) => e.label).join(' + ')} active.`
        : best.message;
  return {
    state: best.state,
    provider: connected.map((e) => e.label).join(', ') || null,
    message,
    checkedAt: new Date(),
    engines,
  };
}
