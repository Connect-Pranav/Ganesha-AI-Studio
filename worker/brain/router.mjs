// Ganesha Brain — multi-model router. Picks the engine order for a job and tries each in turn.
// Free engines first (Gemini, Groq). Paid engines (Claude, OpenAI) are used only where the owner set
// them as an agent's engine. Every call goes through callProvider, so it is logged and costed.
import { callProvider, providerConfig, FREE_PROVIDERS, PROVIDERS, ProviderError } from '../providers.mjs';
import { enginesFor } from '../orchestrator.mjs';

// What each kind of job prefers among the free engines.
const KIND_ORDER = {
  plan: ['gemini', 'groq'], // careful reasoning + long context
  write: ['gemini', 'groq'],
  check: ['groq', 'gemini'], // short JSON verdicts: fastest first
  fast: ['groq', 'gemini'],
};

export const configured = (env, p) => {
  try {
    return providerConfig(env, p).configured;
  } catch {
    return false;
  }
};

/** Engine order for a job. `agent` (optional) brings its own engine setting first. */
export async function engineOrder(env, db, { agent = null, kind = 'write' } = {}) {
  const free = KIND_ORDER[kind] ?? FREE_PROVIDERS;
  const own = agent ? await enginesFor(db, env, agent).catch(() => []) : [];
  return [...new Set([...own, ...free])].filter((p) => PROVIDERS.includes(p) && configured(env, p));
}

export function routerStatus(env) {
  return PROVIDERS.map((p) => ({ provider: p, configured: configured(env, p), free: FREE_PROVIDERS.includes(p), model: providerConfig(env, p).model }));
}

/** Tries each engine; returns the first answer plus the errors of the ones that failed. */
export async function callRouted(env, db, engines, opts, deps = {}) {
  if (!engines.length) throw new ProviderError('No AI engine is configured. Add a free GEMINI_API_KEY or GROQ_API_KEY in Settings → API keys.', { kind: 'not_configured' });
  const errors = [];
  for (const p of engines) {
    try {
      const r = await callProvider(env, db, p, opts, deps);
      return { ...r, provider: r.provider ?? p, errors };
    } catch (e) {
      errors.push(`${p}: ${String(e.message).slice(0, 200)}`);
    }
  }
  throw new ProviderError(`All engines failed — ${errors.join(' | ')}`, { kind: 'server' });
}
