// Live studio state from the Worker. Health is public (booleans only); the summary
// needs the owner's admin token. Every number comes from D1 rows on the Worker.
import { api, base } from './adminService';

export interface Health {
  ok: boolean;
  version: string;
  time: string;
  db: boolean;
  adminTokenSet: boolean;
  geminiKeySet?: boolean;
  claudeKeySet?: boolean;
  youtubeKeySet?: boolean;
  primaryEngine?: string | null;
  agents: number;
}

export type ProviderState = 'not_configured' | 'key_set_untested' | 'last_request_ok' | 'last_request_failed';
export interface ProviderStatus {
  provider: 'claude' | 'gemini' | 'openai';
  model: string;
  state: ProviderState;
  lastSuccessAt: string | null;
  lastError: { at: string; httpStatus: number | null; message: string | null } | null;
  costTracking: 'configured' | 'tokens_only';
}

export interface WorkflowRow {
  id: string;
  template: string;
  brand: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
  done: number;
  steps: number;
  failed_steps: number;
  running_steps: number;
}

export interface AgentStat {
  id: string;
  total: number;
  running: number;
  queued: number;
  completed: number;
  failed: number;
  waiting: number;
  /** failed steps updated in the last 48 h */
  recent_failed: number;
  last_activity: string | null;
  gate: { pass: number; fail: number } | null;
}

export interface StudioEvent {
  id: number;
  workflow_id: string | null;
  task_id: string | null;
  kind: string;
  message: string;
  created_at: string;
  brand: string | null;
  workflow_title: string | null;
}

export interface UsageRow {
  provider: string;
  calls: number;
  errors: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  avg_latency_ms: number | null;
}

export interface Integration {
  configured: boolean;
  reason?: string;
  brand?: string;
  account?: string | null;
}

export interface Summary {
  generatedAt: string;
  windowNote: string;
  workflows: WorkflowRow[];
  counts: {
    workflowsByStatus: Record<string, number>;
    workflowsByBrand: Record<string, Record<string, number>>;
    tasksByStatus: Record<string, number>;
    approvalsByStatus: Record<string, number>;
    failedTasks7d: number;
  };
  taskDurationSec: { samples: number; median: number; p90: number } | null;
  agents: AgentStat[];
  providers: ProviderStatus[];
  usage30d: UsageRow[];
  events: StudioEvent[];
  integrations: {
    youtubeStats: Integration;
    analyticsSnapshots: { brand: string; fetched_at: string; n: number }[];
    youtubeUpload: Integration;
    instagram: Integration;
    googleFlow: Integration;
    spotify: Integration;
  };
}

export interface ArtifactRow {
  id: string;
  kind: 'deliverable' | 'review';
  version: number;
  created_at: string;
  agent_id: string;
  step_key: string;
  deliverable: string;
  task_status: string;
  workflow_id: string;
  workflow_title: string;
  template: string;
  workflow_status: string;
}

export async function loadHealth(): Promise<Health> {
  const res = await fetch(`${base()}/api/health`, { cache: 'no-store' });
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) throw new Error('Studio backend is not reachable from this address.');
  if (!res.ok) throw new Error(`Backend health check failed (HTTP ${res.status}).`);
  return (await res.json()) as Health;
}

export const loadSummary = () => api<Summary>('/api/summary');
export const loadBrandArtifacts = (brand: string) => api<{ brand: string; artifacts: ArtifactRow[] }>(`/api/artifacts?brand=${encodeURIComponent(brand)}`);
export const testProvider = (p: 'claude' | 'gemini' | 'openai') =>
  api<{ provider: string; state: string; model?: string; message?: string; latencyMs?: number; error?: string }>(`/api/providers/${p}/test`, { method: 'POST', body: '{}' });

/** Output of an agent step: always a written document, never a media file. */
export async function loadArtifact(id: string): Promise<{ title: string; text: string; kind: string; version: number; created_at: string }> {
  const a = await api<{ kind: string; version: number; created_at: string; content: { deliverable?: string; summary?: string; verdict?: string; issues?: string[]; fixes?: { step_key: string; instruction: string }[] } }>(
    `/api/artifacts/${id}`,
  );
  const c = a.content ?? {};
  const text =
    c.deliverable ??
    (c.verdict
      ? [`Verdict: ${c.verdict.toUpperCase()}`, c.summary ?? '', ...(c.issues ?? []).map((i) => `• ${i}`), ...(c.fixes ?? []).map((f) => `→ Fix ${f.step_key}: ${f.instruction}`)].filter(Boolean).join('\n\n')
      : JSON.stringify(c, null, 2));
  return { title: '', text, kind: a.kind, version: a.version, created_at: a.created_at };
}
