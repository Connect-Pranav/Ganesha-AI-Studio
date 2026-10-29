// YouTube Analytics for Sunverse (@SURVERSE_09): watch time is private channel data, so it needs the
// channel owner's one-time Google sign-in (OAuth, scope yt-analytics.readonly). Only the refresh token
// is kept, AES-GCM encrypted in D1. Every watch-time number comes from the YouTube Analytics API;
// nothing is estimated here. Owner-only routes; the public analytics report never includes it.
import { HttpError, nowIso } from './util.mjs';

const SCOPES = ['https://www.googleapis.com/auth/yt-analytics.readonly', 'https://www.googleapis.com/auth/youtube.readonly'];
const STATE_TTL_MS = 15 * 60_000;
const CACHE_MS = 3 * 3_600_000;
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REPORTS = 'https://youtubeanalytics.googleapis.com/v2/reports';
const DATA_API = 'https://www.googleapis.com/youtube/v3';
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const publicBase = (env) => String(env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
export const redirectUri = (env) => `${publicBase(env)}/yt/callback`;
export const appConfigured = (env) => Boolean(env.YT_CLIENT_ID && env.YT_CLIENT_SECRET);
const MISSING = (env) => ['YT_CLIENT_ID', 'YT_CLIENT_SECRET'].filter((k) => !env[k]);

/**
 * YouTube Partner Program bars for a new applicant on a given day.
 * Ad revenue tier: 1,000 subs + 4,000 long-form public watch hours (12 months) or 10M Shorts views (90 days);
 * from 1 Feb 2027 new applicants need 8,000 hours or 20M Shorts views.
 * Fan funding tier: 500 subs + 3 public uploads (90 days) + 3,000 hours (12 months) or 3M Shorts views (90 days).
 * `hours` / `subscribers` stay at the ad revenue bar for older callers.
 */
export function yppTarget(today = new Date()) {
  const after = today.getTime() >= Date.UTC(2027, 1, 1);
  const ads = after
    ? { id: 'ads', label: 'Ad revenue', subscribers: 1000, hours: 8000, shortsViews90: 20_000_000, uploads90: null }
    : { id: 'ads', label: 'Ad revenue', subscribers: 1000, hours: 4000, shortsViews90: 10_000_000, uploads90: null };
  const fan = { id: 'fan', label: 'Fan funding', subscribers: 500, hours: 3000, shortsViews90: 3_000_000, uploads90: 3 };
  return after
    ? { hours: ads.hours, subscribers: ads.subscribers, from: '2027-02-01', tiers: [fan, ads], note: 'New applicants from 1 Feb 2027: 1,000 subscribers + 8,000 public watch hours in 365 days (or 20M Shorts views in 90 days).' }
    : { hours: ads.hours, subscribers: ads.subscribers, until: '2027-01-31', tiers: [fan, ads], note: 'Until 31 Jan 2027: 1,000 subscribers + 4,000 public watch hours in 365 days (or 10M Shorts views in 90 days). From 1 Feb 2027 new applicants need 8,000 hours or 20M Shorts views.' };
}

async function key(env) {
  if (!env.YT_CLIENT_SECRET) throw new HttpError(503, 'YT_CLIENT_SECRET is not set');
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`ganesha-yt:${env.YT_CLIENT_SECRET}`));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(env, token) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(env), new TextEncoder().encode(token));
  return { token_enc: b64(ct), iv: b64(iv) };
}
async function open(env, row) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(row.iv) }, await key(env), unb64(row.token_enc));
  return new TextDecoder().decode(pt);
}

async function jsonOrThrow(res, what, secrets = []) {
  const text = await res.text();
  let body = {};
  try {
    body = JSON.parse(text);
  } catch {
    /* raw */
  }
  if (!res.ok || body.error) {
    let msg = String(body.error_description ?? body.error?.message ?? (typeof body.error === 'string' ? body.error : '') ?? '') || text.slice(0, 200);
    for (const s of secrets) if (s) msg = msg.split(s).join('[redacted]');
    const e = new Error(`${what}: ${msg}`);
    e.code = typeof body.error === 'string' ? body.error : body.error?.status;
    throw e;
  }
  return body;
}

export async function status(env, db) {
  const row = await db.prepare('SELECT * FROM yt_auth WHERE id = 1').first();
  let problem = null;
  if (row) {
    if (!env.YT_CLIENT_SECRET) problem = 'YT_CLIENT_SECRET is missing, so the saved YouTube connection cannot be used. Add it again in Settings, then reconnect.';
    else if (!(await open(env, row).then(() => true, () => false))) problem = 'YT_CLIENT_SECRET changed since YouTube was connected. Tap Connect YouTube Analytics again.';
  }
  return {
    connected: Boolean(row && !problem),
    problem,
    channelId: row?.channel_id ?? null,
    channelTitle: row?.channel_title ?? null,
    connectedAt: row?.created_at ?? null,
    appConfigured: appConfigured(env),
    missing: MISSING(env),
    redirectUri: redirectUri(env),
  };
}

export async function startConnect(env, db) {
  if (!appConfigured(env)) throw new HttpError(409, `Save ${MISSING(env).join(' and ')} in Settings first (Google Cloud → APIs & Services → Credentials → OAuth client, type Web application).`);
  if (!publicBase(env)) throw new HttpError(503, 'PUBLIC_BASE_URL is not set on the Worker');
  const state = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  await db.prepare('DELETE FROM yt_oauth_state WHERE created_at < ?').bind(new Date(Date.now() - STATE_TTL_MS).toISOString()).run();
  await db.prepare('INSERT INTO yt_oauth_state (state, created_at) VALUES (?, ?)').bind(state, nowIso()).run();
  const u = new URL(AUTH_URL);
  u.searchParams.set('client_id', env.YT_CLIENT_ID);
  u.searchParams.set('redirect_uri', redirectUri(env));
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPES.join(' '));
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('include_granted_scopes', 'true');
  u.searchParams.set('state', state);
  return { url: u.toString() };
}

async function channelOf(accessToken, fetchImpl) {
  const u = new URL(`${DATA_API}/channels`);
  u.searchParams.set('part', 'snippet');
  u.searchParams.set('mine', 'true');
  const body = await jsonOrThrow(await fetchImpl(u, { headers: { authorization: `Bearer ${accessToken}` } }), 'Channel lookup', [accessToken]);
  const ch = body.items?.[0];
  if (!ch) throw new HttpError(400, 'This Google account has no YouTube channel. Sign in with the account that owns @SURVERSE_09 (pick the channel if Google asks).');
  return { id: ch.id, title: ch.snippet?.title ?? null, publishedAt: ch.snippet?.publishedAt ?? null };
}

/** Google redirects here with ?code — exchange it for a refresh token and store it encrypted. */
export async function finishConnect(env, db, url, deps = {}) {
  const fetchImpl = deps.fetch ?? fetch;
  const state = url.searchParams.get('state') ?? '';
  const row = await db.prepare('SELECT created_at FROM yt_oauth_state WHERE state = ?').bind(state).first();
  if (!row || Date.now() - Date.parse(row.created_at) > STATE_TTL_MS) throw new HttpError(400, 'This YouTube connect link expired. Start again from the studio.');
  await db.prepare('DELETE FROM yt_oauth_state WHERE state = ?').bind(state).run();
  if (url.searchParams.get('error')) throw new HttpError(400, `Google: ${url.searchParams.get('error')}`);
  const code = url.searchParams.get('code') ?? '';
  if (!code) throw new HttpError(400, 'Google did not return a code');
  const granted = (url.searchParams.get('scope') ?? '').split(' ');
  if (granted.length > 1 && !granted.includes(SCOPES[0])) throw new HttpError(400, 'YouTube Analytics permission was not allowed. Connect again and tick the YouTube Analytics box.');
  const form = new URLSearchParams({ client_id: env.YT_CLIENT_ID, client_secret: env.YT_CLIENT_SECRET, grant_type: 'authorization_code', redirect_uri: redirectUri(env), code });
  const tok = await jsonOrThrow(await fetchImpl(TOKEN_URL, { method: 'POST', body: form }), 'Token exchange', [env.YT_CLIENT_SECRET]);
  if (!tok.refresh_token) throw new HttpError(400, 'Google returned no refresh token. Remove Ganesha from myaccount.google.com → Security → Third-party access, then connect again.');
  const ch = await channelOf(tok.access_token, fetchImpl);
  const sealed = await seal(env, tok.refresh_token);
  const now = nowIso();
  await db
    .prepare(`INSERT INTO yt_auth (id, token_enc, iv, channel_id, channel_title, created_at, refreshed_at) VALUES (1,?,?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET token_enc = excluded.token_enc, iv = excluded.iv, channel_id = excluded.channel_id, channel_title = excluded.channel_title, created_at = excluded.created_at, refreshed_at = excluded.refreshed_at`)
    .bind(sealed.token_enc, sealed.iv, ch.id, ch.title, now, now)
    .run();
  await db.prepare('DELETE FROM yt_watch_cache').run();
  await db.prepare('INSERT INTO events (workflow_id, task_id, kind, message, created_at) VALUES (NULL,NULL,?,?,?)').bind('youtube_analytics_connected', `YouTube Analytics connected: ${ch.title ?? ch.id}`, now).run();
  return { channelTitle: ch.title, channelId: ch.id };
}

async function accessToken(env, db, fetchImpl) {
  const row = await db.prepare('SELECT * FROM yt_auth WHERE id = 1').first();
  if (!row) throw new HttpError(409, 'YouTube Analytics is not connected');
  const refresh = await open(env, row);
  const form = new URLSearchParams({ client_id: env.YT_CLIENT_ID, client_secret: env.YT_CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: refresh });
  try {
    const tok = await jsonOrThrow(await fetchImpl(TOKEN_URL, { method: 'POST', body: form }), 'Token refresh', [env.YT_CLIENT_SECRET, refresh]);
    await db.prepare('UPDATE yt_auth SET refreshed_at = ? WHERE id = 1').bind(nowIso()).run();
    return { token: tok.access_token, row };
  } catch (e) {
    if (e.code === 'invalid_grant') throw new HttpError(409, 'The YouTube sign-in expired or was removed. Tap Connect YouTube Analytics again. (If this repeats every 7 days, set the Google OAuth app to "In production".)');
    throw e;
  }
}

const ymd = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n, from = new Date()) => new Date(from.getTime() - n * 86400_000);

async function report(fetchImpl, token, params) {
  const u = new URL(REPORTS);
  u.searchParams.set('ids', 'channel==MINE');
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const body = await jsonOrThrow(await fetchImpl(u, { headers: { authorization: `Bearer ${token}` } }), 'YouTube Analytics', [token]);
  const cols = (body.columnHeaders ?? []).map((c) => c.name);
  return (body.rows ?? []).map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
}

const METRICS = 'views,estimatedMinutesWatched,averageViewDuration';
const total = (rows) => {
  const r = rows[0];
  if (!r) return { views: 0, watchHours: 0, avgViewSeconds: null };
  return { views: r.views ?? 0, watchHours: Math.round(((r.estimatedMinutesWatched ?? 0) / 60) * 10) / 10, avgViewSeconds: r.averageViewDuration ?? null };
};

/** Watch time report (owner-only). Cached for 3 hours unless forced. */
export async function watchTime(env, db, { force = false, deps = {} } = {}) {
  const st = await status(env, db);
  if (!st.connected) return { connected: false, ...st, ypp: yppTarget() };
  if (!force) {
    const c = await db.prepare('SELECT * FROM yt_watch_cache WHERE id = 1').first();
    if (c && Date.now() - Date.parse(c.fetched_at) < CACHE_MS) return { ...JSON.parse(c.data_json), cached: true };
  }
  const fetchImpl = deps.fetch ?? fetch;
  const { token } = await accessToken(env, db, fetchImpl);
  const ch = await channelOf(token, fetchImpl);
  const now = deps.now ?? new Date();
  const end = ymd(now);
  const start = ch.publishedAt ? ch.publishedAt.slice(0, 10) : '2005-02-14';
  const [life, y365, d28, daily] = await Promise.all([
    report(fetchImpl, token, { startDate: start, endDate: end, metrics: METRICS }),
    report(fetchImpl, token, { startDate: ymd(daysAgo(365, now)), endDate: end, metrics: METRICS }),
    report(fetchImpl, token, { startDate: ymd(daysAgo(28, now)), endDate: end, metrics: METRICS }),
    report(fetchImpl, token, { startDate: ymd(daysAgo(28, now)), endDate: end, metrics: 'views,estimatedMinutesWatched', dimensions: 'day', sort: 'day' }),
  ]);
  // Split by content type: YPP counts long-form watch hours (Shorts excluded) and Shorts views separately.
  // Optional: if YouTube refuses the breakdown, the totals above still stand and the split shows as unavailable.
  let split = null;
  try {
    const [byType365, byType90] = await Promise.all([
      report(fetchImpl, token, { startDate: ymd(daysAgo(365, now)), endDate: end, metrics: 'views,estimatedMinutesWatched', dimensions: 'creatorContentType' }),
      report(fetchImpl, token, { startDate: ymd(daysAgo(90, now)), endDate: end, metrics: 'views,estimatedMinutesWatched', dimensions: 'creatorContentType' }),
    ]);
    const isShorts = (r) => String(r.creatorContentType ?? '').toUpperCase() === 'SHORTS';
    const longMin = byType365.filter((r) => !isShorts(r)).reduce((a, r) => a + (r.estimatedMinutesWatched ?? 0), 0);
    split = {
      longFormWatchHours365: Math.round((longMin / 60) * 10) / 10,
      shortsViews90: byType90.filter(isShorts).reduce((a, r) => a + (r.views ?? 0), 0),
    };
  } catch (e) {
    split = { error: e instanceof Error ? e.message : String(e) };
  }
  const out = {
    connected: true,
    split,
    channelId: ch.id,
    channelTitle: ch.title,
    fetchedAt: nowIso(),
    lifetime: total(life),
    last365: total(y365),
    last28: total(d28),
    daily: daily.map((r) => ({ day: r.day, views: r.views ?? 0, watchHours: Math.round(((r.estimatedMinutesWatched ?? 0) / 60) * 100) / 100 })),
    ypp: yppTarget(now),
    source: 'YouTube Analytics API (estimatedMinutesWatched)',
    notes: [
      'YouTube Analytics data is usually 2–3 days behind.',
      'YouTube counts only valid public long-form watch hours for the Partner Program, so YouTube Studio may show a lower eligible number than total watch time.',
    ],
  };
  await db.prepare('INSERT INTO yt_watch_cache (id, data_json, fetched_at) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, fetched_at = excluded.fetched_at').bind(JSON.stringify(out), out.fetchedAt).run();
  await recordSnapshot(db, out, ymd(now));
  return out;
}

/* ---------- Monetization tracker: daily progress history + owner-confirmed core requirements ---------- */
const HISTORY_KEY = 'ypp_history';
const CHECKLIST_KEY = 'ypp_checklist';
const HISTORY_MAX = 400;
/** Requirements YouTube does not expose through an API; the owner confirms them in YouTube Studio. */
export const CORE_CHECKS = [
  { id: 'policies', label: 'Follows YouTube channel monetization policies and Community Guidelines' },
  { id: 'location', label: 'Lives in a country where YPP is available (India)' },
  { id: 'strikes', label: 'No active Community Guidelines strikes' },
  { id: 'twosv', label: '2-Step Verification on the Google account' },
  { id: 'advanced', label: 'Advanced features enabled on YouTube' },
  { id: 'adsense', label: 'AdSense for YouTube account linked (or ready to link)' },
];

async function readSetting(db, key, fallback) {
  const r = await db.prepare('SELECT value_json FROM studio_settings WHERE key = ?').bind(key).first();
  if (!r) return fallback;
  try {
    return JSON.parse(r.value_json);
  } catch {
    return fallback;
  }
}
const writeSetting = (db, key, value) =>
  db.prepare('INSERT INTO studio_settings (key, value_json, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at').bind(key, JSON.stringify(value), nowIso()).run();

/** One entry per UTC day (the latest fetch of the day wins), measured numbers only. */
export async function recordSnapshot(db, report, day = String(report?.fetchedAt ?? nowIso()).slice(0, 10)) {
  if (!report?.connected || !report.last365) return;
  const split = report.split && !report.split.error ? report.split : null;
  const entry = {
    day,
    totalHours365: report.last365.watchHours,
    longFormHours365: split?.longFormWatchHours365 ?? null,
    shortsViews90: split?.shortsViews90 ?? null,
  };
  const hist = (await readSetting(db, HISTORY_KEY, [])).filter((h) => h && h.day !== day);
  hist.push(entry);
  hist.sort((a, b) => a.day.localeCompare(b.day));
  await writeSetting(db, HISTORY_KEY, hist.slice(-HISTORY_MAX));
}

/** Cron: make sure today has a snapshot (uses the 3-hour cache, so at most one Google fetch). */
export async function trackDaily(env, db, deps = {}) {
  const st = await status(env, db);
  if (!st.connected) return { skipped: 'not connected' };
  const today = (deps.now ?? new Date()).toISOString().slice(0, 10);
  const hist = await readSetting(db, HISTORY_KEY, []);
  if (hist.some((h) => h.day === today)) return { skipped: 'already tracked today' };
  const r = await watchTime(env, db, { deps });
  if (r.cached) await recordSnapshot(db, r, today);
  return { tracked: today };
}

export async function tracker(db) {
  const saved = await readSetting(db, CHECKLIST_KEY, {});
  return {
    checklist: CORE_CHECKS.map((c) => ({ ...c, done: Boolean(saved[c.id]?.done), updatedAt: saved[c.id]?.updatedAt ?? null })),
    history: await readSetting(db, HISTORY_KEY, []),
    ypp: yppTarget(),
  };
}

export async function setCheck(db, body) {
  const id = String(body?.id ?? '');
  if (!CORE_CHECKS.some((c) => c.id === id)) throw new HttpError(400, `Unknown requirement "${id}". Use one of: ${CORE_CHECKS.map((c) => c.id).join(', ')}`);
  if (typeof body.done !== 'boolean') throw new HttpError(400, '"done" must be true or false');
  const saved = await readSetting(db, CHECKLIST_KEY, {});
  saved[id] = { done: body.done, updatedAt: nowIso() };
  await writeSetting(db, CHECKLIST_KEY, saved);
  return tracker(db);
}

export async function disconnect(db) {
  await db.prepare('DELETE FROM yt_auth').run();
  await db.prepare('DELETE FROM yt_watch_cache').run();
}

export function callbackPage(ok, message) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>YouTube · Ganesha</title>
<body style="font-family:system-ui;background:#070c2b;color:#f4f6ff;display:grid;place-items:center;min-height:100vh;margin:0">
<div style="max-width:440px;padding:24px;text-align:center"><h2>${ok ? '✅ YouTube Analytics connected' : '⚠️ YouTube Analytics not connected'}</h2><p>${esc(message)}</p>
<p><a style="color:#7aa2ff" href="/#/sunverse">Back to Sunverse</a></p></div>${ok ? '<script>setTimeout(function(){location.href="/#/sunverse"},2500)</script>' : ''}</body>`,
    { status: ok ? 200 : 400, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  );
}
