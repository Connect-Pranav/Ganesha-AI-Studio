export type ProductId = 'littleloop' | 'sunverse' | 'foliocraft';
export type AgentId = 'ganesha' | 'narada' | 'code-shakti';
export type View = 'overview' | ProductId | 'agents' | 'connection';

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

export type AgentState = 'running' | 'idle' | 'paused';

export interface Agent {
  id: AgentId;
  name: string;
  role: string;
  description: string;
  state: AgentState;
  currentTask: string | null;
  completedToday: number;
}

export type TaskStatus = 'queued' | 'in_progress' | 'review' | 'done';
export type Priority = 'high' | 'medium' | 'low';

export interface Task {
  id: string;
  title: string;
  product: ProductId | 'studio';
  agent: AgentId;
  status: TaskStatus;
  priority: Priority;
}

export type ActivityKind = 'task' | 'research' | 'code' | 'publish' | 'system';

export interface Activity {
  id: string;
  minutesAgo: number;
  product: ProductId | 'studio';
  agent: AgentId | null;
  kind: ActivityKind;
  text: string;
}

export type StepState = 'done' | 'active' | 'pending' | 'failed';

export interface Workflow {
  id: string;
  name: string;
  product: ProductId;
  steps: { name: string; state: StepState }[];
}

export interface DashboardData {
  overview: Metric[];
  products: Product[];
  agents: Agent[];
  tasks: Task[];
  activity: Activity[];
  workflows: Workflow[];
}

export type AiConnectionState = 'not_configured' | 'connected' | 'disconnected' | 'error';

export interface AiStatus {
  state: AiConnectionState;
  provider: string | null;
  message: string;
  checkedAt: Date;
}
