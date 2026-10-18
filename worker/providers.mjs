// Provider registry: Anthropic Messages API + Gemini generateContent + OpenAI Responses API (worker/openai.mjs).
// Server-side only. Keys come from Worker secrets and are never logged or returned.
// Every call is recorded in provider_calls (model, tokens, latency, outcome) — never prompt text.
import { newId, nowIso } from './util.mjs';
import { generate as openaiGenerate, openaiConfig, testConnection as openaiTest } from './openai.mjs';

export const PROVIDERS = ['claude', 'gemini', 'openai'];
// Providers that may be added automatically when ALLOW_PROVIDER_FALLBACK=true. OpenAI is paid per
// request, so it is only used where the owner (or an agent's registry entry) names it explicitly.
export const AUTO_FALLBACK_PROVIDERS = ['claude', 'gemini'];

const DEFAULTS = {
  claude: { model: 'claude-sonnet-5-5', timeoutMs: 120_000 },
  gemini: { model: 'gemini-3.8-flash', timeoutMs: 90_000 },
};
const MAX_RETRIES = 2; // 3 attempts total
const RETRYABLE = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);

export function providerConfig(env, provider) {
  if (provider === 'claude') {
    return {
      provider,
      configured: Boolean(env.ANTHROPIC_API_KEY),
      model: (env.ANTHROPIC_MODEL || DEFAULTS.claude.model).trim(),
      secretName: 'ANTHROPIC_API_KEY',
      // Optional USD per 1M tokens, e.g. "3,15". Without it, cost stays null (never guessed).
      price: parsePrice(env.ANTHROPIC_PRICE_PER_MTOK),
    };
  }
  if (provider === 'gemini') {
    return {
      provider,
      configured: Boolean(env.GEMINI_API_KEY),
      model: (env.GEMINI_MODEL || DEFAULTS.gemini.model).trim(),
      secretName: 'GEMINI_API_KEY',
      price: parsePrice(env.GEMINI_PRICE_PER_MTOK),
    };
  }
  if (provider === 'openai') return openaiConfig(env);
  throw new Error(`Unknown provider "${provider}"`);
}

function parsePrice(v) {
  if (!v) return null;
  const [i, o] = String(v).split(',').map(Number);
  return Number.isFinite(i) && Number.isFinite(o) ? { input: i, output: o } : null;
}

export class ProviderError extends Error {
  constructor(message, { httpStatus = null, retryable = false, kind = 'error' } = {}) {
    super(message);
    this.httpStatus = httpStatus;
    this.retryable = retryable;
    this.kind = kind; // 'not_configured' | 'auth' | 'bad_request' | 'rate_limited' | 'timeout' | 'server' | 'bad_output'
  }
}

const redact = (text, env) => {
  let t = String(text ?? '');
  for (const k of [env.ANTHROPIC_API_KEY, env.GEMINI_API_KEY, env.OPENAI_API_KEY]) if (k) t = t.split(k).join('[redacted]');
  return t.slice(0, 500);
};

/* ---------------- request builders ---------------- */
function buildRequest(env, cfg, { system, prompt, maxTokens, json }) {
  if (cfg.provider === 'claude') {
    return {
      url: 'https://api.anthropic.com/v1/messages',
      init: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: maxTokens,
          system: json ? `${system}\n\nRespond with one JSON object only. No prose, no code fences.` : system,
          messages: [{ role: 'user', content: prompt }],
        }),
      },
      parse(body) {
        const text = (body.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
        return {
          text,
          stop: body.stop_reason,
          usage: { input: body.usage?.input_tokens ?? null, output: body.usage?.output_tokens ?? null },
        };
      },
    };
  }
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        // No maxOutputTokens: Gemini 3.x counts "thinking" tokens against it, which can cut the
        // answer off. The working GitHub runner also leaves it at the model default.
        generationConfig: { temperature: 0.5, ...(json ? { responseMimeType: 'application/json' } : {}) },
      }),
    },
    parse(body) {
      const cand = body.candidates?.[0];
      const text = (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('');
      return {
        text,
        stop: cand?.finishReason ?? body.promptFeedback?.blockReason ?? null,
        // Thinking tokens are billed as output (Gemini pricing page), so they are counted here.
        usage: {
          input: body.usageMetadata?.promptTokenCount ?? null,
          output: body.usageMetadata?.candidatesTokenCount == null ? null : body.usageMetadata.candidatesTokenCount + (body.usageMetadata.thoughtsTokenCount ?? 0),
        },
      };
    },
  };
}

export function parseJsonOutput(text) {
  const t = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(t);
  } catch {
    const s = t.indexOf('{');
    const e = t.lastIndexOf('}');
    if (s >= 0 && e > s) {
      try {
        return JSON.parse(t.slice(s, e + 1));
      } catch {
        /* fall through */
      }
    }
    throw new ProviderError('Model did not return valid JSON', { kind: 'bad_output', retryable: true });
  }
}

/**
 * Calls a provider with timeout + bounded retries. Returns { text, json?, usage, model, provider }.
 * `fetchImpl` and `sleep` are injectable for tests.
 */
/** Gemini models to try in order when the main one is overloaded or unavailable (all free-tier Flash models). */
export function geminiModels(env) {
  const main = providerConfig(env, 'gemini').model;
  const extra = (env.GEMINI_FALLBACK_MODELS ?? 'gemini-3.6-flash,gemini-3.5-flash-lite').split(',').map((m) => m.trim()).filter(Boolean);
  return [...new Set([main, ...extra])];
}
const FALLBACK_KINDS = new Set(['server', 'rate_limited', 'timeout']);

export async function callProvider(env, db, provider, opts, deps = {}) {
  const cfg = providerConfig(env, provider);
  if (!cfg.configured) throw new ProviderError(`${provider} is not configured: secret ${cfg.secretName} is not set`, { kind: 'not_configured' });
  // OpenAI has its own module (Responses API, budgets, request IDs). One model only: never switched silently.
  if (provider === 'openai') return openaiGenerate(env, db, opts, deps);
  const models = provider === 'gemini' ? geminiModels(env) : [cfg.model];
  const errors = [];
  for (const model of models) {
    try {
      return await callModel(env, db, { ...cfg, model }, opts, deps);
    } catch (e) {
      errors.push(e);
      const unavailable = e.httpStatus === 404 || FALLBACK_KINDS.has(e.kind);
      if (!unavailable) throw e; // bad key / bad request / bad output: another model won't help
    }
  }
  if (errors.length === 1) throw errors[0];
  const last = errors[errors.length - 1];
  throw new ProviderError(errors.map((e) => e.message).join(' | '), { httpStatus: last.httpStatus, retryable: true, kind: last.kind });
}

async function callModel(env, db, cfg, opts, deps) {
  const provider = cfg.provider;
  const fetchImpl = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const req = buildRequest(env, cfg, { maxTokens: 4096, json: false, ...opts });
  const timeoutMs = opts.timeoutMs ?? DEFAULTS[provider].timeoutMs;

  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const started = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let httpStatus = null;
    try {
      const res = await fetchImpl(req.url, { ...req.init, signal: ctrl.signal });
      httpStatus = res.status;
      const raw = await res.text();
      if (!res.ok) {
        const retryable = RETRYABLE.has(res.status);
        const kind = res.status === 401 || res.status === 403 ? 'auth' : res.status === 429 ? 'rate_limited' : res.status >= 500 ? 'server' : 'bad_request';
        const err = new ProviderError(`${provider} HTTP ${res.status} (model "${cfg.model}"): ${redact(raw, env)}`, { httpStatus: res.status, retryable, kind });
        err.retryAfterMs = Number(res.headers.get('retry-after')) * 1000 || null;
        throw err;
      }
      const out = req.parse(JSON.parse(raw));
      if (!out.text) throw new ProviderError(`${provider} returned no text (stop: ${out.stop ?? 'unknown'})`, { httpStatus, kind: 'bad_output', retryable: true });
      const json = opts.json ? parseJsonOutput(out.text) : undefined;
      await logCall(db, { provider, cfg, opts, status: 'success', httpStatus, usage: out.usage, started });
      return { provider, model: cfg.model, text: out.text, json, usage: out.usage };
    } catch (e) {
      const err =
        e instanceof ProviderError
          ? e
          : e?.name === 'AbortError'
            ? new ProviderError(`${provider} timed out after ${timeoutMs} ms`, { kind: 'timeout', retryable: true })
            : new ProviderError(`${provider} network error: ${redact(e?.message, env)}`, { kind: 'server', retryable: true });
      await logCall(db, { provider, cfg, opts, status: 'error', httpStatus: err.httpStatus ?? httpStatus, started, error: err.message });
      lastErr = err;
      if (!err.retryable || attempt === MAX_RETRIES) break;
      await sleep(Math.min(err.retryAfterMs ?? 2000 * 2 ** attempt, 20_000));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

async function logCall(db, { provider, cfg, opts, status, httpStatus, usage, started, error }) {
  if (!db) return;
  const cost =
    cfg.price && usage?.input != null && usage?.output != null
      ? (usage.input * cfg.price.input + usage.output * cfg.price.output) / 1e6
      : null;
  try {
    await db
      .prepare(
        `INSERT INTO provider_calls (id, provider, model, purpose, task_id, status, http_status, input_tokens, output_tokens, cost_usd, latency_ms, error, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(newId('pc'), provider, cfg.model, opts.purpose ?? 'task', opts.taskId ?? null, status, httpStatus, usage?.input ?? null, usage?.output ?? null, cost, Date.now() - started, error ?? null, nowIso())
      .run();
  } catch {
    // Logging must never break the call itself.
  }
}

/** Live connectivity test: a tiny real request. Never reports "connected" just because a key exists. */
export async function testProvider(env, db, provider, deps) {
  if (provider === 'openai') return openaiTest(env, db, {}, deps);
  const cfg = providerConfig(env, provider);
  if (!cfg.configured) return { provider, model: cfg.model, state: 'not_configured', message: `Set secret ${cfg.secretName}.` };
  try {
    const r = await callProvider(
      env,
      db,
      provider,
      { system: 'You are a connectivity check.', prompt: 'Reply with {"ok":true}', json: true, maxTokens: 50, purpose: 'connection_test', timeoutMs: 30_000 },
      deps,
    );
    const ok = r.json?.ok === true;
    return { provider, model: r.model, state: ok ? 'connected' : 'error', message: ok ? 'Live request succeeded.' : 'Unexpected reply to the test prompt.' };
  } catch (e) {
    return { provider, model: cfg.model, state: 'error', message: e.message, kind: e.kind ?? 'error' };
  }
}
