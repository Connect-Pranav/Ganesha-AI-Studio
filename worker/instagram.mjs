// Instagram connection for LittleLoop (@little_loop09): one-tap "Connect Instagram" (OAuth with the
// Instagram API with Instagram Login), token kept encrypted in D1 and refreshed before it expires.
// A manually set Worker secret IG_ACCESS_TOKEN still wins if present.
import { HttpError, nowIso } from './util.mjs';

const SCOPES = ['instagram_business_basic', 'instagram_business_content_publish', 'instagram_business_manage_insights'];
const STATE_TTL_MS = 15 * 60_000;
const REFRESH_BEFORE_MS = 10 * 86400_000;
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const graph = (env) => `https://${env.IG_GRAPH_HOST || 'graph.instagram.com'}`;
const publicBase = (env) => String(env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
export const redirectUri = (env) => `${publicBase(env)}/ig/callback`;
export const appConfigured = (env) => Boolean(env.IG_APP_ID && env.IG_APP_SECRET);

async function key(env) {
  if (!env.IG_APP_SECRET) throw new HttpError(503, 'IG_APP_SECRET is not set');
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`ganesha-ig:${env.IG_APP_SECRET}`));
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

/** The token to use: Worker secret first, else the connected (stored) token. */
export async function igToken(env, db) {
  if (env.IG_ACCESS_TOKEN) return env.IG_ACCESS_TOKEN;
  if (!db || !env.IG_APP_SECRET) return null;
  const row = await db.prepare('SELECT * FROM ig_auth WHERE id = 1').first();
  if (!row) return null;
  try {
    return await open(env, row);
  } catch {
    return null;
  }
}
/** env copy with IG_ACCESS_TOKEN filled from the stored connection, for code that reads env. */
export async function withIg(env, db) {
  const t = await igToken(env, db).catch(() => null);
  return t && !env.IG_ACCESS_TOKEN ? { ...env, IG_ACCESS_TOKEN: t } : env;
}

export async function status(env, db) {
  const row = await db.prepare('SELECT ig_user_id, username, expires_at, refreshed_at, created_at FROM ig_auth WHERE id = 1').first();
  return {
    connected: Boolean(env.IG_ACCESS_TOKEN || row),
    via: env.IG_ACCESS_TOKEN ? 'worker_secret' : row ? 'connect_button' : null,
    username: row?.username ?? null,
    expiresAt: row?.expires_at ?? null,
    appConfigured: appConfigured(env),
    redirectUri: redirectUri(env),
    scopes: SCOPES,
  };
}

/** Step 1 (owner, admin): authorize URL with a one-time state. */
export async function startConnect(env, db) {
  if (!appConfigured(env)) throw new HttpError(409, 'Set the Worker secrets IG_APP_ID and IG_APP_SECRET (from your Meta app → Instagram → API setup with Instagram login) first.');
  const state = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  await db.prepare('DELETE FROM ig_oauth_state WHERE created_at < ?').bind(new Date(Date.now() - STATE_TTL_MS).toISOString()).run();
  await db.prepare('INSERT INTO ig_oauth_state (state, created_at) VALUES (?, ?)').bind(state, nowIso()).run();
  const u = new URL('https://www.instagram.com/oauth/authorize');
  u.searchParams.set('client_id', env.IG_APP_ID);
  u.searchParams.set('redirect_uri', redirectUri(env));
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPES.join(','));
  u.searchParams.set('state', state);
  u.searchParams.set('enable_fb_login', '0');
  return { url: u.toString() };
}

async function jsonOrThrow(res, what, secret) {
  const text = await res.text();
  let body = {};
  try { body = JSON.parse(text); } catch { /* raw */ }
  if (!res.ok || body.error || body.error_type) throw new Error(`${what}: ${String(body.error?.message ?? body.error_message ?? text.slice(0, 200)).split(secret || '\u0000').join('[redacted]')}`);
  return body;
}

/** Step 2 (Instagram redirects here): code → short token → long-lived token → stored encrypted. */
export async function finishConnect(env, db, url, deps = {}) {
  const fetchImpl = deps.fetch ?? fetch;
  const state = url.searchParams.get('state') ?? '';
  const row = await db.prepare('SELECT created_at FROM ig_oauth_state WHERE state = ?').bind(state).first();
  if (!row || Date.now() - Date.parse(row.created_at) > STATE_TTL_MS) throw new HttpError(400, 'This Instagram connect link expired. Start again from the studio.');
  await db.prepare('DELETE FROM ig_oauth_state WHERE state = ?').bind(state).run();
  if (url.searchParams.get('error')) throw new HttpError(400, `Instagram: ${url.searchParams.get('error_description') ?? url.searchParams.get('error')}`);
  const code = (url.searchParams.get('code') ?? '').replace(/#_$/, '');
  if (!code) throw new HttpError(400, 'Instagram did not return a code');
  const form = new URLSearchParams({ client_id: env.IG_APP_ID, client_secret: env.IG_APP_SECRET, grant_type: 'authorization_code', redirect_uri: redirectUri(env), code });
  const short = await jsonOrThrow(await fetchImpl('https://api.instagram.com/oauth/access_token', { method: 'POST', body: form }), 'Token exchange', env.IG_APP_SECRET);
  const shortToken = short.access_token ?? short.data?.[0]?.access_token;
  if (!shortToken) throw new Error('Token exchange returned no token');
  const ll = new URL(`${graph(env)}/access_token`);
  ll.searchParams.set('grant_type', 'ig_exchange_token');
  ll.searchParams.set('client_secret', env.IG_APP_SECRET);
  ll.searchParams.set('access_token', shortToken);
  const long = await jsonOrThrow(await fetchImpl(ll), 'Long-lived token', env.IG_APP_SECRET);
  const me = new URL(`${graph(env)}/${env.IG_GRAPH_VERSION || 'v24.0'}/me`);
  me.searchParams.set('fields', 'user_id,username');
  me.searchParams.set('access_token', long.access_token);
  const who = await jsonOrThrow(await fetchImpl(me), 'Profile', long.access_token);
  const sealed = await seal(env, long.access_token);
  const now = nowIso();
  const expires = long.expires_in ? new Date(Date.now() + Number(long.expires_in) * 1000).toISOString() : null;
  await db
    .prepare(`INSERT INTO ig_auth (id, token_enc, iv, ig_user_id, username, expires_at, refreshed_at, created_at) VALUES (1,?,?,?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET token_enc = excluded.token_enc, iv = excluded.iv, ig_user_id = excluded.ig_user_id, username = excluded.username, expires_at = excluded.expires_at, refreshed_at = excluded.refreshed_at`)
    .bind(sealed.token_enc, sealed.iv, String(who.user_id ?? who.id ?? ''), who.username ?? null, expires, now, now)
    .run();
  await db.prepare('INSERT INTO events (workflow_id, task_id, kind, message, created_at) VALUES (NULL,NULL,?,?,?)').bind('instagram_connected', `Instagram connected: @${who.username ?? '?'}`, now).run();
  return { username: who.username ?? null, expiresAt: expires };
}

/** Cron: refresh the stored long-lived token when it has under 10 days left. */
export async function refreshIfDue(env, db, deps = {}) {
  if (env.IG_ACCESS_TOKEN || !env.IG_APP_SECRET) return null;
  const row = await db.prepare('SELECT * FROM ig_auth WHERE id = 1').first();
  if (!row || (row.expires_at && Date.parse(row.expires_at) - Date.now() > REFRESH_BEFORE_MS)) return null;
  const token = await open(env, row);
  const u = new URL(`${graph(env)}/refresh_access_token`);
  u.searchParams.set('grant_type', 'ig_refresh_token');
  u.searchParams.set('access_token', token);
  const r = await jsonOrThrow(await (deps.fetch ?? fetch)(u), 'Refresh', token);
  const sealed = await seal(env, r.access_token);
  const expires = r.expires_in ? new Date(Date.now() + Number(r.expires_in) * 1000).toISOString() : null;
  await db.prepare('UPDATE ig_auth SET token_enc = ?, iv = ?, expires_at = ?, refreshed_at = ? WHERE id = 1').bind(sealed.token_enc, sealed.iv, expires, nowIso()).run();
  return { refreshed: true, expiresAt: expires };
}

export async function disconnect(db) {
  await db.prepare('DELETE FROM ig_auth').run();
}

export function callbackPage(ok, message) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Instagram · Ganesha</title>
<body style="font-family:system-ui;background:#05081a;color:#e8e9ff;display:grid;place-items:center;min-height:100vh;margin:0">
<div style="max-width:420px;padding:24px;text-align:center"><h2>${ok ? '✅ Instagram connected' : '⚠️ Instagram not connected'}</h2><p>${esc(message)}</p>
<p><a style="color:#a78bfa" href="/#/littleloop">Back to Ganesha</a></p></div>${ok ? '<script>setTimeout(function(){location.href="/#/littleloop"},2500)</script>' : ''}</body>`,
    { status: ok ? 200 : 400, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  );
}
