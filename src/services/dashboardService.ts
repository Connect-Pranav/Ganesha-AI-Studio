// Builds the dashboard model. REAL agent data (./agent-data) replaces demo
// sections wherever it exists; everything else stays clearly-labelled demo.
// UI components never import data sources directly.
import { demoData } from '../data/demoData';
import { loadAgentData, type AgentData } from './agentDataService';
import type { Agent, DashboardData } from '../types';

export interface DashboardResult {
  data: DashboardData;
  /** Set when live agent data could not be read; demo data is shown instead. */
  agentDataError: string | null;
}

// Test hooks: ?state=error | empty | slow
function getForcedState(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('state');
  } catch {
    return null;
  }
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const minutesSince = (iso: string) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));

export function mergeLive(base: DashboardData, live: AgentData): DashboardData {
  const data: DashboardData = structuredClone(base);

  if (live.tasks.length) {
    data.tasks = live.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      product: t.brand,
      agent: t.agent,
      status: t.status,
      priority: t.priority,
      reason: t.reason,
      requiresApproval: t.requiresApproval,
      prUrl: t.prUrl,
      engine: t.engine,
    }));
    data.live.tasks = true;
  }

  if (live.events.length) {
    data.activity = live.events.map((e) => ({
      id: e.id,
      minutesAgo: minutesSince(e.at),
      product: e.brand,
      agent: e.agent,
      kind: e.kind,
      text: e.text,
      engine: e.engine,
    }));
    data.live.activity = true;
  }

  if (live.findings.length) {
    data.research = live.findings;
    data.live.research = true;
  }

  data.pipelines = live.pipelines;

  if (live.runs.length) {
    const runs = [...live.runs].sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt));
    data.runs = runs;
    data.agents = data.agents.map((a): Agent => {
      const lastRun = runs.find((r) => r.agent === a.id);
      const open = data.live.tasks
        ? data.tasks.find((t) => t.agent === a.id && (t.status === 'queued' || t.status === 'in_progress'))
        : undefined;
      return {
        ...a,
        state: !lastRun ? 'never_run' : lastRun.status === 'failed' ? 'error' : 'idle',
        currentTask: open?.title ?? null,
        completedToday: undefined,
        lastRun,
      };
    });
    data.live.agents = true;
  }

  return data;
}

export async function loadDashboard(): Promise<DashboardResult> {
  const forced = getForcedState();
  if (forced === 'slow') await wait(4000);
  if (forced === 'error') {
    await wait(400);
    throw new Error('Could not load dashboard data (simulated error).');
  }
  if (forced === 'empty') {
    return { agentDataError: null, data: { ...structuredClone(demoData), tasks: [], activity: [], workflows: [] } };
  }

  try {
    const live = await loadAgentData();
    return { data: mergeLive(demoData, live), agentDataError: null };
  } catch (err) {
    return {
      data: structuredClone(demoData),
      agentDataError: err instanceof Error ? err.message : 'Agent data unavailable',
    };
  }
}
