// GANESHA_CBO / CFO / production API client. All calls go to this studio's own Worker
// with the owner token. Every number shown in the UI comes from these responses.
import { useCallback, useEffect, useState } from 'react';
import { api, AUTH_EVENT, getToken } from './adminService';

export type Lifecycle = 'DRAFT' | 'READY' | 'ASSIGNED' | 'RUNNING' | 'WAITING_FOR_APPROVAL' | 'BLOCKED' | 'FAILED' | 'COMPLETED' | 'CANCELLED';
export const LIFECYCLE: Lifecycle[] = ['READY', 'ASSIGNED', 'RUNNING', 'WAITING_FOR_APPROVAL', 'BLOCKED', 'FAILED', 'COMPLETED', 'CANCELLED'];
export const LIFECYCLE_LABEL: Record<Lifecycle, { label: string; cls: string }> = {
  DRAFT: { label: 'Draft', cls: 'pill-idle' },
  READY: { label: 'Ready', cls: 'pill-idle' },
  ASSIGNED: { label: 'Assigned', cls: 'pill-idle' },
  RUNNING: { label: 'Running', cls: 'pill-running' },
  WAITING_FOR_APPROVAL: { label: 'Waiting for approval', cls: 'pill-warn' },
  BLOCKED: { label: 'Blocked', cls: 'pill-paused' },
  FAILED: { label: 'Failed', cls: 'pill-error' },
  COMPLETED: { label: 'Completed', cls: 'pill-running' },
  CANCELLED: { label: 'Cancelled', cls: 'pill-idle' },
};

export interface Estimate {
  provider: string;
  model: string;
  estInputTokens: number;
  estOutputTokens: number;
  estCalls: number;
  estMediaUnits: number;
  directUsd: number | null;
  conservativeUsd: number | null;
  directInr: number | null;
  conservativeInr: number | null;
  basis: string;
  confidence: 'high' | 'medium' | 'low';
  assumptions: string[];
  pricing: { input: number; output: number; source: string; verifiedAt: string; origin: string } | null;
  durationSec: number;
  engineConfigured: boolean;
}

export interface TaskRow {
  id: string;
  workflowId: string;
  workflowTitle: string;
  brand: string;
  template: string;
  stepKey: string;
  agentId: string;
  deliverable: string;
  dependsOn: string[];
  gate: boolean;
  approvalStep: boolean;
  status: string;
  state: Lifecycle;
  stateReason: string | null;
  priority: 'urgent' | 'high' | 'normal' | 'low';
  deadline: string | null;
  overdue: boolean;
  attempts: number;
  maxAttempts: number;
  provider: string | null;
  model: string | null;
  error: string | null;
  reassignedFrom: string | null;
  estimate: { direct_inr: number | null; conservative_inr: number | null; direct_usd: number | null; conservative_usd: number | null; confidence: string; decision: string; created_at: string } | null;
  actual: { inr: number | null; usd: number | null; calls: number; input: number | null; output: number | null; unknown: number } | null;
  reservedInr: number | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

export interface BudgetStatus {
  id: string;
  scope: string;
  scopeRef: string;
  limitInr: number;
  usedInr: number;
  remainingInr: number;
  warnPct: number;
  warning: boolean;
}

export interface Report {
  controller: string;
  generatedAt: string;
  health: { dispatchPaused: boolean; providers: { provider: string; state: string; model: string }[] };
  tasks: { byState: Record<Lifecycle, number>; total: number };
  agents: { total: number; working: number; available: number; workingIds: string[] };
  deadlines: { upcoming7d: SlimTask[]; overdue: SlimTask[]; delayedGoals: { id: string; title: string; brand: string; status: string; deadline: string }[] };
  approvals: { id: string; action: string; summary: string; created_at: string; workflow_id: string; workflow_title: string; brand: string }[];
  blockers: SlimTask[];
  money: { actualMonthInr: number | null; unknownCostRows: number; reservedInr: number | null; queuedEstimateInr: number | null; subscriptionsMonthlyInr: number | null; forecastMonthInr: number | null; budgets: BudgetStatus[]; fxSet: boolean };
  recommendedActions: string[];
  subscriptions?:
    | { alerts: { level: string; service: string; message: string }[]; services: { service: string; name: string; plan: string | null; status: string | null; nextRenewal: string | null; daysUntilRenewal: number | null; missing: number; lastSync: string | null }[] }
    | { error: string };
}
export interface SlimTask {
  id: string;
  workflowId: string;
  workflowTitle: string;
  brand: string;
  stepKey: string;
  agentId: string;
  state: Lifecycle;
  reason: string | null;
  deadline: string | null;
  error: string | null;
}

export interface CommandResult {
  controller: string;
  intent: string;
  answer: string;
  source: string;
  data?: unknown;
  proposedAction?: { label: string; method: string; path: string; body: unknown; repeat?: number };
}

export interface PlanStep {
  key: string;
  agent: string;
  agentName: string;
  deliverable: string;
  dependsOn: string[];
  gate: boolean;
  approval: boolean;
  state: 'DRAFT';
  estimate: Estimate;
}
export interface Plan {
  template: string;
  templateName: string;
  brand: string;
  title: string;
  count: number;
  steps: PlanStep[];
  totals: { directInr: number | null; conservativeInr: number | null; directUsd: number | null; conservativeUsd: number | null; durationSec: number };
  confidence: string;
  approvalsInPlan: string[];
  budgetCheck: { ok: boolean | null; note?: string; over?: BudgetStatus[] };
  note: string;
  notes?: string[];
}

export interface Settings {
  dispatch_paused: boolean;
  task_approval_inr: number | null;
  unknown_cost_policy: 'require_approval' | 'allow';
  fx_usd_inr: { rate: number; source: string; at: string } | null;
  provider_billing: Record<string, 'free' | 'paid' | 'unknown'>;
  max_concurrent_paid_tasks: number | null;
  _updated: Record<string, string>;
}

export interface Finance {
  month: string;
  fx: Settings['fx_usd_inr'];
  providerBilling: Settings['provider_billing'];
  actual: { inr: number | null; unknownRows: number; byProvider: { provider: string; calls: number; input_tokens: number | null; output_tokens: number | null; usd: number | null; inr: number | null; unknown_rows: number }[] };
  tokensByModel: { provider: string; model: string; purpose: string; calls: number; input_tokens: number | null; output_tokens: number | null }[];
  reserved: { inr: number | null; active: number };
  queuedEstimate: { inr: number | null; tasksWithUnknownCost: number; tasks: number; note: string };
  subscriptions: { monthlyInr: number | null; count: number; unconverted: number };
  forecastMonthInr: number | null;
  forecastNote: string;
  budgets: BudgetStatus[];
  estimateVsActual: { task_id: string; step_key: string; agent_id: string; workflow_title: string; brand: string; est_inr: number | null; est_usd: number | null; act_inr: number | null; act_usd: number | null }[];
  perDeliverable: { template: string; brand: string; completed: number; inr: number | null; perDeliverableInr: number | null }[];
  pendingFinancialApprovals: { id: string; summary: string; workflow_title: string; created_at: string }[];
  quota: { provider: string; remaining: null; note: string }[];
  limitation: string;
}

export interface PricingRow {
  provider: string;
  model: string;
  input: number;
  output: number;
  cacheRead?: number;
  from: string;
  to: string | null;
  freeTier: boolean;
  source: string;
  verifiedAt: string;
  notes?: string;
}
export interface Subscription {
  id: string;
  name: string;
  provider: string;
  amount: number;
  currency: string;
  amount_inr: number | null;
  billing_cycle: 'monthly' | 'yearly';
  includes_api: number;
  renews_on: string | null;
  notes: string | null;
}

export interface Connection {
  id: string;
  name: string;
  kind: string;
  state: string;
  authMethod: string;
  model: string | null;
  capabilities: string[];
  lastSuccessAt: string | null;
  lastError: { at: string; message: string | null } | null;
  quotaVisibility: string;
  billingVisibility: string;
  subscriptionNote?: string;
  missing: string[];
  nextAction: string | null;
  testable: boolean;
}

export interface VoiceProfile {
  id: string;
  name: string;
  gender: 'male' | 'female' | 'child';
  age: string;
  modes: ('speech' | 'singing')[];
  language: string;
  accent: string;
  style: string;
  direction: string;
  pitchPacing: string;
  emotionalRange: string[];
  useCases: string[];
  sampleScript: string;
  provider: string | null;
  providerVoiceId: string | null;
  favorite: boolean;
  previewRef: string | null;
  availability: { descriptive: boolean; configuredProviderVoice: boolean; previewable: boolean; speechSynthesis: boolean; singing: boolean; verifiedLive: boolean; limits: string[] };
  assignments: { id: string; scope: string; scopeRef: string; role: string; mode: string; locked: boolean }[];
}
export interface VoiceRec {
  role: string;
  mode?: string;
  profileId: string | null;
  profileName?: string;
  matchScore?: number;
  reason: string;
  locked?: boolean;
  provider?: string | null;
  providerVoiceId?: string | null;
  backups: { profileId: string; name: string; matchScore: number }[];
  pronunciation?: string;
  delivery?: string;
  generationMethod?: string;
  estimatedCost?: { inr: number | null; usd: number | null; note?: string; seconds?: number };
  limitations?: string[];
}

export interface Character {
  id: string;
  brand: string;
  name: string;
  description: string;
  appearance: string;
  wardrobe: string;
  personality: string;
  language: string;
  style_constraints: string;
  reference_assets: string[];
  approved: boolean;
  voices: { role: string; profile_id: string; mode: string; locked: number }[];
}

export interface Production {
  id: string;
  brand: string;
  title: string;
  format: string;
  pillar: string;
  method: string;
  brief: string;
  requirements: { vocalRequirement?: string };
  status: string;
  deadline: string | null;
  scenes: number;
  approvedScenes: number;
  updated_at: string;
}
export interface Scene {
  id: string;
  production_id: string;
  ord: number;
  title: string;
  prompt: string;
  characters: string[];
  voice: Record<string, string | null>;
  status: string;
  version: number;
  qc: Record<string, unknown> | null;
}
export interface ProductionDetail {
  production: Production;
  scenes: Scene[];
  assets: { id: string; kind: string; provider: string; external_ref: string; status: string; scene_id: string | null; created_at: string }[];
  jobs: { id: string; provider: string; kind: string; scene_id: string | null; status: string; request: { prompt: string; steps: string[]; voiceDirection: string[] }; result: { assetId: string; externalRef: string } | null; created_at: string }[];
  voices: { role: string; profile_id: string; mode: string }[];
  continuity: { ok: boolean; issues: { sceneId: string; level: 'error' | 'warn' | 'info'; message: string }[]; note: string };
}

/* ---------- calls ---------- */
const post = <T,>(path: string, body: unknown, method = 'POST') => api<T>(path, { method, body: JSON.stringify(body ?? {}) });
export const cbo = {
  report: () => api<Report>('/api/cbo/report'),
  command: (text: string) => post<CommandResult>('/api/cbo/command', { text }),
  plan: (template: string, title: string, count: number) => post<Plan>('/api/cbo/plan', { template, title, count }),
  tasks: () => api<{ tasks: TaskRow[] }>('/api/cbo/tasks'),
  taskMeta: (id: string, body: { priority?: string; deadline?: string | null }) => post(`/api/tasks/${id}/meta`, body, 'PUT'),
  reassign: (id: string, agentId: string) => post(`/api/tasks/${id}/agent`, { agentId }, 'PUT'),
  retry: (id: string) => post(`/api/tasks/${id}/retry`, {}),
  estimates: (id: string) => api<{ estimates: (Estimate & { id: string; decision: string; created_at: string; direct_inr: number | null; conservative_inr: number | null; direct_usd: number | null; conservative_usd: number | null; est_input_tokens: number; est_output_tokens: number; est_calls: number; duration_sec: number })[] }>(`/api/tasks/${id}/estimates`),
  decide: (id: string, decision: 'approved' | 'rejected') => post(`/api/approvals/${id}`, { decision }),
  startWorkflow: (template: string, title: string, goal: string, key: string) => api<{ id: string }>('/api/workflows', { method: 'POST', body: JSON.stringify({ template, title, goal }), headers: { 'idempotency-key': key } }),
  raw: (method: string, path: string, body: unknown) => post(path, body, method),
};
export const fin = {
  summary: () => api<Finance>('/api/finance'),
  settings: () => api<Settings>('/api/settings'),
  saveSettings: (b: Record<string, unknown>) => post<{ changed: string[]; settings: Settings }>('/api/settings', b, 'PUT'),
  addBudget: (b: { scope: string; scopeRef?: string; limitInr: number; warnPct?: number }) => post('/api/finance/budgets', b),
  deleteBudget: (id: string) => api(`/api/finance/budgets/${id}`, { method: 'DELETE' }),
  pricing: () => api<{ seeded: PricingRow[]; owner: { id: string; provider: string; model: string; input_per_mtok: number; output_per_mtok: number; effective_from: string; effective_to: string | null; source_url: string; verified_at: string }[]; note: string }>('/api/finance/pricing'),
  addPricing: (b: Record<string, unknown>) => post('/api/finance/pricing', b),
  subscriptions: () => api<{ subscriptions: Subscription[] }>('/api/finance/subscriptions'),
  addSubscription: (b: Record<string, unknown>) => post('/api/finance/subscriptions', b),
  deleteSubscription: (id: string) => api(`/api/finance/subscriptions/${id}`, { method: 'DELETE' }),
};
export const conn = {
  list: () => api<{ connections: Connection[]; subscriptions: Subscription[] }>('/api/connections'),
  testOpenAI: () => post<{ state: string; message: string }>('/api/connections/openai/test', {}),
};
export const voices = {
  list: () => api<{ profiles: VoiceProfile[] }>('/api/voices'),
  update: (id: string, b: Record<string, unknown>) => post<{ profiles: VoiceProfile[] }>(`/api/voices/${id}`, b, 'PUT'),
  recommend: (b: Record<string, unknown>) => post<{ recommendations: VoiceRec[]; notes: string[] }>('/api/voices/recommend', b),
  assign: (b: Record<string, unknown>) => post('/api/voices/assign', b),
  synthesize: (id: string, text: string) => post<{ mimeType: string; audioBase64: string }>(`/api/voices/${id}/synthesize`, { text }),
};
export const studio = {
  characters: (brand?: string) => api<{ characters: Character[] }>(`/api/characters${brand ? `?brand=${brand}` : ''}`),
  saveCharacter: (b: Record<string, unknown>, id?: string) => post<{ id: string }>(id ? `/api/characters/${id}` : '/api/characters', b, id ? 'PUT' : 'POST'),
  productions: () => api<{ productions: Production[]; pillars: Record<string, string[]> }>('/api/productions'),
  createProduction: (b: Record<string, unknown>) => post<{ id: string }>('/api/productions', b),
  production: (id: string) => api<ProductionDetail>(`/api/productions/${id}`),
  addScene: (id: string, b: Record<string, unknown>) => post<{ id: string }>(`/api/productions/${id}/scenes`, b),
  regenerate: (id: string, b: Record<string, unknown>) => post(`/api/scenes/${id}/regenerate`, b),
  sceneStatus: (id: string, status: string) => post(`/api/scenes/${id}/status`, { status }, 'PUT'),
  flowHandoff: (id: string) => post<{ jobId: string; prompt: string; steps: string[]; voiceDirection: string[]; reason: string }>(`/api/scenes/${id}/flow-handoff`, {}),
  completeJob: (id: string, b: Record<string, unknown>) => post(`/api/jobs/${id}/complete`, b),
  prompt: (fields: Record<string, string>, characters: string[]) => post<{ prompt: string }>('/api/studio/prompt', { fields, characters }),
  learning: () => api<{ progress: { module_id: string; status: string }[] }>('/api/studio/learning'),
  setLearning: (moduleId: string, status: string) => post('/api/studio/learning', { moduleId, status }, 'PUT'),
};

/* ---------- tiny data hook ---------- */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(!getToken());
  const reload = useCallback(async () => {
    if (!getToken()) {
      setLocked(true);
      setLoading(false);
      return;
    }
    setLocked(false);
    setLoading(true);
    try {
      setData(await fn());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    reload();
    const on = () => reload();
    window.addEventListener(AUTH_EVENT, on);
    return () => window.removeEventListener(AUTH_EVENT, on);
  }, [reload]);
  return { data, error, loading, locked, reload, setData };
}

/* ---------- formatting ---------- */
export const inr = (v: number | null | undefined, digits = 2) => (v === null || v === undefined ? '—' : `₹${v.toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: v !== 0 && Math.abs(v) < 1 ? 2 : 0 })}`);
export const usd = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `$${v < 0.01 && v > 0 ? v.toFixed(5) : v.toFixed(2)}`);
export const money = (inrV: number | null | undefined, usdV: number | null | undefined) => (inrV !== null && inrV !== undefined ? inr(inrV) : usdV !== null && usdV !== undefined ? `${usd(usdV)} (no INR rate)` : 'Unknown');
export const tokens = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toLocaleString('en-IN'));
export const dur = (s: number | null | undefined) => (s === null || s === undefined ? '—' : s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);
export const dateShort = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

/* ---------- Subscription Intelligence ---------- */
export type DataStatus = 'LIVE' | 'RECENT' | 'IMPORTED' | 'CALCULATED' | 'ESTIMATED' | 'UNAVAILABLE' | 'NEEDS_AUTHORIZATION' | 'ERROR';
export const STATUS_PILL: Record<DataStatus, { label: string; cls: string; hint: string }> = {
  LIVE: { label: 'Live', cls: 'pill-running', hint: 'Retrieved directly from an authorized source' },
  RECENT: { label: 'Recent', cls: 'pill-running', hint: 'Retrieved successfully, not real-time' },
  IMPORTED: { label: 'Imported', cls: 'pill-info', hint: 'From a receipt, invoice or export you provided' },
  CALCULATED: { label: 'Calculated', cls: 'pill-info', hint: 'Derived from source records with a documented formula' },
  ESTIMATED: { label: 'Estimated', cls: 'pill-warn', hint: 'Forecast from known observations' },
  UNAVAILABLE: { label: 'Unavailable', cls: 'pill-idle', hint: 'Not exposed by the provider or integration' },
  NEEDS_AUTHORIZATION: { label: 'Needs authorization', cls: 'pill-paused', hint: 'Requires an account connection or permission' },
  ERROR: { label: 'Error', cls: 'pill-error', hint: 'Retrieval attempted and failed' },
};
export interface FieldAvail {
  record: string;
  field: string;
  value: unknown;
  status: DataStatus;
  source: string;
  retrievedAt?: string;
  unit?: string;
  window?: string | null;
}
export interface Fact {
  value: unknown;
  status: DataStatus;
  source: string;
  retrievedAt: string;
  confidence: string;
}
export interface BillingRow {
  id: string;
  service: string;
  record: string;
  description: string | null;
  paid_on: string | null;
  period_start: string | null;
  period_end: string | null;
  amount: number;
  tax: number | null;
  currency: string;
  amount_inr: number | null;
  status: DataStatus;
  source: string;
  superseded?: boolean;
}
export interface ServiceView {
  service: string;
  name: string;
  vendor: string;
  usageUnits: string;
  apiName: string;
  profile: Record<string, Fact>;
  period: { today: string; timezone: string | null; age: { days: number; from: string; basis: string } | null; nextRenewal?: string; daysUntilRenewal?: number; periodStart?: string; periodDays?: number; daysRemaining?: number; periodElapsedPct?: number; effectiveMonthly?: number };
  spend: {
    subscription: { inr: number | null; count: number; unconverted: number; status: DataStatus };
    apiMonth: { inr: number | null; usd: number; rows: number; status: DataStatus };
    ganeshaMonth: { inr: number | null; usd: number | null; rows: number; status: DataStatus; note: string } | null;
  };
  usage: {
    latest: { day: string; window_start: string | null; window_end: string | null; unit: string; consumed: number | null; remaining: number | null; limit_value: number | null; reset_at: string | null; status: DataStatus; source: string; synced_at: string } | null;
    consumedThisPeriod: { value: number; unit: string; status: DataStatus } | null;
    limit: number | null;
    forecast: { status: 'ESTIMATED'; ratePerDay: number; projectedTotal: number; exceedsLimit: boolean | null; formula: string } | null;
    unusedValue: { status: 'ESTIMATED'; currency: string; value: number; formula: string } | null;
  };
  ganesha: { calls: number; input_tokens: number | null; output_tokens: number | null } | null;
  external: { status: DataStatus; inputTokens?: number; formula?: string; note?: string };
  availability: FieldAvail[];
  missing: string[];
  lastSync: string | null;
  syncRuns: { id: string; adapter: string; status: string; rows: number; error: string | null; started_at: string }[];
  billing: BillingRow[];
  actions: string[];
}
export interface SubOverview {
  generatedAt: string;
  services: ServiceView[];
  totals: Record<'subscriptionsMonthly' | 'apiVerifiedMonth' | 'ganeshaApiMonth' | 'aiTotalMonth', { inr: number | null; partial: boolean; status: string; note: string }>;
  byProject: { workflow_id: string; title: string | null; brand: string | null; inr: number | null; unknown: number; calls: number }[];
  byTask: { task_id: string; step_key: string | null; agent_id: string | null; inr: number | null; unknown: number }[];
  alerts: { level: 'warn' | 'error'; service: string; message: string }[];
  fx: Settings['fx_usd_inr'];
}
export interface Decision {
  id: string;
  task_id: string;
  chosen_provider: string | null;
  reason: string;
  created_at: string;
  step_key?: string;
  agent_id?: string;
  workflow_title?: string;
  candidates: { provider: string; model: string; eligible: boolean; why: string[]; conservativeInr: number | null; conservativeUsd: number | null; tier: string | null; rateLimited1h: number }[];
}
export const subintel = {
  overview: () => api<SubOverview>('/api/subintel'),
  daily: (days = 31) => api<{ since: string; provider: { service: string; record: string; day: string; window_start: string | null; window_end: string | null; model: string; feature: string; unit: string; consumed: number | null; remaining: number | null; limit_value: number | null; reset_at: string | null; status: DataStatus; source: string; synced_at: string }[]; ganesha: { day: string; provider: string; model: string; purpose: string; calls: number; input_tokens: number | null; output_tokens: number | null }[]; note: string }>(`/api/subintel/daily?days=${days}`),
  sync: () => post<{ runs: { service: string; adapter: string; status: string; rows: number; error: string | null }[] }>('/api/subintel/sync', {}),
  saveProfile: (service: string, source: string, fields: Record<string, unknown>) => post(`/api/subintel/${service}/profile`, { source, fields }, 'PUT'),
  importRecords: (service: string, body: Record<string, unknown>) => post<{ inserted: number; updated: number; skipped: number; rejected: { row: number; error: string }[] }>(`/api/subintel/${service}/import`, body),
  decisions: () => api<{ decisions: Decision[] }>('/api/cbo/decisions'),
};

/* ---------- CBO Autopilot ---------- */
export interface Proposal {
  id: string;
  day: string;
  brand: string;
  template: string;
  title: string;
  goal: string;
  reason: string;
  evidence: string[];
  est_inr: number | null;
  est_usd: number | null;
  status: 'proposed' | 'started' | 'rejected' | 'expired';
  decided_by: string | null;
  workflow_id: string | null;
  created_at: string;
}
export const autopilot = {
  get: () => api<{ mode: 'auto' | 'suggest' | 'off'; dailyInr: number; maxGoals: number; proposals: Proposal[] }>('/api/autopilot'),
  run: () => api<{ mode: string; actions: { title: string; status: string; reason: string }[]; note?: string }>('/api/autopilot/run', { method: 'POST', body: '{}' }),
  decide: (id: string, d: 'approve' | 'reject') => api(`/api/autopilot/${id}/${d}`, { method: 'POST', body: '{}' }),
  save: (b: { autopilotMode?: string; autopilotDailyInr?: number; autopilotMaxGoals?: number }) => api('/api/settings', { method: 'PUT', body: JSON.stringify(b) }),
};
