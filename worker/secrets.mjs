// Settings → API keys: the owner can add keys from the app instead of the Cloudflare dashboard.
// Stored AES-GCM-encrypted in D1 (key derived from ADMIN_TOKEN). Worker secrets with the same name win.
// Values never go back to the browser — only "set" + last 4 characters.
import { HttpError, nowIso } from './util.mjs';

export const SECRET_NAMES = {
  GEMINI_API_KEY: 'Gemini (Google AI Studio) — chat, agents, scripts',
  OPENAI_API_KEY: 'OpenAI API key (paid per use) — ChatGPT in CBO chat, optional agent / LittleLoop script engine',
  OPENAI_MODEL: 'OpenAI model ID (optional, default gpt-6-luna — checked by Test)',
  OPENAI_MAX_OUTPUT_TOKENS: 'OpenAI max output tokens per request, reasoning included (optional, default 8192)',
  OPENAI_DAILY_REQUEST_LIMIT: 'OpenAI requests allowed per day (optional, default 200)',
  ANTHROPIC_API_KEY: 'Claude API (paid per use) — optional agent engine',
  YOUTUBE_API_KEY: 'YouTube Data API — Sunverse analytics',
  IG_APP_ID: 'Instagram app ID — Meta app → Instagram → API setup with Instagram login (NOT the Meta/Facebook app ID at the top of the dashboard)',
  IG_APP_SECRET: 'Instagram app secret — same page, click Show (32 letters/numbers)',
  IG_ACCESS_TOKEN: 'Optional — leave empty. Only for a manually generated token instead of Connect Instagram',
  YT_CLIENT_ID: 'Google OAuth client ID (Web application) — Sunverse watch time via YouTube Analytics',
  YT_CLIENT_SECRET: 'Google OAuth client secret — same OAuth client',
  GROQ_API_KEY: 'Groq API key (free tier, console.groq.com) — fast second free engine for chat, missions and checks',
  GROQ_MODEL: 'Groq model ID (optional, default llama-3.3-70b-versatile)',
  GITHUB_TOKEN: 'GitHub fine-grained token (free) with Contents read/write on the vault repo — Brain saves mission results there',
  GITHUB_VAULT_REPO: 'Vault repo for mission results (optional, default Connect-Pranav/Ganesha-AI-Vault)',
  DRIVE_WEBHOOK_URL: 'Google Drive: your free Apps Script web-app URL (see docs/BRAIN.md) — Brain saves mission results to Drive',
  DRIVE_WEBHOOK_SECRET: 'Google Drive: shared secret you also put in the Apps Script (optional but recommended)',
  NOTION_TOKEN: 'Notion internal integration secret (free) — Brain writes mission results as pages',
  NOTION_PAGE_ID: 'Notion parent page ID shared with the integration (32 hex characters from the page link)',
  SLACK_WEBHOOK_URL: 'Slack incoming webhook URL (free) — mission summaries and approval reminders',
};
const NOT_SECRET = new Set(['OPENAI_MODEL', 'OPENAI_MAX_OUTPUT_TOKENS', 'OPENAI_DAILY_REQUEST_LIMIT', 'IG_APP_ID', 'YT_CLIENT_ID', 'GROQ_MODEL', 'GITHUB_VAULT_REPO', 'NOTION_PAGE_ID']);
// Obvious placeholders are refused so a working key is never replaced by "YOUR_KEY_HERE" or "sk-...".
const PLACEHOLDER = /^(your|xxx+|placeholder|example|changeme|null|undefined)\b|<[^>]*>|\.{3}|\*{3}|YOUR_|_HERE$/i;
const intIn = (min, max) => (v) => (/^\d+$/.test(v) && Number(v) >= min && Number(v) <= max ? null : `must be a whole number ${min}–${max}`);
const VALIDATE = {
  OPENAI_API_KEY: (v) => (/^sk-[A-Za-z0-9_-]{20,}$/.test(v) ? null : 'does not look like an OpenAI API key (starts with "sk-", no spaces)'),
  OPENAI_MODEL: (v) => (/^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$/.test(v) ? null : 'must be a model ID such as gpt-6-luna'),
  OPENAI_MAX_OUTPUT_TOKENS: intIn(256, 64000),
  OPENAI_DAILY_REQUEST_LIMIT: intIn(1, 10000),
  IG_APP_ID: (v) => (/^\d{10,20}$/.test(v) ? null : 'must be the numeric Instagram app ID (digits only)'),
  IG_APP_SECRET: (v) => (/^[a-f0-9]{32}$/i.test(v) ? null : 'does not look like an Instagram app secret (32 letters/numbers, no spaces)'),
  YT_CLIENT_ID: (v) => (/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(v) ? null : 'must look like 1234-abc.apps.googleusercontent.com'),
  YT_CLIENT_SECRET: (v) => (/^[A-Za-z0-9_-]{20,64}$/.test(v) ? null : 'does not look like a Google OAuth client secret (no spaces)'),
  GROQ_API_KEY: (v) => (/^gsk_[A-Za-z0-9]{20,}$/.test(v) ? null : 'does not look like a Groq API key (starts with "gsk_", no spaces)'),
  GROQ_MODEL: (v) => (/^[A-Za-z0-9][A-Za-z0-9._:\/-]{1,79}$/.test(v) ? null : 'must be a Groq model ID such as llama-3.3-70b-versatile'),
  GITHUB_TOKEN: (v) => (/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(v) ? null : 'does not look like a GitHub token (starts with "github_pat_" or "ghp_")'),
  GITHUB_VAULT_REPO: (v) => (/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(v) ? null : 'must be owner/repo'),
  DRIVE_WEBHOOK_URL: (v) => (/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(v) ? null : 'must be an Apps Script web-app URL ending in /exec'),
  NOTION_TOKEN: (v) => (/^(ntn_|secret_)[A-Za-z0-9]{20,}$/.test(v) ? null : 'does not look like a Notion integration secret (starts with "ntn_" or "secret_")'),
  NOTION_PAGE_ID: (v) => (/^[a-f0-9]{32}$/i.test(v.replace(/-/g, '')) ? null : 'must be the 32-character page ID from the Notion page link'),
  SLACK_WEBHOOK_URL: (v) => (/^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/.test(v) ? null : 'must be a Slack incoming webhook URL (https://hooks.slack.com/services/...)'),
  IG_ACCESS_TOKEN: (v) => (/^[A-Za-z0-9_.|-]{40,}$/.test(v) ? null : 'does not look like an Instagram access token (long, no spaces)'),
};
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
  // A Worker secret always wins; saving here would silently do nothing, so refuse clearly.
  if (env[name]) throw new HttpError(409, `${name} is set as a Cloudflare Worker secret, which takes priority. Change it in Cloudflare.`);
  // Removing needs an explicit null (the Remove button); an empty box never wipes a saved key.
  if (value === '' || (typeof value === 'string' && !value.trim())) throw new HttpError(400, 'Empty value — nothing saved. Use Remove to delete a setting.');
  if (value === null) {
    await db.prepare('DELETE FROM app_secrets WHERE name = ?').bind(name).run();
    resetSecretsCache();
    return { removed: true };
  }
  if (typeof value !== 'string' || value.trim().length < 2 || value.length > 4000) throw new HttpError(400, 'Value must be text (2–4000 chars)');
  const v = value.trim();
  // Browsers love to autofill the saved studio password into key boxes; never store that as a key.
  if (env.ADMIN_TOKEN && v === String(env.ADMIN_TOKEN).trim()) throw new HttpError(400, `${name}: this is your studio admin password (probably browser autofill), not the ${name}. Nothing saved.`);
  if (PLACEHOLDER.test(v)) throw new HttpError(400, `${name}: that looks like a placeholder, not a real value. Nothing saved.`);
  const bad = VALIDATE[name]?.(v);
  if (bad) throw new HttpError(400, `${name} ${bad}. Nothing saved.`);
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
