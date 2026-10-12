// Reads REAL agent output published with the site at ./agent-data/*.json.
// Written by the Gemini engine (GitHub Actions) and the Claude engine
// (scheduled tasks). Validated by scripts/validate.mjs before every deploy.
import type { ActivityKind, AgentId, BrandId, EngineId, Finding, Priority, Run, TaskStatus } from '../types';

const AGENT_MAP: Record<string, AgentId> = {
  narada_market_intelligence: 'narada',
  ganesha_orchestrator: 'ganesha',
  code_shakti: 'code-shakti',
};

interface RawRun extends Omit<Run, 'agent'> {
  agent: string;
}
export interface RawTask {
  id: string;
  title: string;
  brand: BrandId;
  agent: string;
  status: TaskStatus;
  priority: Priority;
  reason: string;
  requiresApproval: boolean;
  createdAt: string;
  engine: EngineId;
  prUrl?: string;
}
export interface RawEvent {
  id: string;
  at: string;
  brand: BrandId;
  agent: string | null;
  engine: EngineId | null;
  kind: ActivityKind;
  text: string;
}

export interface AgentData {
  runs: Run[];
  findings: Finding[];
  tasks: (Omit<RawTask, 'agent'> & { agent: AgentId })[];
  events: (Omit<RawEvent, 'agent'> & { agent: AgentId | null })[];
}

export const mapAgent = (id: string): AgentId | null => AGENT_MAP[id] ?? null;

async function getJson<T>(name: string): Promise<T> {
  const res = await fetch(`./agent-data/${name}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function loadAgentData(): Promise<AgentData> {
  const [runs, research, tasks, activity] = await Promise.all([
    getJson<{ runs: RawRun[] }>('runs.json'),
    getJson<{ findings: Finding[] }>('research.json'),
    getJson<{ tasks: RawTask[] }>('tasks.json'),
    getJson<{ events: RawEvent[] }>('activity.json'),
  ]);
  return {
    runs: (runs.runs ?? []).flatMap((r) => {
      const agent = mapAgent(r.agent);
      return agent ? [{ ...r, agent }] : [];
    }),
    findings: research.findings ?? [],
    tasks: (tasks.tasks ?? []).flatMap((t) => {
      const agent = mapAgent(t.agent);
      return agent ? [{ ...t, agent }] : [];
    }),
    events: (activity.events ?? []).map((e) => ({ ...e, agent: e.agent ? mapAgent(e.agent) : null })),
  };
}
