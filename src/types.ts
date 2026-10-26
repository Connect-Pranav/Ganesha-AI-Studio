export type ProductId = 'littleloop' | 'sunverse' | 'foliocraft';
export type BrandId = ProductId | 'studio';
export type AgentId = 'ganesha' | 'narada' | 'code-shakti';
export type View = 'universe' | 'overview' | 'cbo' | 'tasks' | 'finance' | 'subscriptions' | 'pipelines' | 'analytics' | 'studio' | 'voices' | 'characters' | ProductId | 'agents' | 'connection' | 'settings' | 'growth' | 'brain';
export type EngineId = 'claude' | 'gemini' | 'groq' | 'openai';

export interface Metric {
  label: string;
  value: string;
  delta?: string;
  trend?: 'up' | 'down' | 'flat';
  hint?: string;
}

export interface PipelineStage {
  name: string;
  count: number;
}

export interface Product {
  id: ProductId;
  name: string;
  tagline: string;
  description: string;
  accent: string;
  metrics: Metric[];
  pipeline: PipelineStage[];
}

export type AgentState = 'running' | 'idle' | 'paused' | 'error' | 'never_run';

export interface Agent {
  id: AgentId;
  name: string;
  role: string;
  description: string;
  state: AgentState;
  currentTask: string | null;
  completedToday?: number;
  lastRun?: Run;
}

export type TaskStatus = 'queued' | 'in_progress' | 'review' | 'done';
export type Priority = 'high' | 'medium' | 'low';

export interface Task {
  id: string;
  title: string;
  product: BrandId;
  agent: AgentId;
  status: TaskStatus;
  priority: Priority;
  reason?: string;
  requiresApproval?: boolean;
  prUrl?: string;
  engine?: EngineId;
}

export type ActivityKind = 'task' | 'research' | 'code' | 'publish' | 'system';

export interface Activity {
  id: string;
  minutesAgo: number;
  product: BrandId;
  agent: AgentId | null;
  kind: ActivityKind;
  text: string;
  engine?: EngineId | null;
}

export type StepState = 'done' | 'active' | 'pending' | 'failed';

export interface Workflow {
  id: string;
  name: string;
  product: ProductId;
  steps: { name: string; state: StepState }[];
}

/* ---- Live agent data (public/agent-data/*.json) ---- */
export interface Evidence {
  title: string;
  url: string;
  source: string;
  retrievedAt: string;
}

export interface Finding {
  id: string;
  brand: BrandId;
  title: string;
  insight: string;
  confidence: 'high' | 'medium' | 'low';
  evidence: Evidence[];
  engine: EngineId;
  createdAt: string;
}

export interface Run {
  id: string;
  agent: AgentId;
  engine: EngineId;
  startedAt: string;
  finishedAt: string;
  status: 'success' | 'failed' | 'partial';
  summary: string;
  error?: string;
}

export interface LiveFlags {
  tasks: boolean;
  activity: boolean;
  agents: boolean;
  research: boolean;
}

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'approval_required' | 'skipped';
export type PipelineStatus = 'pending' | 'running' | 'completed' | 'failed' | 'approval_required';

export interface PipelineStep {
  key: string;
  agent: string;
  deliverable: string;
  dependsOn: string[];
  gate?: boolean;
  approval?: boolean;
  status: StepStatus;
  attempts: number;
  qa?: 'pass' | 'fail';
  finishedAt?: string;
}

export interface Pipeline {
  id: string;
  template: string;
  brand: BrandId;
  title: string;
  goalRef: string | null;
  status: PipelineStatus;
  engine: EngineId;
  createdAt: string;
  updatedAt: string;
  steps: PipelineStep[];
}

export interface DashboardData {
  overview: Metric[];
  products: Product[];
  agents: Agent[];
  tasks: Task[];
  activity: Activity[];
  workflows: Workflow[];
  research: Finding[];
  runs: Run[];
  pipelines: Pipeline[];
  live: LiveFlags;
}

export type AiConnectionState = 'not_configured' | 'connected' | 'disconnected' | 'error';

export interface EngineStatus {
  engine: EngineId;
  label: string;
  where: string;
  state: AiConnectionState;
  message: string;
  lastRun?: Run;
}

export interface AiStatus {
  state: AiConnectionState;
  provider: string | null;
  message: string;
  checkedAt: Date;
  engines: EngineStatus[];
}
