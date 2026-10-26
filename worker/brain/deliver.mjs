// Ganesha Brain — free connectors that receive a finished mission's result.
// Only destinations the owner ticked when approving the mission are used. Nothing here publishes to
// the public: the vault repo is private, Drive/Notion/Slack are the owner's own workspace.
//   github → a Markdown file in the private vault repo (GITHUB_TOKEN, GITHUB_VAULT_REPO)
//   drive  → the owner's own Apps Script web app saves a Doc/file in Drive (DRIVE_WEBHOOK_URL)
//   notion → a child page under one shared page (NOTION_TOKEN, NOTION_PAGE_ID)
//   slack  → a summary message to an incoming webhook (SLACK_WEBHOOK_URL)
import { newId, nowIso } from '../util.mjs';

export const TARGETS = {
  github: { name: 'GitHub vault', needs: ['GITHUB_TOKEN'] },
  drive: { name: 'Google Drive', needs: ['DRIVE_WEBHOOK_URL'] },
  notion: { name: 'Notion', needs: ['NOTION_TOKEN', 'NOTION_PAGE_ID'] },
  slack: { name: 'Slack', needs: ['SLACK_WEBHOOK_URL'] },
};
const DEFAULT_VAULT = 'Connect-Pranav/Ganesha-AI-Vault';
const UA = 'ganesha-ai-studio';

export function connectorStatus(env) {
  return Object.entries(TARGETS).map(([id, t]) => {
    const missing = t.needs.filter((n) => !env[n]);
    return { id, name: t.name, configured: missing.length === 0, missing, detail: id === 'github' ? `repo ${env.GITHUB_VAULT_REPO || DEFAULT_VAULT}` : null };
  });
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'mission';
const b64utf8 = (s) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const redact = (t, env) => {
  let s = String(t ?? '');
  for (const k of ['GITHUB_TOKEN', 'NOTION_TOKEN', 'SLACK_WEBHOOK_URL', 'DRIVE_WEBHOOK_URL', 'DRIVE_WEBHOOK_SECRET']) if (env[k]) s = s.split(env[k]).join('[redacted]');
  return s.slice(0, 300);
};

async function timed(fetchImpl, url, init, ms = 30_000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetchImpl(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** Markdown document for a mission (goal, plan, each step's output, final result). */
export function missionDoc(m, steps) {
  const lines = [`# ${m.goal.split('\n')[0].slice(0, 120)}`, '', `Brand: ${m.brand} · Mission ${m.id} · finished ${m.finished_at ?? nowIso()}`, '', '## Result', '', m.result ?? '', '', '## Steps'];
  for (const s of steps) lines.push('', `### ${s.idx + 1}. ${s.title} — ${s.agent_id}`, '', s.output ?? '(no output)');
  return lines.join('\n');
}

async function toGithub(env, m, doc, f) {
  const repo = env.GITHUB_VAULT_REPO || DEFAULT_VAULT;
  const path = `missions/${(m.finished_at ?? nowIso()).slice(0, 10)}-${slug(m.goal)}-${m.id.slice(-6)}.md`;
  const res = await timed(f, `https://api.github.com/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'user-agent': UA, 'content-type': 'application/json', 'x-github-api-version': '2022-11-28' },
    body: JSON.stringify({ message: `brain: mission ${m.id}`, content: b64utf8(doc) }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GitHub HTTP ${res.status}: ${body.message ?? ''}`);
  return { url: body.content?.html_url ?? null, message: `Saved ${path} in ${repo}` };
}

async function toDrive(env, m, doc, f) {
  const res = await timed(f, env.DRIVE_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'content-type': 'text/plain;charset=utf-8' }, // Apps Script reads e.postData.contents; text/plain avoids a CORS preflight
    body: JSON.stringify({ secret: env.DRIVE_WEBHOOK_SECRET ?? '', folder: `Ganesha Missions/${m.brand}`, filename: `${(m.finished_at ?? nowIso()).slice(0, 10)} ${m.goal.slice(0, 60)}`, content: doc }),
    redirect: 'follow',
  });
  const text = await res.text();
  let body = {};
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Drive script did not return JSON (HTTP ${res.status}). Check the web app is deployed for "Anyone".`);
  }
  if (!res.ok || body.ok !== true) throw new Error(`Drive script: ${body.error ?? `HTTP ${res.status}`}`);
  return { url: body.url ?? null, message: 'Saved to Google Drive' };
}

function notionBlocks(doc) {
  const blocks = [];
  for (const para of doc.split(/\n{2,}/)) {
    const p = para.trim();
    if (!p) continue;
    const h = /^(#{1,3})\s+(.*)$/.exec(p);
    if (h && !p.includes('\n')) {
      const type = `heading_${h[1].length}`;
      blocks.push({ object: 'block', type, [type]: { rich_text: [{ type: 'text', text: { content: h[2].slice(0, 1900) } }] } });
      continue;
    }
    for (let i = 0; i < p.length; i += 1900) blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: p.slice(i, i + 1900) } }] } });
  }
  return blocks.slice(0, 95);
}

async function toNotion(env, m, doc, f) {
  const res = await timed(f, 'https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.NOTION_TOKEN}`, 'notion-version': '2022-06-28', 'content-type': 'application/json' },
    body: JSON.stringify({
      parent: { page_id: env.NOTION_PAGE_ID.replace(/-/g, '') },
      properties: { title: { title: [{ type: 'text', text: { content: `${m.brand}: ${m.goal.slice(0, 120)}` } }] } },
      children: notionBlocks(doc),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Notion HTTP ${res.status}: ${body.message ?? ''}`);
  return { url: body.url ?? null, message: 'Notion page created' };
}

async function toSlack(env, m, _doc, f, links) {
  const extra = links.length ? `\n${links.map((l) => `• ${l.target}: ${l.url}`).join('\n')}` : '';
  const res = await timed(f, env.SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: `🐘 *Ganesha mission done* (${m.brand})\n*${m.goal.slice(0, 200)}*\n\n${String(m.result ?? '').slice(0, 2500)}${extra}` }),
  });
  if (!res.ok) throw new Error(`Slack HTTP ${res.status}: ${(await res.text()).slice(0, 100)}`);
  return { url: null, message: 'Posted to Slack' };
}

const SENDERS = { github: toGithub, drive: toDrive, notion: toNotion, slack: toSlack };

/** Delivers to each chosen target (Slack last so it can link the others). Records every outcome. */
export async function deliverMission(env, db, m, steps, targets, deps = {}) {
  const f = deps.fetch ?? fetch;
  const doc = missionDoc(m, steps);
  const order = [...targets.filter((t) => t !== 'slack'), ...targets.filter((t) => t === 'slack')];
  const out = [];
  for (const t of order) {
    if (!SENDERS[t]) continue;
    const missing = TARGETS[t].needs.filter((n) => !env[n]);
    let rec;
    if (missing.length) rec = { target: t, status: 'skipped', url: null, message: `Not connected: set ${missing.join(', ')} in Settings → API keys` };
    else {
      try {
        const r = await SENDERS[t](env, m, doc, f, out.filter((x) => x.url));
        rec = { target: t, status: 'sent', url: r.url, message: r.message };
      } catch (e) {
        rec = { target: t, status: 'failed', url: null, message: redact(e.name === 'AbortError' ? 'timed out' : e.message, env) };
      }
    }
    out.push(rec);
    await db
      .prepare('INSERT INTO mission_deliveries (id, mission_id, target, status, url, message, created_at) VALUES (?,?,?,?,?,?,?)')
      .bind(newId('dl'), m.id, rec.target, rec.status, rec.url, rec.message, nowIso())
      .run();
  }
  return out;
}

/** Live check for one connector without sending real content (GitHub/Notion read calls; Slack/Drive send a ping). */
export async function testConnector(env, id, deps = {}) {
  const f = deps.fetch ?? fetch;
  const t = TARGETS[id];
  if (!t) return { id, ok: false, message: 'Unknown connector' };
  const missing = t.needs.filter((n) => !env[n]);
  if (missing.length) return { id, ok: false, message: `Set ${missing.join(', ')} in Settings → API keys` };
  try {
    if (id === 'github') {
      const repo = env.GITHUB_VAULT_REPO || DEFAULT_VAULT;
      const r = await timed(f, `https://api.github.com/repos/${repo}`, { headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'user-agent': UA } });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) return { id, ok: false, message: `GitHub HTTP ${r.status}: ${b.message ?? ''}` };
      return { id, ok: Boolean(b.permissions?.push), message: b.permissions?.push ? `Can write to ${repo}${b.private ? ' (private)' : ' — warning: repo is PUBLIC'}` : `Token cannot write to ${repo} (needs Contents: read and write)` };
    }
    if (id === 'notion') {
      const r = await timed(f, `https://api.notion.com/v1/pages/${env.NOTION_PAGE_ID.replace(/-/g, '')}`, { headers: { authorization: `Bearer ${env.NOTION_TOKEN}`, 'notion-version': '2022-06-28' } });
      const b = await r.json().catch(() => ({}));
      return r.ok ? { id, ok: true, message: 'Parent page reachable' } : { id, ok: false, message: `Notion HTTP ${r.status}: ${b.message ?? ''} (share the page with your integration)` };
    }
    if (id === 'slack') {
      const r = await timed(f, env.SLACK_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '🐘 Ganesha Brain connected. Mission summaries will arrive here.' }) });
      return r.ok ? { id, ok: true, message: 'Test message posted' } : { id, ok: false, message: `Slack HTTP ${r.status}` };
    }
    const r = await timed(f, env.DRIVE_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ secret: env.DRIVE_WEBHOOK_SECRET ?? '', ping: true }), redirect: 'follow' });
    const b = await r.json().catch(() => ({}));
    return b.ok === true ? { id, ok: true, message: 'Drive script answered' } : { id, ok: false, message: `Drive script: ${b.error ?? `HTTP ${r.status}, not JSON`}` };
  } catch (e) {
    return { id, ok: false, message: redact(e.name === 'AbortError' ? 'timed out' : e.message, env) };
  }
}
