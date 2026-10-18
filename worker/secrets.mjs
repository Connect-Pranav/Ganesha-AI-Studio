// Settings → API keys: the owner can add keys from the app instead of the Cloudflare dashboard.
// Stored AES-GCM-encrypted in D1 (key derived from ADMIN_TOKEN). Worker secrets with the same name win.
// Values never go back to the browser — only "set" + last 4 characters.
import { HttpError, nowIso } from './util.mjs';

export const SECRET_NAMES = {
  GEMINI_API_KEY: 'Gemini (Google AI Studio) — chat, agents, scripts',
  OPENAI_API_KEY: 'ChatGPT (OpenAI API, paid per use) — enables ChatGPT in CBO chat',
  OPENAI_MODEL: 'ChatGPT model (optional, default gpt-5-mini)',
  ANTHROPIC_API_KEY: 'Claude API (paid per use) — optional agent engine',
  YOUTUBE_API_KEY: 'YouTube Data API — Sunverse analytics',
  IG_APP_ID: 'Instagram app ID (Meta app) — for Connect Instagram',
  IG_APP_SECRET: 'Instagram app secret (Meta app) — for Connect Instagram',
  IG_ACCESS_TOKEN: 'Instagram access token (only if you are not using Connect Instagram)',
};
const NOT_SECRET = new Set(['OPENAI_MODEL', 'IG_APP_ID']);
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function key(env) {
  if (!env.ADMIN_TOKEN) throw new HttpError(503, 'ADMIN_TOKEN is not set');
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`ganesha-settings:${env.ADMIN_TOKEN}`));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

let cache = { at: 0, values: null };
export function resetSecretsCache() {
  cache = { at: 0, values: null };
}

async function loadAll(env, db) {
  if (cache.values && Date.now() - cache.at < 60_000) return cache.values;
  const rows = (await db.prepare('SELECT * FROM app_secrets').all()).results;
  const k = rows.length ? await key(env) : null;
  const values = {};
  for (const r of rows) {
    try {
      values[r.name] = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(r.iv) }, k, unb64(r.enc)));
    } catch {
      /* written with a different ADMIN_TOKEN — ignored until re-entered */
    }
  }
  cache = { at: Date.now(), values };
  return values;
}

/** env copy with app-entered keys filled in where the Worker has none. */
export async function withSecrets(env, db) {
  if (!db || !env.ADMIN_TOKEN) return env;
  let vals;
  try {
    vals = await loadAll(env, db);
  } catch {
    return env;
  }
  const out = { ...env };
  for (const [n, v] of Object.entries(vals)) if (!env[n] && v) out[n] = v;
  return out;
}

export async function list(env, db) {
  const rows = new Map((await db.prepare('SELECT name, last4, updated_at FROM app_secrets').all()).results.map((r) => [r.name, r]));
  return Object.entries(SECRET_NAMES).map(([name, purpose]) => {
    const r = rows.get(name);
    return {
      name,
      purpose,
      secret: !NOT_SECRET.has(name),
      source: env[name] ? 'worker' : r ? 'app' : null,
      hint: env[name] ? 'set in Cloudflare' : r ? (NOT_SECRET.has(name) ? r.last4 : `••••${r.last4 ?? ''}`) : null,
      updatedAt: r?.updated_at ?? null,
    };
  });
}

export async function save(env, db, { name, value }) {
  if (!(name in SECRET_NAMES)) throw new HttpError(400, 'Unknown setting');
  if (value === null || value === '') {
    await db.prepare('DELETE FROM app_secrets WHERE name = ?').bind(name).run();
    resetSecretsCache();
    return { removed: true };
  }
  if (typeof value !== 'string' || value.trim().length < 2 || value.length > 4000) throw new HttpError(400, 'Value must be text (2–4000 chars)');
  const v = value.trim();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(env), new TextEncoder().encode(v));
  const last4 = NOT_SECRET.has(name) ? v.slice(0, 40) : v.slice(-4);
  await db
    .prepare('INSERT INTO app_secrets (name, enc, iv, last4, updated_at) VALUES (?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET enc = excluded.enc, iv = excluded.iv, last4 = excluded.last4, updated_at = excluded.updated_at')
    .bind(name, b64(enc), b64(iv), last4, nowIso())
    .run();
  await db.prepare('INSERT INTO events (workflow_id, task_id, kind, message, created_at) VALUES (NULL,NULL,?,?,?)').bind('settings_changed', `Setting ${name} saved from the app`, nowIso()).run();
  resetSecretsCache();
  return { saved: true };
}
