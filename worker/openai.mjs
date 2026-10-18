// OpenAI provider: official Responses API (POST https://api.openai.com/v1/responses) over fetch.
// All OpenAI-specific request building, response parsing, errors, retries, budgets and usage logging
// live here; the rest of the Worker reaches OpenAI only through callProvider() / this module.
//
// Policy (server-side only — nothing here can be set from the browser):
//   • Key: Worker secret OPENAI_API_KEY (or the encrypted Settings value). Never logged or returned.
//   • Model: OPENAI_MODEL, else DEFAULT_OPENAI_MODEL. A failed request never switches model.
//   • Limits: OPENAI_MAX_OUTPUT_TOKENS per request, OPENAI_DAILY_REQUEST_LIMIT requests per UTC day.
//   • Tools: only the function tools the calling module defines + optional web search. Tool calls are
//     returned as proposals; this module never executes them.
//   • store: false — OpenAI is asked not to keep responses; history is sent from our own D1 records.
import { ProviderError, parseJsonOutput } from './providers.mjs';
import { priceFor } from './finance.mjs';
import { newId, nowIso } from './util.mjs';

export const OPENAI_API = 'https://api.openai.com/v1';
// Cheapest current general-purpose model on developers.openai.com/api/docs/models (checked 2026-10-18).
// Availability for a given key is verified by the connection test (GET /v1/models/{model}), never assumed.
export const DEFAULT_OPENAI_MODEL = 'gpt-6-luna';
export const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$/;
const MAX_RETRIES = 2; // 3 attempts total
const TIMEOUT_MS = 90_000;
const MAX_IMAGE_CHARS = 7_000_000; // ~5 MB image as a base64 data URL
const IMAGE_RE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;

const int = (v, min, max, d) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : d;
};

function parsePrice(v) {
  if (!v) return null;
  const [i, o, c] = String(v).split(',').map(Number);
  return Number.isFinite(i) && Number.isFinite(o) ? { input: i, output: o, cacheRead: Number.isFinite(c) ? c : null, origin: 'env' } : null;
}

export function openaiConfig(env) {
  const model = String(env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL).trim();
  return {
    provider: 'openai',
    configured: Boolean(env.OPENAI_API_KEY),
    model,
    modelSource: env.OPENAI_MODEL ? 'configured' : 'default',
    modelValid: MODEL_RE.test(model),
    secretName: 'OPENAI_API_KEY',
    // Optional "input,output[,cachedInput]" USD per 1M tokens. Otherwise the Costs pricing table is used.
    price: parsePrice(env.OPENAI_PRICE_PER_MTOK),
    maxOutputTokens: int(env.OPENAI_MAX_OUTPUT_TOKENS, 256, 64_000, 8192),
    dailyRequestLimit: int(env.OPENAI_DAILY_REQUEST_LIMIT, 1, 10_000, 200),
    timeoutMs: TIMEOUT_MS,
  };
}

/** Removes the key (and anything key-shaped) from text that may reach logs or the browser. */
export function redact(text, env = {}) {
  let t = String(text ?? '');
  if (env.OPENAI_API_KEY) t = t.split(env.OPENAI_API_KEY).join('[redacted]');
  return t.replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-[redacted]').slice(0, 400);
}

/* ---------------- request building ---------------- */

/**
 * Builds a Responses API body from Ganesha's provider options. Throws ProviderError(bad_request)
 * for anything outside policy so a bad caller fails before any money is spent.
 */
export function buildBody(cfg, opts = {}) {
  const { system, prompt, messages = [], images = [], maxTokens, json, schema, reasoning, webSearch, tools = [], stream = false } = opts;
  if (!cfg.modelValid) throw new ProviderError(`OPENAI_MODEL "${cfg.model}" is not a valid model ID`, { kind: 'bad_request' });
  if (typeof prompt !== 'string' || !prompt.trim()) throw new ProviderError('OpenAI request needs a prompt', { kind: 'bad_request' });
  if (reasoning !== undefined && reasoning !== null && !REASONING_EFFORTS.includes(reasoning)) throw new ProviderError(`reasoning must be one of ${REASONING_EFFORTS.join(', ')}`, { kind: 'bad_request' });
  if (!Array.isArray(images) || images.length > 4) throw new ProviderError('At most 4 images per request', { kind: 'bad_request' });
  for (const img of images) if (typeof img !== 'string' || img.length > MAX_IMAGE_CHARS || !IMAGE_RE.test(img)) throw new ProviderError('Images must be PNG/JPEG/WebP/GIF data URLs under ~5 MB', { kind: 'bad_request' });

  const input = [];
  for (const m of messages) {
    if (!m || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || !m.content.trim()) continue;
    input.push({ role: m.role, content: m.content });
  }
  input.push({
    role: 'user',
    content: [{ type: 'input_text', text: prompt }, ...images.map((url) => ({ type: 'input_image', image_url: url, detail: 'auto' }))],
  });

  const body = {
    model: cfg.model,
    input,
    max_output_tokens: Math.min(int(maxTokens, 16, 64_000, cfg.maxOutputTokens), cfg.maxOutputTokens),
    store: false,
  };
  const instructions = [system, json ? 'Respond with one JSON object only. No prose, no code fences.' : null].filter(Boolean).join('\n\n');
  if (instructions) body.instructions = instructions;
  if (json) body.text = { format: schema ? { type: 'json_schema', name: schema.name, schema: schema.schema, strict: true } : { type: 'json_object' } };
  if (reasoning) body.reasoning = { effort: reasoning };
  const t = [];
  if (webSearch) t.push({ type: 'web_search' });
  for (const f of tools) {
    if (!f || typeof f.name !== 'string' || !/^[a-z_][a-z0-9_]{0,63}$/.test(f.name) || typeof f.parameters !== 'object') throw new ProviderError('Invalid function tool definition', { kind: 'bad_request' });
    t.push({ type: 'function', name: f.name, description: String(f.description ?? '').slice(0, 1000), parameters: f.parameters, strict: true });
  }
  if (t.length) body.tools = t;
  if (stream) body.stream = true;
  return body;
}

/* ---------------- response parsing ---------------- */

export function parseResponse(r) {
  const texts = [];
  const sources = [];
  const toolCalls = [];
  const thoughts = [];
  let refusal = null;
  for (const item of r?.output ?? []) {
    if (item.type === 'message') {
      for (const c of item.content ?? []) {
        if (c.type === 'output_text' && c.text) {
          texts.push(c.text);
          for (const a of c.annotations ?? []) if (a.type === 'url_citation' && a.url && !sources.some((s) => s.url === a.url)) sources.push({ url: a.url, title: a.title || a.url });
        }
        if (c.type === 'refusal' && c.refusal) refusal = c.refusal;
      }
    }
    if (item.type === 'function_call') {
      let args = null;
      try {
        args = JSON.parse(item.arguments ?? 'null');
      } catch {
        args = null;
      }
      toolCalls.push({ name: item.name, callId: item.call_id ?? item.id ?? null, arguments: args });
    }
    if (item.type === 'reasoning') for (const s of item.summary ?? []) if (s.text) thoughts.push(s.text);
  }
  const u = r?.usage ?? {};
  const text = (texts.join('') || (typeof r?.output_text === 'string' ? r.output_text : '')).trim();
  return {
    id: r?.id ?? null,
    status: r?.status ?? null,
    incomplete: r?.incomplete_details?.reason ?? null,
    text: text || (refusal ? `(The model declined: ${refusal})` : ''),
    refusal,
    sources: sources.slice(0, 12),
    toolCalls,
    thoughts: thoughts.join('\n\n').trim() || null,
    usage: {
      input: u.input_tokens ?? null,
      cached: u.input_tokens_details?.cached_tokens ?? null,
      output: u.output_tokens ?? null, // includes reasoning tokens (billed as output)
      reasoning: u.output_tokens_details?.reasoning_tokens ?? null,
    },
  };
}

/* ---------------- errors ---------------- */

export function classifyError(status, raw, env, requestId) {
  let e = {};
  try {
    e = JSON.parse(raw)?.error ?? {};
  } catch {
    e = {};
  }
  const code = e.code ?? null;
  const apiMsg = redact(e.message || raw || `HTTP ${status}`, env);
  const rid = requestId ? ` (request ${requestId})` : '';
  const mk = (kind, message, retryable = false) => Object.assign(new ProviderError(`${message}${rid}`, { httpStatus: status, retryable, kind }), { code, requestId: requestId ?? null });
  if (status === 401) return mk('auth', `OpenAI rejected the API key (401). Create a new key at platform.openai.com/api-keys and save it in Settings. ${apiMsg}`);
  if (status === 403) return mk('auth', `OpenAI refused access (403): ${apiMsg}`);
  if (status === 404 || code === 'model_not_found') return mk('model_not_found', `OpenAI model not available to this key (404): ${apiMsg}`);
  if (status === 429 && (code === 'insufficient_quota' || e.type === 'insufficient_quota'))
    return mk('quota', `OpenAI quota/billing exhausted (insufficient_quota). Add credit at platform.openai.com/settings/organization/billing. ${apiMsg}`);
  if (status === 429) return mk('rate_limited', `OpenAI rate limit (429): ${apiMsg}`, true);
  if (status === 400 && (/unsupported/i.test(code ?? '') || /not supported|unsupported/i.test(e.message ?? '')))
    return mk('unsupported', `This model does not support a requested feature: ${apiMsg}`);
  if (status === 408 || status === 409 || status >= 500) return mk('server', `OpenAI server error (${status}): ${apiMsg}`, true);
  return mk('bad_request', `OpenAI rejected the request (${status}): ${apiMsg}`);
}

/* ---------------- budgets + logging ---------------- */

const dayStart = () => `${nowIso().slice(0, 10)}T00:00:00.000Z`;

export async function requestsToday(db) {
  if (!db) return 0;
  const r = await db.prepare("SELECT COUNT(*) AS n FROM provider_calls WHERE provider = 'openai' AND purpose != 'connection_test' AND created_at >= ?").bind(dayStart()).first();
  return r?.n ?? 0;
}

async function checkBudget(db, cfg) {
  const n = await requestsToday(db);
  if (n >= cfg.dailyRequestLimit)
    throw new ProviderError(`OpenAI daily request limit reached (${n}/${cfg.dailyRequestLimit}). Raise OPENAI_DAILY_REQUEST_LIMIT in Settings if this is intended.`, { kind: 'budget' });
}

/** Cost from the pricing table (owner rows win; env override wins over both). Cached input uses the cache rate when known. */
export async function costUsd(db, cfg, model, usage) {
  if (usage?.input == null || usage?.output == null) return null;
  const p = cfg.price ?? (db ? await priceFor(db, 'openai', model).catch(() => null) : null);
  if (!p || p.input == null || p.output == null) return null;
  const cached = Math.min(usage.cached ?? 0, usage.input);
  const cacheRate = p.cacheRead ?? p.input; // no published cache price → charge the full input rate (never under-count)
  return ((usage.input - cached) * p.input + cached * cacheRate + usage.output * p.output) / 1e6;
}

export async function logCall(db, cfg, { model, opts = {}, status, httpStatus = null, usage = null, started, error = null, requestId = null }) {
  if (!db) return null;
  const id = newId('pc');
  try {
    const cost = status === 'success' ? await costUsd(db, cfg, model, usage) : null;
    const now = nowIso();
    await db.batch([
      db
        .prepare(
          `INSERT INTO provider_calls (id, provider, model, purpose, task_id, status, http_status, input_tokens, output_tokens, cost_usd, latency_ms, error, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(id, 'openai', model, opts.purpose ?? 'task', opts.taskId ?? null, status, httpStatus, usage?.input ?? null, usage?.output ?? null, cost, Date.now() - started, error ? redact(error) : null, now),
      db
        .prepare('INSERT INTO provider_call_details (call_id, cached_input_tokens, reasoning_tokens, request_id, agent_id, workflow_id, created_at) VALUES (?,?,?,?,?,?,?)')
        .bind(id, usage?.cached ?? null, usage?.reasoning ?? null, requestId, opts.agentId ?? null, opts.workflowId ?? null, now),
    ]);
  } catch {
    // Logging must never break the call itself.
  }
  return id;
}

/* ---------------- transport ---------------- */

async function post(env, cfg, body, opts, deps) {
  const fetchImpl = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const timeoutMs = opts.timeoutMs ?? cfg.timeoutMs;
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const started = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let httpStatus = null;
    let requestId = null;
    try {
      const res = await fetchImpl(`${OPENAI_API}/responses`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENAI_API_KEY}` },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      httpStatus = res.status;
      requestId = res.headers?.get?.('x-request-id') ?? null;
      if (!res.ok) {
        const err = classifyError(res.status, await res.text(), env, requestId);
        err.retryAfterMs = Number(res.headers?.get?.('retry-after')) * 1000 || null;
        throw err;
      }
      // Streaming: hand the open response back; the caller reads it inside the same timeout window.
      const out = body.stream ? await readStream(res, opts.onDelta) : parseResponse(JSON.parse(await res.text()));
      clearTimeout(timer);
      return { out, httpStatus, requestId, started };
    } catch (e) {
      const err =
        e instanceof ProviderError
          ? e
          : e?.name === 'AbortError'
            ? Object.assign(new ProviderError(`OpenAI timed out after ${timeoutMs} ms`, { kind: 'timeout', retryable: true }), { requestId })
            : Object.assign(new ProviderError(`OpenAI network error: ${redact(e?.message, env)}`, { kind: 'server', retryable: true }), { requestId });
      await logCall(opts.db, cfg, { model: cfg.model, opts, status: 'error', httpStatus: err.httpStatus ?? httpStatus, started, error: err.message, requestId: err.requestId ?? requestId });
      lastErr = err;
      // Never retry once streamed text has reached the owner (it would duplicate output).
      if (!err.retryable || attempt === MAX_RETRIES || err.streamed) break;
      await sleep(Math.min(err.retryAfterMs ?? 2000 * 2 ** attempt, 20_000));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

/** Reads a Responses API SSE stream; calls onDelta(text) for each output_text delta. */
export async function readStream(res, onDelta) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let final = null;
  let streamed = false;
  const handle = (block) => {
    const data = block
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .join('\n');
    if (!data || data === '[DONE]') return;
    let ev;
    try {
      ev = JSON.parse(data);
    } catch {
      return;
    }
    if (ev.type === 'response.output_text.delta' && typeof ev.delta === 'string') {
      streamed = true;
      onDelta?.(ev.delta);
    } else if (ev.type === 'response.completed' || ev.type === 'response.incomplete') final = ev.response;
    else if (ev.type === 'response.failed') {
      const m = ev.response?.error?.message ?? 'OpenAI response failed';
      throw Object.assign(new ProviderError(`OpenAI response failed: ${redact(m)}`, { kind: 'server', retryable: !streamed }), { streamed });
    } else if (ev.type === 'error') {
      throw Object.assign(new ProviderError(`OpenAI stream error: ${redact(ev.message ?? ev.error?.message ?? 'unknown')}`, { kind: 'server', retryable: !streamed }), { streamed });
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      handle(buf.slice(0, i));
      buf = buf.slice(i + 2);
    }
  }
  if (buf.trim()) handle(buf);
  if (!final) throw Object.assign(new ProviderError('OpenAI stream ended without a completed response', { kind: 'server', retryable: !streamed }), { streamed });
  return parseResponse(final);
}

/**
 * One Responses API generation. Returns { provider, model, text, json?, usage, requestId, sources,
 * toolCalls, thoughts, incomplete }. Options: system, prompt, messages, images, maxTokens, json, schema,
 * reasoning, webSearch, tools, stream + onDelta, purpose, taskId, agentId, workflowId, timeoutMs.
 */
export async function generate(env, db, opts, deps = {}) {
  const cfg = openaiConfig(env);
  if (!cfg.configured) throw new ProviderError('OpenAI is not configured: set OPENAI_API_KEY in Settings', { kind: 'not_configured' });
  const body = buildBody(cfg, opts);
  await checkBudget(db, cfg);
  const { out, httpStatus, requestId, started } = await post(env, cfg, body, { ...opts, db }, deps);
  const fail = async (message, kind = 'bad_output') => {
    await logCall(db, cfg, { model: cfg.model, opts, status: 'error', httpStatus, usage: out.usage, started, error: message, requestId });
    throw Object.assign(new ProviderError(`${message}${requestId ? ` (request ${requestId})` : ''}`, { httpStatus, kind }), { requestId });
  };
  if (!out.text && !out.toolCalls.length)
    await fail(out.incomplete ? `OpenAI stopped before writing an answer (${out.incomplete}). Raise OPENAI_MAX_OUTPUT_TOKENS or lower reasoning.` : `OpenAI returned no text (status ${out.status ?? 'unknown'})`);
  let json;
  if (opts.json) {
    try {
      json = parseJsonOutput(out.text);
    } catch {
      await fail(out.incomplete ? `OpenAI JSON was cut off (${out.incomplete}). Raise OPENAI_MAX_OUTPUT_TOKENS.` : 'OpenAI did not return valid JSON');
    }
  }
  await logCall(db, cfg, { model: cfg.model, opts, status: 'success', httpStatus, usage: out.usage, started, requestId });
  return { provider: 'openai', model: cfg.model, text: out.text, json, usage: out.usage, requestId, sources: out.sources, toolCalls: out.toolCalls, thoughts: out.thoughts, incomplete: out.incomplete };
}

/**
 * Server-side health check. Default: GET /v1/models/{model} — proves the key works AND the configured
 * model is available to this account, without spending tokens. live=true also sends one tiny paid
 * Responses request (≈20 tokens).
 */
export async function testConnection(env, db, { live = false } = {}, deps = {}) {
  const cfg = openaiConfig(env);
  const base = { provider: 'openai', model: cfg.model, modelSource: cfg.modelSource };
  if (!cfg.configured) return { ...base, state: 'not_configured', message: 'Set OPENAI_API_KEY in Settings (platform.openai.com/api-keys).' };
  if (!cfg.modelValid) return { ...base, state: 'error', kind: 'bad_request', message: `OPENAI_MODEL "${cfg.model}" is not a valid model ID.` };
  const fetchImpl = deps.fetch ?? fetch;
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  let status = null;
  let requestId = null;
  try {
    const res = await fetchImpl(`${OPENAI_API}/models/${encodeURIComponent(cfg.model)}`, { headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` }, signal: ctrl.signal });
    status = res.status;
    requestId = res.headers?.get?.('x-request-id') ?? null;
    const raw = await res.text();
    if (!res.ok) throw classifyError(res.status, raw, env, requestId);
    await logCall(db, cfg, { model: cfg.model, opts: { purpose: 'connection_test' }, status: 'success', httpStatus: status, started, requestId });
  } catch (e) {
    const err = e instanceof ProviderError ? e : new ProviderError(e?.name === 'AbortError' ? 'OpenAI did not answer within 20 s' : `OpenAI network error: ${redact(e?.message, env)}`, { kind: e?.name === 'AbortError' ? 'timeout' : 'server' });
    await logCall(db, cfg, { model: cfg.model, opts: { purpose: 'connection_test' }, status: 'error', httpStatus: status, started, error: err.message, requestId });
    return { ...base, state: 'error', kind: err.kind, httpStatus: status, requestId, message: err.message };
  } finally {
    clearTimeout(timer);
  }
  if (!live) return { ...base, state: 'connected', requestId, live: false, message: `Key is valid and model ${cfg.model} is available to this account (no tokens used).` };
  try {
    const r = await generate(env, db, { system: 'Connectivity check.', prompt: 'Reply with {"ok":true}', json: true, maxTokens: 64, purpose: 'connection_test', timeoutMs: 30_000 }, deps);
    const ok = r.json?.ok === true;
    return { ...base, state: ok ? 'connected' : 'error', requestId: r.requestId, live: true, usage: r.usage, message: ok ? `Live request succeeded on ${cfg.model}.` : 'Model answered, but not with the expected test reply.' };
  } catch (e) {
    return { ...base, state: 'error', kind: e.kind, httpStatus: e.httpStatus ?? null, requestId: e.requestId ?? null, live: true, message: e.message };
  }
}

/** Effective configuration + usage for the Settings card. Never includes the key. */
export async function status(rawEnv, env, db) {
  const cfg = openaiConfig(env);
  const appRows = new Map((await db.prepare("SELECT name, updated_at FROM app_secrets WHERE name LIKE 'OPENAI_%'").all()).results.map((r) => [r.name, r.updated_at]));
  const src = (n) => (rawEnv[n] ? 'worker' : appRows.has(n) ? 'app' : null);
  const month = `${nowIso().slice(0, 7)}-01T00:00:00.000Z`;
  const m = await db
    .prepare(
      `SELECT COUNT(*) AS requests, SUM(c.status = 'success') AS ok, SUM(c.input_tokens) AS input, SUM(d.cached_input_tokens) AS cached,
              SUM(c.output_tokens) AS output, SUM(d.reasoning_tokens) AS reasoning, SUM(c.cost_usd) AS cost, SUM(c.status = 'success' AND c.cost_usd IS NULL) AS unpriced
       FROM provider_calls c LEFT JOIN provider_call_details d ON d.call_id = c.id
       WHERE c.provider = 'openai' AND c.purpose != 'connection_test' AND c.created_at >= ?`,
    )
    .bind(month)
    .first();
  const byPurpose = (
    await db
      .prepare(
        `SELECT c.purpose, COALESCE(d.agent_id, t.agent_id) AS agent, COUNT(*) AS requests, SUM(c.input_tokens) AS input, SUM(c.output_tokens) AS output, SUM(c.cost_usd) AS cost
         FROM provider_calls c LEFT JOIN provider_call_details d ON d.call_id = c.id LEFT JOIN tasks t ON t.id = c.task_id
         WHERE c.provider = 'openai' AND c.purpose != 'connection_test' AND c.created_at >= ? GROUP BY 1, 2 ORDER BY requests DESC LIMIT 12`,
      )
      .bind(month)
      .all()
  ).results;
  const last = await db
    .prepare(`SELECT c.status, c.purpose, c.http_status, c.error, c.created_at, d.request_id FROM provider_calls c LEFT JOIN provider_call_details d ON d.call_id = c.id WHERE c.provider = 'openai' ORDER BY c.created_at DESC LIMIT 1`)
    .first();
  const lastTest = await db
    .prepare(`SELECT c.status, c.error, c.created_at, d.request_id FROM provider_calls c LEFT JOIN provider_call_details d ON d.call_id = c.id WHERE c.provider = 'openai' AND c.purpose = 'connection_test' ORDER BY c.created_at DESC LIMIT 1`)
    .first();
  const price = cfg.price ?? (await priceFor(db, 'openai', cfg.model));
  return {
    configured: cfg.configured,
    keySource: src('OPENAI_API_KEY'),
    model: cfg.model,
    modelSource: src('OPENAI_MODEL') ?? 'default',
    defaultModel: DEFAULT_OPENAI_MODEL,
    modelValid: cfg.modelValid,
    maxOutputTokens: cfg.maxOutputTokens,
    dailyRequestLimit: cfg.dailyRequestLimit,
    requestsToday: await requestsToday(db),
    pricing: price ? { input: price.input, output: price.output, cachedInput: price.cacheRead ?? null, origin: price.origin ?? 'seed', source: price.source ?? null, verifiedAt: price.verifiedAt ?? null } : null,
    month: {
      requests: m?.requests ?? 0,
      successful: m?.ok ?? 0,
      inputTokens: m?.input ?? 0,
      cachedInputTokens: m?.cached ?? 0,
      outputTokens: m?.output ?? 0,
      reasoningTokens: m?.reasoning ?? 0,
      estimatedCostUsd: m?.cost ?? 0,
      unpricedRequests: m?.unpriced ?? 0,
    },
    byPurpose,
    lastCall: last ? { status: last.status, purpose: last.purpose, httpStatus: last.http_status, error: last.error, at: last.created_at, requestId: last.request_id } : null,
    lastTest: lastTest ? { status: lastTest.status, error: lastTest.error, at: lastTest.created_at, requestId: lastTest.request_id } : null,
  };
}
