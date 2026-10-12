// Static agent + pipeline definitions, bundled at build time from agents/*.json.
import registry from '../../agents/registry.json';
import pipelineDefs from '../../agents/pipelines.json';

export interface AgentMeta {
  id: string;
  name: string;
  team: string;
  role: string;
  mission: string;
  outputs: string[];
  acceptance: string[];
  approvalRequired: string[];
  engines: string[];
  limits?: string;
}

export const AGENTS: AgentMeta[] = registry.agents as AgentMeta[];
export const TEAMS = registry.teams as Record<string, { name: string; brand: string }>;
export const TEMPLATES = pipelineDefs.templates as Record<string, { name: string; brand: string }>;

const byId = new Map(AGENTS.map((a) => [a.id, a]));
export const agentById = (id: string) => byId.get(id);
export const agentName = (id: string) => byId.get(id)?.name ?? id;

export const VAULT_URL = 'https://github.com/Connect-Pranav/Ganesha-AI-Vault';

/** Pre-filled "new goal" issue in the private vault. */
export function newGoalUrl(label: string, title: string): string {
  const body = [
    '## Goal',
    'Describe what you want in a few lines.',
    '',
    '## Details (optional)',
    '- Mood / audience / length:',
    '- Must include:',
    '- Must avoid:',
    '- Deadline:',
  ].join('\n');
  const q = new URLSearchParams({ labels: `goal,${label}`, title, body });
  return `${VAULT_URL}/issues/new?${q.toString()}`;
}
