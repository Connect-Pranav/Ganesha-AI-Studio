// CFO data layer: settings, verified pricing, FX, budgets, subscriptions and cost arithmetic.
// Rules: never invent a price, balance, quota or exchange rate. Unknown stays null and is labelled.
import { HttpError, newId, nowIso } from './util.mjs';

/* ---------------- settings ---------------- */
export const SETTING_DEFAULTS = {
  dispatch_paused: false,
  // Mandatory owner approval when a task's conservative estimate is above this (INR). null = off.
  task_approval_inr: null,
  // What to do when cost can't be estimated but a budget exists: 'require_approval' | 'allow'.
  unknown_cost_policy: 'require_approval',
  // { rate, source, at } set by the owner. Never fetched or guessed.
  fx_usd_inr: null,
  // 'free' | 'paid' | 'unknown' per provider. Claude's API has no free tier.
  provider_billing: { claude: 'paid', gemini: 'unknown', gemini_tts: 'unknown', openai: 'paid' },
  // Maximum tasks with a non-zero reservation running at the same time. null = no extra limit.
  max_concurrent_paid_tasks: null,
  // CBO Autopilot: 'auto' starts goals itself within the limits below, 'suggest' only proposes, 'off'.
  autopilot_mode: 'auto',
  // Most a day's auto-started goals may cost (conservative estimate, INR). 0 = only provably free work
  // starts by itself; anything that may cost money waits for one tap from the owner.
  autopilot_daily_inr: 0,
  autopilot_max_goals: 2,
};

export async function getSettings(db) {
  const { results } = await db.prepare('SELECT key, value_json, updated_at FROM studio_settings').all();
  const out = structuredClone(SETTING_DEFAULTS);
  const updated = {};
  for (const r of results) {
    if (!(r.key in SETTING_DEFAULTS)) continue;
    try {
      const v = JSON.parse(r.value_json);
      out[r.key] = r.key === 'provider_billing' ? { ...SETTING_DEFAULTS.provider_billing, ...v } : v;
      updated[r.key] = r.updated_at;
    } catch {
      /* keep default */
    }
  }
  return { ...out, _updated: updated };
}

const TIERS = ['free', 'paid', 'unknown'];

/** Validates and saves a partial settings patch. Returns the list of changed keys (for the audit log). */
export async function saveSettings(db, patch) {
  if (!patch || typeof patch !== 'object') throw new HttpError(400, 'settings body must be an object');
  const writes = {};
  if ('dispatchPaused' in patch) {
    if (typeof patch.dispatchPaused !== 'boolean') throw new HttpError(400, 'dispatchPaused must be true or false');
    writes.dispatch_paused = patch.dispatchPaused;
  }
  if ('taskApprovalInr' in patch) {
    const v = patch.taskApprovalInr;
    if (v !== null && !(typeof v === 'number' && v >= 0 && v < 1e9)) throw new HttpError(400, 'taskApprovalInr must be a non-negative number or null');
    writes.task_approval_inr = v;
  }
  if ('unknownCostPolicy' in patch) {
    if (!['require_approval', 'allow'].includes(patch.unknownCostPolicy)) throw new HttpError(400, 'unknownCostPolicy must be require_approval or allow');
    writes.unknown_cost_policy = patch.unknownCostPolicy;
  }
  if ('autopilotMode' in patch) {
    if (!['auto', 'suggest', 'off'].includes(patch.autopilotMode)) throw new HttpError(400, 'autopilotMode must be auto, suggest or off');
    writes.autopilot_mode = patch.autopilotMode;
  }
  if ('autopilotDailyInr' in patch) {
    const v = patch.autopilotDailyInr;
    if (!(typeof v === 'number' && v >= 0 && v < 1e7)) throw new HttpError(400, 'autopilotDailyInr must be a non-negative number (INR)');
    writes.autopilot_daily_inr = v;
  }
  if ('autopilotMaxGoals' in patch) {
    const v = patch.autopilotMaxGoals;
    if (!(Number.isInteger(v) && v >= 1 && v <= 5)) throw new HttpError(400, 'autopilotMaxGoals must be 1-5');
    writes.autopilot_max_goals = v;
  }
  if ('maxConcurrentPaidTasks' in patch) {
    const v = patch.maxConcurrentPaidTasks;
    if (v !== null && !(Number.isInteger(v) && v >= 1 && v <= 6)) throw new HttpError(400, 'maxConcurrentPaidTasks must be 1-6 or null');
    writes.max_concurrent_paid_tasks = v;
  }
  if ('fxUsdInr' in patch) {
    const f = patch.fxUsdInr;
    if (f !== null) {
      if (!f || typeof f.rate !== 'number' || !(f.rate > 1 && f.rate < 1000)) throw new HttpError(400, 'fxUsdInr.rate must be a number (INR per 1 USD)');
      if (typeof f.source !== 'string' || !f.source.trim()) throw new HttpError(400, 'fxUsdInr.source is required (where you read the rate)');
      writes.fx_usd_inr = { rate: f.rate, source: f.source.trim().slice(0, 300), at: nowIso() };
    } else writes.fx_usd_inr = null;
  }
  if ('providerBilling' in patch) {
    const b = patch.providerBilling;
    if (!b || typeof b !== 'object') throw new HttpError(400, 'providerBilling must be an object');
    for (const [k, v] of Object.entries(b)) if (!(k in SETTING_DEFAULTS.provider_billing) || !TIERS.includes(v)) throw new HttpError(400, `providerBilling.${k} must be free, paid or unknown`);
    const cur = (await getSettings(db)).provider_billing;
    writes.provider_billing = { ...cur, ...b };
  }
  const keys = Object.keys(writes);
  if (!keys.length) throw new HttpError(400, 'No known settings in body');
  const now = nowIso();
  await db.batch(
    keys.map((k) =>
      db
        .prepare('INSERT INTO studio_settings (key, value_json, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at')
        .bind(k, JSON.stringify(writes[k]), now),
    ),
  );
  return keys;
}

/* ---------------- pricing ---------------- */
const ANTHROPIC_SRC = 'https://platform.claude.com/docs/en/about-claude/pricing';
const GEMINI_SRC = 'https://ai.google.dev/gemini-api/docs/pricing';
const VERIFIED = '2026-10-14';
const OPENAI_SRC = 'https://developers.openai.com/api/docs/models';

/** Prices read from the providers' official pricing pages on VERIFIED. USD per 1M tokens. */
export const SEEDED_PRICING = [
  { provider: 'claude', model: 'claude-sonnet-5-5', input: 2, output: 10, cacheRead: 0.1, from: '1970-01-01', to: null, freeTier: false, source: ANTHROPIC_SRC },
  { provider: 'claude', model: 'claude-opus-5-5', input: 4, output: 20, cacheRead: 0.2, from: '1970-01-01', to: null, freeTier: false, source: ANTHROPIC_SRC },
  { provider: 'claude', model: 'claude-haiku-5-5', input: 0.1, output: 0.5, cacheRead: 0.01, from: '1970-01-01', to: null, freeTier: false, source: ANTHROPIC_SRC, notes: 'Prompts up to 100,000 tokens; longer prompts cost $0.50 / $2.50.' },
  { provider: 'gemini', model: 'gemini-3.8-flash', input: 0.75, output: 3.75, from: '1970-01-01', to: '2026-12-31', freeTier: true, source: GEMINI_SRC, notes: 'Output includes thinking tokens.' },
  { provider: 'gemini', model: 'gemini-3.8-flash', input: 1.5, output: 7.5, from: '2027-01-01', to: null, freeTier: true, source: GEMINI_SRC, notes: 'Announced price from 2027-01-01.' },
  { provider: 'gemini', model: 'gemini-3.6-flash', input: 0.75, output: 3.75, from: '1970-01-01', to: '2026-12-31', freeTier: true, source: GEMINI_SRC },
  { provider: 'gemini', model: 'gemini-3.6-flash', input: 1.5, output: 7.5, from: '2027-01-01', to: null, freeTier: true, source: GEMINI_SRC },
  { provider: 'gemini', model: 'gemini-3.5-flash-lite', input: 0.3, output: 2.5, from: '1970-01-01', to: null, freeTier: true, source: GEMINI_SRC },
  { provider: 'gemini_tts', model: 'gemini-3.8-flash-tts', input: 0.5, output: 9, from: '1970-01-01', to: '2026-12-31', freeTier: true, source: GEMINI_SRC, notes: 'Output is audio tokens: 25 tokens per second of audio.' },
  { provider: 'gemini_tts', model: 'gemini-3.8-flash-tts', input: 1, output: 18, from: '2027-01-01', to: null, freeTier: true, source: GEMINI_SRC },
  // Read 2026-10-18. The models page lists no cached-input price, so cacheRead stays null (full input rate is charged).
  { provider: 'openai', model: 'gpt-6-luna', input: 0.1, output: 0.5, from: '1970-01-01', to: null, freeTier: false, source: OPENAI_SRC, verifiedAt: '2026-10-18', notes: 'Output includes reasoning tokens.' },
  { provider: 'openai', model: 'gpt-6.1-sol', input: 2, output: 10, from: '1970-01-01', to: null, freeTier: false, source: OPENAI_SRC, verifiedAt: '2026-10-18', notes: 'Output includes reasoning tokens.' },
  { provider: 'openai', model: 'gpt-6-astra', input: 10, output: 50, from: '1970-01-01', to: null, freeTier: false, source: OPENAI_SRC, verifiedAt: '2026-10-18', notes: 'Output includes reasoning tokens.' },
].map((p) => ({ verifiedAt: VERIFIED, ...p, origin: 'seed' }));

const inRange = (p, day) => p.from <= day && (!p.to || day <= p.to);

/** Price for a model on a day. Owner-entered rows win over seeded rows. null = unknown (never guessed). */
export async function priceFor(db, provider, model, day = nowIso().slice(0, 10)) {
  const { results } = await db.prepare('SELECT * FROM provider_pricing WHERE provider = ? AND model = ? ORDER BY created_at DESC').bind(provider, model).all();
  const own = results
    .map((r) => ({ provider, model, input: r.input_per_mtok, output: r.output_per_mtok, cacheRead: r.cache_read_per_mtok, from: r.effective_from, to: r.effective_to, freeTier: Boolean(r.free_tier), source: r.source_url, verifiedAt: r.verified_at, notes: r.notes, origin: 'owner', currency: r.currency }))
    .find((p) => inRange(p, day));
  if (own) return own;
  return SEEDED_PRICING.find((p) => p.provider === provider && p.model === model && inRange(p, day)) ?? null;
}

export async function listPricing(db) {
  const { results } = await db.prepare('SELECT * FROM provider_pricing ORDER BY provider, model, effective_from').all();
  return {
    seeded: SEEDED_PRICING,
    owner: results,
    note: 'Seeded prices were read from the official pricing pages on the verifiedAt date. Re-check before relying on them; owner rows override seeded rows.',
  };
}

export async function addPricing(db, b) {
  const num = (v, name, opt = false) => {
    if (opt && (v === null || v === undefined)) return null;
    if (typeof v !== 'number' || !(v >= 0) || v > 10000) throw new HttpError(400, `${name} must be a USD price per 1M tokens`);
    return v;
  };
  if (typeof b?.provider !== 'string' || !/^[a-z0-9_]{2,32}$/.test(b.provider)) throw new HttpError(400, 'provider is required');
  if (typeof b.model !== 'string' || !b.model.trim() || b.model.length > 100) throw new HttpError(400, 'model is required');
  if (typeof b.sourceUrl !== 'string' || !/^https:\/\//.test(b.sourceUrl)) throw new HttpError(400, 'sourceUrl (https) is required: where the price was read');
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (b.effectiveFrom && !day.test(b.effectiveFrom)) throw new HttpError(400, 'effectiveFrom must be YYYY-MM-DD');
  if (b.effectiveTo && !day.test(b.effectiveTo)) throw new HttpError(400, 'effectiveTo must be YYYY-MM-DD');
  const id = newId('pr');
  const now = nowIso();
  await db
    .prepare(`INSERT INTO provider_pricing (id, provider, model, input_per_mtok, output_per_mtok, cache_read_per_mtok, currency, effective_from, effective_to, free_tier, source_url, verified_at, notes, created_at)
              VALUES (?,?,?,?,?,?,'USD',?,?,?,?,?,?,?)`)
    .bind(id, b.provider, b.model.trim(), num(b.inputPerMtok, 'inputPerMtok'), num(b.outputPerMtok, 'outputPerMtok'), num(b.cacheReadPerMtok, 'cacheReadPerMtok', true), b.effectiveFrom || '1970-01-01', b.effectiveTo || null, b.freeTier ? 1 : 0, b.sourceUrl, now.slice(0, 10), typeof b.notes === 'string' ? b.notes.slice(0, 300) : null, now)
    .run();
  return id;
}

/* ---------------- arithmetic ---------------- */
export const tokenCostUsd = (price, inputTokens, outputTokens) =>
  price && price.input != null && price.output != null && inputTokens != null && outputTokens != null ? (inputTokens * price.input + outputTokens * price.output) / 1e6 : null;

export const toInr = (usd, fx) => (usd === null || usd === undefined || !fx?.rate ? null : Math.round(usd * fx.rate * 1e6) / 1e6);

/**
 * Direct charge for usage given the owner's billing tier.
 * free → 0 (quota impact only) · paid → price · unknown → paid price (conservative) with a note.
 */
export function chargeFor(price, tier, usd) {
  if (!price) return { usd: null, basis: 'no_price' };
  if (tier === 'free') return { usd: 0, basis: 'free_tier' };
  if (tier === 'paid') return { usd, basis: 'paid_rate' };
  return { usd, basis: price.freeTier ? 'paid_rate_assumed_tier_unknown' : 'paid_rate' };
}

export const monthStart = (d = new Date()) => `${d.toISOString().slice(0, 7)}-01T00:00:00Z`;

/* ---------------- budgets ---------------- */
export const BUDGET_SCOPES = ['monthly_total', 'provider', 'project', 'task'];

export async function listBudgets(db) {
  return (await db.prepare('SELECT * FROM budgets ORDER BY scope, scope_ref').all()).results;
}

export async function upsertBudget(db, b) {
  if (!BUDGET_SCOPES.includes(b?.scope)) throw new HttpError(400, `scope must be one of ${BUDGET_SCOPES.join(', ')}`);
  if (typeof b.limitInr !== 'number' || !(b.limitInr >= 0) || b.limitInr > 1e9) throw new HttpError(400, 'limitInr must be a non-negative number (INR)');
  const ref = b.scope === 'monthly_total' ? '' : b.scope === 'task' ? '*' : String(b.scopeRef ?? '').trim();
  if ((b.scope === 'provider' || b.scope === 'project') && !ref) throw new HttpError(400, `scopeRef is required for a ${b.scope} budget`);
  const warn = b.warnPct === undefined ? 80 : b.warnPct;
  if (typeof warn !== 'number' || warn < 1 || warn > 100) throw new HttpError(400, 'warnPct must be 1-100');
  const now = nowIso();
  await db
    .prepare(`INSERT INTO budgets (id, scope, scope_ref, limit_inr, warn_pct, created_at, updated_at) VALUES (?,?,?,?,?,?,?)
              ON CONFLICT(scope, scope_ref) DO UPDATE SET limit_inr = excluded.limit_inr, warn_pct = excluded.warn_pct, updated_at = excluded.updated_at`)
    .bind(newId('bg'), b.scope, ref, b.limitInr, warn, now, now)
    .run();
  return db.prepare('SELECT * FROM budgets WHERE scope = ? AND scope_ref = ?').bind(b.scope, ref).first();
}

export async function deleteBudget(db, id) {
  const r = await db.prepare('DELETE FROM budgets WHERE id = ?').bind(id).run();
  if (r.meta.changes !== 1) throw new HttpError(404, 'Budget not found');
}

/* ---------------- subscriptions ---------------- */
export async function listSubscriptions(db) {
  return (await db.prepare('SELECT * FROM subscriptions ORDER BY provider, name').all()).results;
}

export async function addSubscription(db, b, fx) {
  if (typeof b?.name !== 'string' || !b.name.trim() || b.name.length > 80) throw new HttpError(400, 'name is required');
  if (typeof b.provider !== 'string' || !b.provider.trim()) throw new HttpError(400, 'provider is required');
  if (typeof b.amount !== 'number' || !(b.amount >= 0) || b.amount > 1e7) throw new HttpError(400, 'amount must be a number');
  const currency = (b.currency ?? 'INR').toUpperCase();
  if (!['INR', 'USD'].includes(currency)) throw new HttpError(400, 'currency must be INR or USD');
  const cycle = b.billingCycle ?? 'monthly';
  if (!['monthly', 'yearly'].includes(cycle)) throw new HttpError(400, 'billingCycle must be monthly or yearly');
  // A USD subscription without an FX rate stays unconverted (amount_inr null) — shown as such.
  const inr = currency === 'INR' ? b.amount : toInr(b.amount, fx);
  const now = nowIso();
  const id = newId('sub');
  await db
    .prepare(`INSERT INTO subscriptions (id, name, provider, amount, currency, amount_inr, billing_cycle, includes_api, renews_on, notes, created_at, updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, b.name.trim(), b.provider.trim().slice(0, 40), b.amount, currency, inr, cycle, b.includesApi ? 1 : 0, typeof b.renewsOn === 'string' ? b.renewsOn.slice(0, 10) : null, typeof b.notes === 'string' ? b.notes.slice(0, 300) : null, now, now)
    .run();
  return id;
}

export async function deleteSubscription(db, id) {
  const r = await db.prepare('DELETE FROM subscriptions WHERE id = ?').bind(id).run();
  if (r.meta.changes !== 1) throw new HttpError(404, 'Subscription not found');
}

/** Monthly subscription cost in INR (yearly / 12). Unconverted subscriptions are counted separately. */
export async function subscriptionsMonthly(db) {
  const r = await db
    .prepare(`SELECT COALESCE(SUM(CASE billing_cycle WHEN 'yearly' THEN amount_inr / 12.0 ELSE amount_inr END), 0) AS inr,
                     SUM(amount_inr IS NULL) AS unconverted, COUNT(*) AS n FROM subscriptions`)
    .first();
  return { inr: r.inr, unconverted: r.unconverted ?? 0, count: r.n };
}

/* ---------------- automatic USD→INR rate ---------------- */
// Public ECB reference rate via Frankfurter (no key). Used only when the owner has not set a rate;
// an owner-entered rate always wins. Stored with its source and date like any other value.
export const FX_URL = 'https://api.frankfurter.dev/v1/latest?from=USD&to=INR';
const FX_MAX_AGE_MS = 20 * 3600_000;

export async function maybeRefreshFx(db, deps = {}) {
  const s = await getSettings(db);
  const cur = s.fx_usd_inr;
  if (cur && !cur.auto) return cur; // owner-set
  if (cur?.auto && Date.now() - Date.parse(cur.at) < FX_MAX_AGE_MS) return cur;
  const fetchImpl = deps.fetch ?? fetch;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetchImpl(FX_URL, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    const rate = Number(body?.rates?.INR);
    if (!(rate > 1 && rate < 1000)) throw new Error('no INR rate in response');
    const fx = { rate, source: `ECB reference rate via Frankfurter (${body.date})`, at: nowIso(), auto: true };
    await db
      .prepare('INSERT INTO studio_settings (key, value_json, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at')
      .bind('fx_usd_inr', JSON.stringify(fx), fx.at)
      .run();
    return fx;
  } catch (e) {
    console.warn('FX refresh failed', e?.message);
    return cur ?? null; // keep the last known rate (it shows its own date)
  } finally {
    clearTimeout(t);
  }
}
