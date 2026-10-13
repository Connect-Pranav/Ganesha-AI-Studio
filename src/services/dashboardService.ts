// Builds the dashboard model from REAL agent data (./agent-data) only.
// Every number is counted from those records; nothing is invented. Sections
// with no records show an empty state. UI components never import data sources directly.
import { baseData } from '../data/baseData';
import { loadAgentData, type AgentData } from './agentDataService';
import type { Agent, BrandId, DashboardData, Metric, Pipeline, StepState, Workflow } from '../types';

export interface DashboardResult {
  data: DashboardData;
  /** Set when live agent data could not be read; the dashboard is then empty. */
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

const STEP_STATE: Record<Pipeline['steps'][number]['status'], StepState> = {
  completed: 'done',
  skipped: 'done',
  running: 'active',
  approval_required: 'active',
  failed: 'failed',
  pending: 'pending',
};

export function pipelinesToWorkflows(pipelines: Pipeline[]): Workflow[] {
  return pipelines
    .filter((p): p is Pipeline & { brand: Exclude<BrandId, 'studio'> } => p.brand !== 'studio')
    .map((p) => ({
      id: p.id,
      name: p.title,
      product: p.brand,
      steps: p.steps.map((s) => ({ name: s.deliverable, state: STEP_STATE[s.status] })),
    }));
}

const WEEK_MS = 7 * 86400_000;
const count = (n: number, hint: string): Metric => ({ label: '', value: n.toLocaleString('en-IN'), hint });

/** Real counts from agent records. Revenue, views etc. appear only once a real source is connected. */
export function computeMetrics(data: DashboardData): void {
  const recentRuns = data.runs.filter((r) => Date.now() - Date.parse(r.finishedAt) < WEEK_MS);
  const failedRuns = recentRuns.filter((r) => r.status === 'failed').length;
  const openTasks = data.tasks.filter((t) => t.status !== 'done').length;
  const activePipes = data.pipelines.filter((p) => p.status === 'running' || p.status === 'pending').length;
  const awaiting = data.pipelines.filter((p) => p.status === 'approval_required').length;
  data.overview = [
    { ...count(data.research.length, 'Sourced NARADA findings'), label: 'Research findings' },
    { ...count(openTasks, `${data.tasks.length} planned in total`), label: 'Open agent tasks' },
    { ...count(activePipes + awaiting, `${awaiting} waiting for your approval`), label: 'Active pipelines' },
    {
      ...count(recentRuns.length, failedRuns ? `${failedRuns} failed — check Run history` : 'Last 7 days, no failures'),
      label: 'Agent runs',
      trend: failedRuns ? 'down' : 'flat',
    },
  ];
  data.products = data.products.map((prod) => {
    const pipes = data.pipelines.filter((p) => p.brand === prod.id);
    return {
      ...prod,
      metrics: [
        { label: 'Research findings', value: String(data.research.filter((f) => f.brand === prod.id).length) },
        { label: 'Open tasks', value: String(data.tasks.filter((t) => t.product === prod.id && t.status !== 'done').length) },
        { label: 'Pipelines', value: String(pipes.length), hint: `${pipes.filter((p) => p.status === 'approval_required').length} need approval` },
      ],
    };
  });
}

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
  data.workflows = pipelinesToWorkflows(live.pipelines);

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

  computeMetrics(data);
  return data;
}

export async function loadDashboard(): Promise<DashboardResult> {
  const forced = getForcedState();
  if (forced === 'slow') await wait(4000);
  if (forced === 'error') {
    await wait(400);
    throw new Error('Could not load dashboard data (simulated error).');
  }
  const empty = (): DashboardData => {
    const d = structuredClone(baseData);
    computeMetrics(d);
    return d;
  };
  if (forced === 'empty') return { agentDataError: null, data: empty() };

  try {
    const live = await loadAgentData();
    return { data: mergeLive(baseData, live), agentDataError: null };
  } catch (err) {
    return { data: empty(), agentDataError: err instanceof Error ? err.message : 'Agent data unavailable' };
  }
}
