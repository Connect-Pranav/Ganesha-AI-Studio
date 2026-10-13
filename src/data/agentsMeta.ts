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

