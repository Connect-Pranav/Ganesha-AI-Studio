// Subscription Intelligence: what each AI subscription and API account actually exposes,
// with per-field provenance (source, retrieval time, window, confidence, status).
//
// Verified 2026-10-14 (see docs/SUBSCRIPTION_INTEL_AUDIT.md for sources):
//  • Claude Pro/Max, ChatGPT Plus, Google AI Pro, Canva plans: NO official API exposes the consumer
//    plan, billing dates or usage windows to a third-party app → owner import (receipts, invoices).
//  • Anthropic API: Usage & Cost Admin API (organization accounts, Admin API key) → LIVE adapter.
//  • OpenAI API: Usage & Costs API (organization Admin key) → LIVE adapter.
//  • Gemini API: no usage/billing/quota endpoint for an API key → GANESHA's own call log only;
//    Cloud Billing export (OAuth + BigQuery) is the authorized path and is not built.
//  • Canva Connect: users/me/capabilities shows plan-gated features only (OAuth not built).
// GANESHA's own calls (provider_calls) are always a SEPARATE, partial ledger — never "account usage".
import { HttpError, newId, nowIso } from './util.mjs';
import { getSettings, toInr } from './finance.mjs';

export const STATUSES = ['LIVE', 'RECENT', 'IMPORTED', 'CALCULATED', 'ESTIMATED', 'UNAVAILABLE', 'NEEDS_AUTHORIZATION', 'ERROR'];
export const RECORDS = ['consumer_subscription', 'api_account', 'api_billing', 'subscription_usage', 'api_quota', 'ganesha_usage', 'external_usage'];
const LIVE_FRESH_MS = 6 * 3600_000; // LIVE older than this is reported as RECENT

export const SERVICES = {
  google_ai_pro: {
    name: 'Google AI Pro',
    vendor: 'Google',
    apiProvider: 'gemini',
    apiName: 'Gemini API (Google AI Studio)',
    adapter: null,
    usageUnits: 'Gemini app: daily prompt limits per model/feature; Flow: monthly AI credits',
    unavailable: {
      consumer_subscription: 'No Google API exposes your Google One / Google AI Pro plan, renewal or billing to a third-party app. Import a Google Play / Google One receipt.',
      subscription_usage: 'Gemini app limits and Flow credits are shown only inside those apps. No API exposes them.',
      api_billing: 'A Gemini API key cannot read billing. The authorized path is Cloud Billing export to BigQuery (Google OAuth) — not built yet. Import a Cloud Billing CSV meanwhile.',
      api_quota: 'Remaining free-tier quota is not exposed by the Gemini API (AI Studio shows rate limits).',
      external_usage: 'Usage outside GANESHA is not observable for a Gemini API key.',
    },
  },
  chatgpt: {
    name: 'ChatGPT',
    vendor: 'OpenAI',
    apiProvider: 'openai',
    apiName: 'OpenAI API',
    adapter: 'openai_admin',
    usageUnits: 'ChatGPT: message caps per model in rolling windows',
    unavailable: {
      consumer_subscription: 'No OpenAI API exposes a ChatGPT plan, renewal or billing. Import the receipt/invoice from ChatGPT → Settings → Account.',
      subscription_usage: 'ChatGPT message caps and reset windows are shown only in the ChatGPT app. The OpenAI API cannot read them.',
      api_quota: 'Remaining API credit balance is not exposed by the Usage/Costs API.',
    },
  },
  claude: {
    name: 'Claude',
    vendor: 'Anthropic',
    apiProvider: 'claude',
    apiName: 'Anthropic API (Claude Console)',
    adapter: 'anthropic_admin',
    usageUnits: 'Claude app & Claude Code: session/weekly usage windows (not tokens)',
    unavailable: {
      consumer_subscription: 'No Anthropic API exposes a Claude Pro/Max plan, renewal or billing. Import the receipt from claude.ai → Settings → Billing.',
      subscription_usage: 'Claude app and Claude Code usage windows are shown in claude.ai Settings → Usage and in Claude Code (/usage). No API exposes them to this Worker.',
      api_quota: 'Prepaid credit balance is not exposed by the Usage & Cost API.',
    },
  },
  canva: {
    name: 'Canva',
    vendor: 'Canva',
    apiProvider: 'canva',
    apiName: 'Canva Connect API',
    adapter: null,
    usageUnits: 'Plan features; AI feature credits shown in Canva',
    unavailable: {
      consumer_subscription: 'Canva Connect exposes plan-gated capabilities (users/me/capabilities) but not plan name, price or renewal. OAuth is not built yet; import the Canva invoice for billing.',
      subscription_usage: 'Canva AI feature usage/credits are not exposed by the Connect API.',
      api_billing: 'Canva Connect has no billing; it is covered by your Canva plan.',
      api_quota: 'Only API rate limits apply (documented per endpoint).',
      external_usage: 'Not exposed.',
    },
  },
};
const serviceOf = (s) => {
  if (!(s in SERVICES)) throw new HttpError(404, `Unknown service. Known: ${Object.keys(SERVICES).join(', ')}`);
  return SERVICES[s];
};

/* ---------------- profile (owner-imported subscription facts) ---------------- */
export const PROFILE_FIELDS = {
  plan: 'text',
  account_ref: 'text',
  status: 'enum:active,trial,past_due,cancelled,expired,paused',
  start_date: 'date',
  first_observed: 'date',
  last_renewal: 'date',
  next_renewal: 'date',
  expires_on: 'date',
  billing_period: 'enum:monthly,yearly',
  amount: 'number',
  currency: 'enum:INR,USD',
  tax: 'number',
  payment_method: 'text',
  usage_unit: 'text',
  usage_window: 'text',
  usage_limit: 'number',
  timezone: 'text',
};
const DIGITS = /\d[\d\s-]{10,}\d/; // 12+ digits → looks like a card/account number

export function maskAccount(v) {
  const s = String(v).trim();
  const m = /^([^@]{1,2})[^@]*(@.+)$/.exec(s);
  if (m) return `${m[1]}***${m[2]}`;
  return s.length <= 6 ? `${s.slice(0, 1)}***` : `${s.slice(0, 3)}***${s.slice(-2)}`;
}

function validateField(field, value) {
  const type = PROFILE_FIELDS[field];
  if (!type) throw new HttpError(400, `Unknown field "${field}"`);
  if (value === null) return null;
  if (typeof value === 'string' && DIGITS.test(value)) throw new HttpError(400, `${field} looks like it contains a card or account number. Store only the type and last 4 digits (e.g. "card •••• 4242").`);
  if (type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new HttpError(400, `${field} must be a non-negative number`);
    return value;
  }
  if (type === 'date') {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) throw new HttpError(400, `${field} must be YYYY-MM-DD`);
    return value;
  }
  if (type.startsWith('enum:')) {
    const opts = type.slice(5).split(',');
    if (!opts.includes(value)) throw new HttpError(400, `${field} must be one of ${opts.join(', ')}`);
    return value;
  }
  if (typeof value !== 'string' || value.length > 200) throw new HttpError(400, `${field} must be text (max 200)`);
  if (field === 'payment_method' && !/^(card|upi|netbanking|paypal|google play|app store|bank|other)( [•*x]{0,4} ?\d{4})?$/i.test(value.trim()))
    throw new HttpError(400, 'payment_method must be a type with at most the last 4 digits, e.g. "card •••• 4242" or "upi"');
  return field === 'account_ref' ? maskAccount(value) : value.trim();
}

async function putFact(db, { service, record, field, value, unit = null, status, source, windowStart = null, windowEnd = null, confidence = 'medium', note = null }) {
  if (!STATUSES.includes(status)) throw new Error(`bad status ${status}`);
  await db
    .prepare(`INSERT INTO sub_facts (id, service, record, field, value_json, unit, status, source, retrieved_at, window_start, window_end, confidence, note)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(service, record, field) DO UPDATE SET value_json = excluded.value_json, unit = excluded.unit, status = excluded.status, source = excluded.source,
                retrieved_at = excluded.retrieved_at, window_start = excluded.window_start, window_end = excluded.window_end, confidence = excluded.confidence, note = excluded.note`)
    .bind(newId('sf'), service, record, field, value === undefined ? null : JSON.stringify(value), unit, status, String(source).slice(0, 300), nowIso(), windowStart, windowEnd, confidence, note)
    .run();
}

/** Owner enters facts read from a receipt/invoice/settings page. Status IMPORTED, source required. */
export async function saveProfile(db, service, body) {
  const svc = serviceOf(service);
  const source = typeof body?.source === 'string' ? body.source.trim() : '';
  if (!source) throw new HttpError(400, 'source is required: where you read these values (e.g. "Google Play receipt 2026-10-02")');
  const fields = body.fields;
  if (!fields || typeof fields !== 'object' || !Object.keys(fields).length) throw new HttpError(400, 'fields is required');
  const clean = {};
  for (const [k, v] of Object.entries(fields)) clean[k] = validateField(k, v);
  for (const [k, v] of Object.entries(clean)) await putFact(db, { service, record: 'consumer_subscription', field: k, value: v, status: 'IMPORTED', source, confidence: 'high' });
  // Keep the CFO subscription row (used by the monthly budget) in step with the imported plan.
  const prof = await profileOf(db, service);
  const amount = prof.amount?.value;
  if (typeof amount === 'number' && prof.currency?.value) {
    const fx = (await getSettings(db)).fx_usd_inr;
    const cur = prof.currency.value;
    const inr = cur === 'INR' ? amount : toInr(amount, fx);
    const now = nowIso();
    await db
      .prepare(`INSERT INTO subscriptions (id, name, provider, amount, currency, amount_inr, billing_cycle, includes_api, renews_on, notes, created_at, updated_at)
                VALUES (?,?,?,?,?,?,?,0,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET name = excluded.name, amount = excluded.amount, currency = excluded.currency, amount_inr = excluded.amount_inr,
                  billing_cycle = excluded.billing_cycle, renews_on = excluded.renews_on, notes = excluded.notes, updated_at = excluded.updated_at`)
      .bind(`sub_${service}`, `${svc.name}${prof.plan?.value ? ` (${prof.plan.value})` : ''}`, service, amount, cur, inr, prof.billing_period?.value ?? 'monthly', prof.next_renewal?.value ?? null, `From Subscription Intelligence · ${source}`.slice(0, 300), now, now)
      .run();
  }
  return Object.keys(clean);
}

async function profileOf(db, service) {
  const { results } = await db.prepare("SELECT * FROM sub_facts WHERE service = ? AND record = 'consumer_subscription'").bind(service).all();
  return Object.fromEntries(results.map((r) => [r.field, { value: r.value_json === null ? null : JSON.parse(r.value_json), status: r.status, source: r.source, retrievedAt: r.retrieved_at, confidence: r.confidence }]));
}

/* ---------------- dates / renewal math (pure) ---------------- */
const DAY = 86400_000;
const dayNum = (d) => Math.floor(Date.parse(`${d}T00:00:00Z`) / DAY);
const isoDay = (n) => new Date(n * DAY).toISOString().slice(0, 10);
function addMonths(d, m) {
  const [y, mo, da] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y, mo - 1 + m, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(da, last)).padStart(2, '0')}`;
}

/**
 * Renewal and period arithmetic from imported facts. Date-level precision in UTC days; the
 * provider's own billing timezone is shown when you entered it (it may shift renewal by a day).
 */
export function periodMath(p, today) {
  const t = dayNum(today);
  const out = { today, timezone: p.timezone ?? null };
  const start = p.start_date ?? null;
  const first = p.first_observed ?? null;
  if (start) out.age = { days: t - dayNum(start), from: start, basis: 'verified start date' };
  else if (first) out.age = { days: t - dayNum(first), from: first, basis: 'first observed (true start unknown)' };
  else out.age = null;
  const period = p.billing_period ?? null;
  const months = period === 'yearly' ? 12 : period === 'monthly' ? 1 : null;
  let next = p.next_renewal ?? null;
  // Roll a past renewal date forward by whole periods (renewals that already happened).
  if (next && months) while (dayNum(next) < t) next = addMonths(next, months);
  if (next) {
    out.nextRenewal = next;
    out.daysUntilRenewal = dayNum(next) - t;
    if (months) {
      const ps = addMonths(next, -months);
      const len = dayNum(next) - dayNum(ps);
      out.periodStart = ps;
      out.periodDays = len;
      out.daysRemaining = dayNum(next) - t;
      out.periodElapsedPct = Math.round(((len - out.daysRemaining) / len) * 100);
    }
    out.renewalRolled = next !== p.next_renewal;
  }
  if (typeof p.amount === 'number' && months) out.effectiveMonthly = Math.round((p.amount / months) * 100) / 100;
  return out;
}

/** Linear forecast of consumption to the end of the period. ESTIMATED; needs ≥ 3 observed days. */
export function forecastToRenewal({ consumedSoFar, daysElapsed, daysRemaining, limit = null }) {
  if (consumedSoFar === null || consumedSoFar === undefined || !(daysElapsed >= 3) || daysRemaining === undefined) return null;
  const rate = consumedSoFar / daysElapsed;
  const total = consumedSoFar + rate * daysRemaining;
  return { status: 'ESTIMATED', ratePerDay: rate, projectedTotal: total, exceedsLimit: limit !== null ? total > limit : null, formula: 'consumed ÷ days elapsed × (days elapsed + days remaining)' };
}

/* ---------------- usage + billing ledgers (dedupe + precedence) ---------------- */
/** LIVE replaces IMPORTED for the same natural key; IMPORTED never overwrites LIVE. Returns 'inserted'|'updated'|'skipped'. */
export async function upsertUsage(db, row) {
  const key = [row.service, row.record, row.day ?? '', row.model ?? '', row.feature ?? '', row.unit];
  const prev = await db.prepare('SELECT status, consumed, remaining FROM usage_ledger WHERE service = ? AND record = ? AND day = ? AND model = ? AND feature = ? AND unit = ?').bind(...key).first();
  if (prev && prev.status === 'LIVE' && row.status !== 'LIVE') return 'skipped';
  if (prev && prev.status === row.status && prev.consumed === (row.consumed ?? null) && prev.remaining === (row.remaining ?? null)) return 'skipped';
  await db
    .prepare(`INSERT INTO usage_ledger (id, service, record, day, window_start, window_end, model, feature, unit, consumed, remaining, limit_value, reset_at, status, source, synced_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(service, record, day, model, feature, unit) DO UPDATE SET window_start = excluded.window_start, window_end = excluded.window_end,
                consumed = excluded.consumed, remaining = excluded.remaining, limit_value = excluded.limit_value, reset_at = excluded.reset_at,
                status = excluded.status, source = excluded.source, synced_at = excluded.synced_at`)
    .bind(newId('ul'), row.service, row.record, row.day ?? '', row.windowStart ?? null, row.windowEnd ?? null, row.model ?? '', row.feature ?? '', row.unit, row.consumed ?? null, row.remaining ?? null, row.limit ?? null, row.resetAt ?? null, row.status, row.source, nowIso())
    .run();
  return prev ? 'updated' : 'inserted';
}

export async function upsertBilling(db, row, fx) {
  const prev = await db.prepare('SELECT status, amount FROM billing_records WHERE dedupe_key = ?').bind(row.dedupeKey).first();
  if (prev && (prev.status === 'IMPORTED' || prev.amount === row.amount)) return 'skipped';
  const inr = row.currency === 'INR' ? row.amount : toInr(row.amount, fx);
  await db
    .prepare(`INSERT INTO billing_records (id, service, record, description, period_start, period_end, paid_on, amount, tax, currency, amount_inr, fx_rate, status, source, dedupe_key, created_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(dedupe_key) DO UPDATE SET amount = excluded.amount, amount_inr = excluded.amount_inr, fx_rate = excluded.fx_rate, status = excluded.status, created_at = excluded.created_at`)
    .bind(newId('br'), row.service, row.record, row.description ?? null, row.periodStart ?? null, row.periodEnd ?? null, row.paidOn ?? null, row.amount, row.tax ?? null, row.currency, inr, row.currency === 'INR' ? null : fx?.rate ?? null, row.status, row.source, row.dedupeKey, nowIso())
    .run();
  return prev ? 'updated' : 'inserted';
}

/* ---------------- CSV import (receipts, invoices, usage exports) ---------------- */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') (cell += '"', i++);
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') (row.push(cell), (cell = ''));
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'));
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const pick = (o, ...names) => {
  for (const n of names) if (o[n] !== undefined && o[n] !== '') return o[n];
  return undefined;
};
const num = (v) => (v === undefined || v === null || v === '' ? null : Number(String(v).replace(/[₹$,\s]/g, '')));
const dayOf = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

/**
 * Imports rows (JSON array or CSV text). kind 'billing' | 'usage'. Status IMPORTED.
 * Returns counts; duplicates (same dedupe/natural key) are skipped, never double counted.
 */
export async function importRecords(db, service, { kind, record, rows, csv, source }) {
  serviceOf(service);
  if (!['billing', 'usage'].includes(kind)) throw new HttpError(400, 'kind must be billing or usage');
  if (typeof source !== 'string' || !source.trim()) throw new HttpError(400, 'source is required (file name / where the export came from)');
  const list = Array.isArray(rows) ? rows : typeof csv === 'string' ? parseCsv(csv) : null;
  if (!list) throw new HttpError(400, 'Provide rows (array) or csv (text)');
  if (list.length > 2000) throw new HttpError(413, 'Max 2000 rows per import');
  const fx = (await getSettings(db)).fx_usd_inr;
  const res = { inserted: 0, updated: 0, skipped: 0, rejected: [] };
  for (const [i, r] of list.entries()) {
    try {
      if (JSON.stringify(r).match(DIGITS) && /card|account|iban|number/i.test(Object.keys(r).join(' '))) throw new Error('row contains a card/account number column — remove it');
      if (kind === 'billing') {
        const rec = record ?? 'consumer_subscription';
        if (!['consumer_subscription', 'api_billing'].includes(rec)) throw new Error('record must be consumer_subscription or api_billing');
        const amount = num(pick(r, 'amount', 'total', 'amount_paid', 'cost'));
        if (amount === null || !Number.isFinite(amount) || amount < 0) throw new Error('amount missing');
        const currency = String(pick(r, 'currency') ?? 'INR').toUpperCase();
        if (!/^[A-Z]{3}$/.test(currency)) throw new Error('currency must be a 3-letter code');
        const paidOn = dayOf(pick(r, 'paid_on', 'date', 'invoice_date', 'charged_on'));
        if (!paidOn) throw new Error('date missing');
        const ref = pick(r, 'invoice', 'invoice_id', 'receipt', 'order_id', 'reference');
        const desc = pick(r, 'description', 'item', 'plan') ?? null;
        const out = await upsertBilling(db, { service, record: rec, description: desc, periodStart: dayOf(pick(r, 'period_start')), periodEnd: dayOf(pick(r, 'period_end')), paidOn, amount, tax: num(pick(r, 'tax', 'gst')), currency, status: 'IMPORTED', source: source.slice(0, 200), dedupeKey: `${service}|${rec}|${ref ? `ref:${ref}` : `${paidOn}|${amount}|${currency}|${desc ?? ''}`}` }, fx);
        res[out]++;
      } else {
        const rec = record ?? 'subscription_usage';
        if (!['subscription_usage', 'api_usage'].includes(rec)) throw new Error('record must be subscription_usage or api_usage');
        const unit = pick(r, 'unit');
        if (!unit) throw new Error('unit missing (e.g. messages, prompts, credits, input_tokens)');
        const consumed = num(pick(r, 'consumed', 'used', 'usage', 'count', 'quantity'));
        if (consumed === null || !Number.isFinite(consumed)) throw new Error('consumed missing');
        const day = dayOf(pick(r, 'day', 'date'));
        const ws = dayOf(pick(r, 'window_start'));
        if (!day && !ws) throw new Error('day or window_start required');
        const out = await upsertUsage(db, { service, record: rec, day: day ?? '', windowStart: ws, windowEnd: dayOf(pick(r, 'window_end')), model: pick(r, 'model') ?? '', feature: pick(r, 'feature') ?? '', unit, consumed, remaining: num(pick(r, 'remaining')), limit: num(pick(r, 'limit', 'allowance')), resetAt: pick(r, 'reset_at', 'resets') ?? null, status: 'IMPORTED', source: source.slice(0, 200) });
        res[out]++;
      }
    } catch (e) {
      res.rejected.push({ row: i + 1, error: String(e.message).slice(0, 200) });
    }
  }
  await db.prepare('INSERT INTO events (workflow_id, task_id, kind, message, data_json, created_at) VALUES (NULL,NULL,?,?,?,?)').bind('subintel_import', `${service} ${kind} import: ${res.inserted} new, ${res.updated} updated, ${res.skipped} duplicates, ${res.rejected.length} rejected`, JSON.stringify({ source }), nowIso()).run();
  return res;
}

/* ---------------- live adapters (Admin APIs) ---------------- */
async function getJson(fetchImpl, url, headers, timeoutMs = 30_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { headers, signal: ctrl.signal });
    const raw = await res.text();
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}: ${raw.slice(0, 300)}`), { status: res.status });
    return JSON.parse(raw);
  } finally {
    clearTimeout(t);
  }
}
const redact = (msg, ...keys) => keys.filter(Boolean).reduce((m, k) => m.split(k).join('[redacted]'), String(msg));
const dayStartIso = (msAgo) => `${new Date(Date.now() - msAgo).toISOString().slice(0, 10)}T00:00:00Z`;

/** Anthropic Usage & Cost Admin API (organization accounts; Admin API key). */
export async function syncAnthropic(env, db, deps = {}) {
  const key = env.ANTHROPIC_ADMIN_KEY;
  if (!key) return finishRun(db, 'claude', 'anthropic_admin', 'needs_authorization', 0, 'Set ANTHROPIC_ADMIN_KEY (Console → Settings → Admin keys; organization accounts only).');
  const fetchImpl = deps.fetch ?? fetch;
  const headers = { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'user-agent': 'GaneshaAIStudio/0.6' };
  const base = 'https://api.anthropic.com/v1/organizations';
  const start = dayStartIso(30 * DAY);
  const fx = (await getSettings(db)).fx_usd_inr;
  let n = 0;
  try {
    let page = null;
    do {
      const u = `${base}/usage_report/messages?starting_at=${start}&bucket_width=1d&group_by[]=model&limit=31${page ? `&page=${encodeURIComponent(page)}` : ''}`;
      const body = await getJson(fetchImpl, u, headers);
      for (const b of body.data ?? []) {
        const day = String(b.starting_at).slice(0, 10);
        for (const r of b.results ?? []) {
          const cc = r.cache_creation ?? {};
          const input = (r.uncached_input_tokens ?? 0) + (r.cache_read_input_tokens ?? 0) + (cc.ephemeral_5m_input_tokens ?? 0) + (cc.ephemeral_1h_input_tokens ?? 0);
          for (const [unit, v] of [['input_tokens', input], ['output_tokens', r.output_tokens ?? 0]]) {
            await upsertUsage(db, { service: 'claude', record: 'api_usage', day, model: r.model ?? '', unit, consumed: v, status: 'LIVE', source: 'Anthropic Usage API /v1/organizations/usage_report/messages' });
            n++;
          }
        }
      }
      page = body.has_more ? body.next_page : null;
    } while (page);
    page = null;
    do {
      const u = `${base}/cost_report?starting_at=${start}&group_by[]=description&limit=31${page ? `&page=${encodeURIComponent(page)}` : ''}`;
      const body = await getJson(fetchImpl, u, headers);
      for (const b of body.data ?? []) {
        const day = String(b.starting_at).slice(0, 10);
        for (const r of b.results ?? []) {
          // Per Anthropic docs: costs are USD decimal strings in the lowest unit (cents).
          const usd = Number(r.amount) / 100;
          if (!Number.isFinite(usd)) continue;
          await upsertBilling(db, { service: 'claude', record: 'api_billing', description: r.description ?? r.model ?? 'API usage', paidOn: day, periodStart: day, periodEnd: day, amount: usd, currency: String(r.currency ?? 'USD').toUpperCase(), status: 'LIVE', source: 'Anthropic Cost API /v1/organizations/cost_report', dedupeKey: `claude|api_billing|live|${day}|${r.description ?? r.model ?? ''}` }, fx);
          n++;
        }
      }
      page = body.has_more ? body.next_page : null;
    } while (page);
    await putFact(db, { service: 'claude', record: 'api_account', field: 'admin_access', value: 'organization usage & cost readable', status: 'LIVE', source: 'Anthropic Admin API', confidence: 'high' });
    return finishRun(db, 'claude', 'anthropic_admin', 'ok', n);
  } catch (e) {
    const msg = redact(e.message, key);
    await putFact(db, { service: 'claude', record: 'api_account', field: 'admin_access', value: null, status: 'ERROR', source: 'Anthropic Admin API', note: msg.slice(0, 300), confidence: 'high' });
    return finishRun(db, 'claude', 'anthropic_admin', e.status === 401 || e.status === 403 ? 'needs_authorization' : 'error', n, msg);
  }
}

/** OpenAI Usage + Costs API (organization Admin key). */
export async function syncOpenAI(env, db, deps = {}) {
  const key = env.OPENAI_ADMIN_KEY;
  if (!key) return finishRun(db, 'chatgpt', 'openai_admin', 'needs_authorization', 0, 'Set OPENAI_ADMIN_KEY (platform.openai.com → Organization → Admin keys).');
  const fetchImpl = deps.fetch ?? fetch;
  const headers = { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
  const base = 'https://api.openai.com/v1/organization';
  const start = Math.floor(Date.parse(dayStartIso(30 * DAY)) / 1000);
  const fx = (await getSettings(db)).fx_usd_inr;
  let n = 0;
  try {
    let page = null;
    do {
      const body = await getJson(fetchImpl, `${base}/usage/completions?start_time=${start}&bucket_width=1d&group_by=model&limit=31${page ? `&page=${encodeURIComponent(page)}` : ''}`, headers);
      for (const b of body.data ?? []) {
        const day = new Date(b.start_time * 1000).toISOString().slice(0, 10);
        for (const r of b.results ?? []) {
          for (const [unit, v] of [['input_tokens', r.input_tokens], ['output_tokens', r.output_tokens], ['requests', r.num_model_requests]]) {
            if (v === undefined || v === null) continue;
            await upsertUsage(db, { service: 'chatgpt', record: 'api_usage', day, model: r.model ?? '', unit, consumed: v, status: 'LIVE', source: 'OpenAI Usage API /v1/organization/usage/completions' });
            n++;
          }
        }
      }
      page = body.has_more ? body.next_page : null;
    } while (page);
    page = null;
    do {
      const body = await getJson(fetchImpl, `${base}/costs?start_time=${start}&bucket_width=1d&limit=31${page ? `&page=${encodeURIComponent(page)}` : ''}`, headers);
      for (const b of body.data ?? []) {
        const day = new Date(b.start_time * 1000).toISOString().slice(0, 10);
        for (const r of b.results ?? []) {
          const v = Number(r.amount?.value);
          if (!Number.isFinite(v)) continue;
          await upsertBilling(db, { service: 'chatgpt', record: 'api_billing', description: r.line_item ?? 'API usage', paidOn: day, periodStart: day, periodEnd: day, amount: v, currency: String(r.amount?.currency ?? 'usd').toUpperCase(), status: 'LIVE', source: 'OpenAI Costs API /v1/organization/costs', dedupeKey: `chatgpt|api_billing|live|${day}|${r.line_item ?? ''}|${r.project_id ?? ''}` }, fx);
          n++;
        }
      }
      page = body.has_more ? body.next_page : null;
    } while (page);
    await putFact(db, { service: 'chatgpt', record: 'api_account', field: 'admin_access', value: 'organization usage & costs readable', status: 'LIVE', source: 'OpenAI Admin API', confidence: 'high' });
    return finishRun(db, 'chatgpt', 'openai_admin', 'ok', n);
  } catch (e) {
    const msg = redact(e.message, key);
    await putFact(db, { service: 'chatgpt', record: 'api_account', field: 'admin_access', value: null, status: 'ERROR', source: 'OpenAI Admin API', note: msg.slice(0, 300), confidence: 'high' });
    return finishRun(db, 'chatgpt', 'openai_admin', e.status === 401 || e.status === 403 ? 'needs_authorization' : 'error', n, msg);
  }
}

async function finishRun(db, service, adapter, status, rows, error = null) {
  const now = nowIso();
  await db.prepare('INSERT INTO sync_runs (id, service, adapter, status, rows, error, started_at, finished_at) VALUES (?,?,?,?,?,?,?,?)').bind(newId('sr'), service, adapter, status, rows, error ? String(error).slice(0, 500) : null, now, now).run();
  return { service, adapter, status, rows, error };
}

export async function syncAll(env, db, deps = {}) {
  return [await syncAnthropic(env, db, deps), await syncOpenAI(env, db, deps)];
}

/* ---------------- the full picture ---------------- */
const ageStatus = (iso, status) => (status === 'LIVE' && iso && Date.now() - Date.parse(iso) > LIVE_FRESH_MS ? 'RECENT' : status);

/** GANESHA's own calls (provider_calls) — a partial, local ledger. */
async function ganeshaUsage(db, provider, sinceIso) {
  return db
    .prepare(`SELECT COUNT(*) AS calls, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, MIN(created_at) AS first_at, MAX(created_at) AS last_at
              FROM provider_calls WHERE provider = ? AND created_at >= ? AND status = 'success'`)
    .bind(provider, sinceIso)
    .first();
}

export async function serviceView(env, db, service, providersState = []) {
  const svc = serviceOf(service);
  const today = nowIso().slice(0, 10);
  const prof = await profileOf(db, service);
  const flat = Object.fromEntries(Object.entries(prof).map(([k, v]) => [k, v.value]));
  const pm = periodMath(flat, today);
  const settings = await getSettings(db);
  const fx = settings.fx_usd_inr;
  const monthStart = `${today.slice(0, 7)}-01`;
  const periodStart = pm.periodStart ?? monthStart;

  const bills = (await db.prepare('SELECT * FROM billing_records WHERE service = ? ORDER BY paid_on DESC').bind(service).all()).results;
  const subBills = bills.filter((b) => b.record === 'consumer_subscription');
  const apiBills = bills.filter((b) => b.record === 'api_billing');
  // Imported API invoices for a month that also has LIVE cost rows are superseded (no double count).
  const liveMonths = new Set(apiBills.filter((b) => b.status === 'LIVE').map((b) => (b.paid_on ?? '').slice(0, 7)));
  const apiCounted = apiBills.filter((b) => b.status === 'LIVE' || !liveMonths.has((b.paid_on ?? '').slice(0, 7)));
  const sumInr = (rows) => (rows.some((r) => r.amount_inr === null) ? null : rows.reduce((a, r) => a + r.amount_inr, 0));
  const subSpend = { inr: sumInr(subBills), count: subBills.length, unconverted: subBills.filter((b) => b.amount_inr === null).length, status: subBills.length ? 'IMPORTED' : 'UNAVAILABLE' };
  const apiMonth = apiCounted.filter((b) => (b.paid_on ?? '') >= monthStart);
  const apiMonthSpend = { inr: sumInr(apiMonth), usd: apiMonth.filter((b) => b.currency === 'USD').reduce((a, b) => a + b.amount, 0), rows: apiMonth.length, status: apiMonth.some((b) => b.status === 'LIVE') ? ageStatus(apiMonth[0]?.created_at, 'LIVE') : apiMonth.length ? 'IMPORTED' : 'UNAVAILABLE' };

  const usage = (await db.prepare('SELECT * FROM usage_ledger WHERE service = ? ORDER BY day DESC, unit').bind(service).all()).results;
  const subUsage = usage.filter((u) => u.record === 'subscription_usage');
  const latestSub = subUsage[0] ?? null;
  const periodSubUsage = subUsage.filter((u) => (u.day || u.window_start || '') >= periodStart);
  const consumedPeriod = periodSubUsage.length ? periodSubUsage.reduce((a, u) => a + (u.consumed ?? 0), 0) : null;
  const daysElapsed = pm.periodDays && pm.daysRemaining !== undefined ? pm.periodDays - pm.daysRemaining : null;
  const limit = latestSub?.limit_value ?? flat.usage_limit ?? null;
  const forecast = forecastToRenewal({ consumedSoFar: consumedPeriod, daysElapsed, daysRemaining: pm.daysRemaining, limit });
  const unusedValue =
    limit && consumedPeriod !== null && pm.effectiveMonthly && flat.billing_period === 'monthly' && forecast
      ? { status: 'ESTIMATED', currency: flat.currency, value: Math.max(0, Math.round((1 - Math.min(1, forecast.projectedTotal / limit)) * pm.effectiveMonthly * 100) / 100), formula: '(1 − projected use ÷ limit) × monthly cost' }
      : null;

  const ganesha = svc.apiProvider ? await ganeshaUsage(db, svc.apiProvider, `${monthStart}T00:00:00Z`) : null;
  const ganeshaCost = svc.apiProvider
    ? await db.prepare("SELECT SUM(amount_inr) AS inr, SUM(amount_usd) AS usd, SUM(amount_inr IS NULL) AS unknown, COUNT(*) AS n FROM cost_ledger WHERE provider IN (?, ?) AND created_at >= ?").bind(svc.apiProvider, `${svc.apiProvider}_tts`, `${monthStart}T00:00:00Z`).first()
    : null;
  const apiUsageMonth = usage.filter((u) => u.record === 'api_usage' && u.day >= monthStart);
  const accountTokens = (unit) => (apiUsageMonth.some((u) => u.unit === unit) ? apiUsageMonth.filter((u) => u.unit === unit).reduce((a, u) => a + (u.consumed ?? 0), 0) : null);
  const accIn = accountTokens('input_tokens');
  const external =
    accIn !== null && ganesha
      ? { status: 'CALCULATED', inputTokens: Math.max(0, accIn - (ganesha.input_tokens ?? 0)), formula: 'account API input tokens (provider-reported) − GANESHA input tokens (local log)', note: 'Approximate: provider buckets and GANESHA logs can differ by a few minutes at day edges.' }
      : { status: svc.unavailable.external_usage ? 'UNAVAILABLE' : 'NEEDS_AUTHORIZATION', note: svc.unavailable.external_usage ?? 'Connect the provider Admin API to compare account-wide API usage with GANESHA calls.' };

  const runs = (await db.prepare('SELECT * FROM sync_runs WHERE service = ? ORDER BY started_at DESC LIMIT 10').bind(service).all()).results;
  const lastOk = runs.find((r) => r.status === 'ok') ?? null;
  const prov = providersState.find((p) => p.provider === svc.apiProvider);
  const keyEnv = { gemini: 'GEMINI_API_KEY', claude: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', canva: 'CANVA_CLIENT_ID' }[svc.apiProvider];
  const adminEnv = { claude: 'ANTHROPIC_ADMIN_KEY', chatgpt: 'OPENAI_ADMIN_KEY' }[service];

  const field = (record, name, value, status, source, extra = {}) => ({ record, field: name, value, status, source, ...extra });
  const pf = (name) => (prof[name] ? field('consumer_subscription', name, prof[name].value, prof[name].status, prof[name].source, { retrievedAt: prof[name].retrievedAt }) : field('consumer_subscription', name, null, 'UNAVAILABLE', svc.unavailable.consumer_subscription));
  const availability = [
    ...Object.keys(PROFILE_FIELDS).map(pf),
    field('subscription_usage', 'current_usage', latestSub?.consumed ?? null, latestSub ? ageStatus(latestSub.synced_at, latestSub.status) : 'UNAVAILABLE', latestSub?.source ?? svc.unavailable.subscription_usage, { unit: latestSub?.unit, window: latestSub ? [latestSub.window_start ?? latestSub.day, latestSub.window_end].filter(Boolean).join(' → ') : null }),
    field('subscription_usage', 'remaining_allowance', latestSub?.remaining ?? null, latestSub?.remaining !== null && latestSub?.remaining !== undefined ? latestSub.status : 'UNAVAILABLE', latestSub?.remaining !== null && latestSub ? latestSub.source : svc.unavailable.subscription_usage),
    field('subscription_usage', 'reset_at', latestSub?.reset_at ?? null, latestSub?.reset_at ? latestSub.status : 'UNAVAILABLE', latestSub?.reset_at ? latestSub.source : svc.unavailable.subscription_usage),
    field('api_account', 'credentials', keyEnv ? (env[keyEnv] ? 'set' : null) : null, !keyEnv ? 'UNAVAILABLE' : env[keyEnv] ? (prov?.state === 'last_request_ok' ? 'LIVE' : 'NEEDS_AUTHORIZATION') : 'NEEDS_AUTHORIZATION', keyEnv ? `Worker secret ${keyEnv}${prov ? ` · ${prov.state}` : ''}` : 'No developer API'),
    field('api_billing', 'month_to_date', apiMonthSpend.rows ? apiMonthSpend.inr : adminEnv && env[adminEnv] && lastOk ? 0 : null, apiMonthSpend.status === 'UNAVAILABLE' ? (adminEnv ? (env[adminEnv] ? (lastOk ? ageStatus(lastOk.finished_at, 'LIVE') : 'ERROR') : 'NEEDS_AUTHORIZATION') : 'UNAVAILABLE') : apiMonthSpend.status, adminEnv ? (env[adminEnv] ? `Admin API (${adminEnv})` : `Set ${adminEnv} (organization Admin key)`) : svc.unavailable.api_billing ?? 'Import invoices'),
    field('api_quota', 'remaining_credit', null, 'UNAVAILABLE', svc.unavailable.api_quota),
    field('ganesha_usage', 'month_calls', ganesha?.calls ?? 0, 'CALCULATED', 'GANESHA provider_calls log (only calls made by this studio)'),
    field('external_usage', 'outside_ganesha', external.inputTokens ?? null, external.status, external.formula ?? external.note),
  ];

  const missing = availability.filter((a) => ['UNAVAILABLE', 'NEEDS_AUTHORIZATION', 'ERROR'].includes(a.status)).map((a) => `${a.record}.${a.field}`);
  const actions = [];
  if (!prof.plan) actions.push(`Import your ${svc.name} receipt (plan, amount, renewal date) — no API exposes it.`);
  if (adminEnv && !env[adminEnv]) actions.push(`Optional: set ${adminEnv} to read account-wide API usage and cost.`);
  if (runs[0]?.status === 'error') actions.push(`Last sync failed: ${runs[0].error}`);
  if (pm.daysUntilRenewal !== undefined && pm.daysUntilRenewal <= 7) actions.push(`Renews in ${pm.daysUntilRenewal} day(s) — decide whether to keep the plan.`);
  if (!fx && (flat.currency === 'USD' || apiBills.some((b) => b.currency !== 'INR'))) actions.push('Set a USD→INR rate in CFO → Settings to convert USD amounts.');

  return {
    service,
    name: svc.name,
    vendor: svc.vendor,
    usageUnits: svc.usageUnits,
    apiName: svc.apiName,
    profile: prof,
    period: pm,
    spend: { subscription: subSpend, apiMonth: apiMonthSpend, ganeshaMonth: ganeshaCost ? { inr: ganeshaCost.unknown ? null : ganeshaCost.inr ?? 0, usd: ganeshaCost.usd, rows: ganeshaCost.n, status: 'CALCULATED', note: 'Only calls made by GANESHA — not your whole account.' } : null },
    usage: { latest: latestSub, consumedThisPeriod: consumedPeriod === null ? null : { value: consumedPeriod, unit: latestSub?.unit, status: 'CALCULATED' }, limit, forecast, unusedValue },
    ganesha,
    external,
    availability,
    missing,
    lastSync: lastOk?.finished_at ?? null,
    syncRuns: runs,
    billing: bills.slice(0, 50).map((b) => ({ ...b, superseded: b.record === 'api_billing' && b.status === 'IMPORTED' && liveMonths.has((b.paid_on ?? '').slice(0, 7)) })),
    actions,
  };
}

/** Totals across all four services, keeping verified spending apart from estimates. */
export async function overview(env, db, providersState = []) {
  const services = [];
  for (const s of Object.keys(SERVICES)) services.push(await serviceView(env, db, s, providersState));
  const settings = await getSettings(db);
  const total = (pick) => {
    const vals = services.map(pick);
    const known = vals.filter((v) => v !== null);
    // Nothing verified at all → unknown (null), never a misleading ₹0.
    if (!known.length) return { inr: null, partial: true };
    return { inr: known.reduce((a, b) => a + b, 0), partial: known.length < vals.length };
  };
  const subMonthly = services.map((s) => (s.period.effectiveMonthly !== undefined ? (s.profile.currency?.value === 'INR' ? s.period.effectiveMonthly : toInr(s.period.effectiveMonthly, settings.fx_usd_inr)) : null));
  const apiVerified = services.map((s) => (['LIVE', 'RECENT', 'IMPORTED'].includes(s.spend.apiMonth.status) ? s.spend.apiMonth.inr : null));
  const ganeshaOnly = services.map((s) => s.spend.ganeshaMonth?.inr ?? null);
  // Spend by project / task from GANESHA's reconciled ledger.
  const byProject = (await db.prepare('SELECT l.workflow_id, w.title, w.brand, SUM(l.amount_inr) AS inr, SUM(l.amount_inr IS NULL) AS unknown, SUM(l.calls) AS calls FROM cost_ledger l LEFT JOIN workflows w ON w.id = l.workflow_id WHERE l.workflow_id IS NOT NULL GROUP BY l.workflow_id ORDER BY inr DESC LIMIT 20').all()).results;
  const byTask = (await db.prepare('SELECT l.task_id, t.step_key, t.agent_id, SUM(l.amount_inr) AS inr, SUM(l.amount_inr IS NULL) AS unknown FROM cost_ledger l LEFT JOIN tasks t ON t.id = l.task_id WHERE l.task_id IS NOT NULL GROUP BY l.task_id ORDER BY inr DESC LIMIT 20').all()).results;
  const alerts = [];
  for (const s of services) {
    if (s.period.daysUntilRenewal !== undefined && s.period.daysUntilRenewal <= 7) alerts.push({ level: 'warn', service: s.service, message: `${s.name} renews in ${s.period.daysUntilRenewal} day(s) (${s.period.nextRenewal}).` });
    if (s.usage.limit && s.usage.consumedThisPeriod && s.usage.consumedThisPeriod.value / s.usage.limit >= 0.8) alerts.push({ level: 'warn', service: s.service, message: `${s.name}: ${Math.round((s.usage.consumedThisPeriod.value / s.usage.limit) * 100)}% of the allowance used this period.` });
    if (s.usage.forecast?.exceedsLimit) alerts.push({ level: 'warn', service: s.service, message: `${s.name}: forecast exceeds the allowance before renewal (estimate).` });
    if (s.syncRuns[0]?.status === 'error') alerts.push({ level: 'error', service: s.service, message: `${s.name} sync failed: ${s.syncRuns[0].error}` });
  }
  // Unusual API spend: a day above 3× the trailing 7-day average (and ≥ $1), from LIVE cost rows.
  const daily = (await db.prepare("SELECT service, paid_on AS day, SUM(amount) AS usd FROM billing_records WHERE record = 'api_billing' AND status = 'LIVE' AND currency = 'USD' GROUP BY service, paid_on ORDER BY paid_on").all()).results;
  for (const svc of Object.keys(SERVICES)) {
    const d = daily.filter((x) => x.service === svc);
    for (let i = 7; i < d.length; i++) {
      const avg = d.slice(i - 7, i).reduce((a, x) => a + x.usd, 0) / 7;
      if (d[i].usd >= 1 && avg > 0 && d[i].usd > 3 * avg) alerts.push({ level: 'warn', service: svc, message: `${SERVICES[svc].name} API spend on ${d[i].day} was $${d[i].usd.toFixed(2)} — over 3× the previous 7-day average.` });
    }
  }
  const sub = total((_, i) => subMonthly[i]);
  const api = total((_, i) => apiVerified[i]);
  return {
    generatedAt: nowIso(),
    services,
    totals: {
      subscriptionsMonthly: { ...sub, status: 'CALCULATED', note: 'From imported plan amounts; services without an imported amount are excluded and flagged partial.' },
      apiVerifiedMonth: { ...api, status: 'LIVE/IMPORTED', note: 'Provider-reported or imported API spend this month. Services without it are excluded (partial).' },
      ganeshaApiMonth: { ...total((_, i) => ganeshaOnly[i]), status: 'CALCULATED', note: 'Only GANESHA’s own calls. Shown separately — never added to account-wide API spend.' },
      aiTotalMonth: { inr: sub.inr === null && api.inr === null ? null : (sub.inr ?? 0) + (api.inr ?? 0), partial: sub.partial || api.partial, status: 'CALCULATED', note: 'Subscriptions (monthly equivalent) + verified API spend.' },
    },
    byProject,
    byTask,
    alerts,
    fx: settings.fx_usd_inr,
  };
}

/** Daily ledger: provider/imported rows and GANESHA's own calls, kept in separate lists. */
export async function dailyLedger(db, days = 31) {
  const since = new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
  const provider = (await db.prepare("SELECT * FROM usage_ledger WHERE (day >= ? OR (day = '' AND window_start >= ?)) ORDER BY day DESC, service, model, unit LIMIT 1000").bind(since, since).all()).results;
  const ganesha = (
    await db
      .prepare(`SELECT substr(created_at, 1, 10) AS day, provider, model, purpose, COUNT(*) AS calls, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens
                FROM provider_calls WHERE created_at >= ? AND status = 'success' GROUP BY day, provider, model, purpose ORDER BY day DESC`)
      .bind(`${since}T00:00:00Z`)
      .all()
  ).results;
  return { since, provider, ganesha, note: 'Provider rows show exactly what the provider (or your import) reported, at its own granularity. GANESHA rows are this studio’s calls only.' };
}
