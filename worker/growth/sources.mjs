// Free lead sources for MUSHAK (no paid scrapers):
//   • YouTube Data API channel search (YOUTUBE_API_KEY, free quota) — creators/artists for Sunverse and LittleLoop
//   • Website reader — a lead's own public site (home, /contact, /about): generic business mailbox,
//     official social links, title/description. Honours robots.txt, 8 s per page, ≤ 3 pages, ≤ 400 KB each.
// Not used on purpose: logging in to, or scraping, Instagram/LinkedIn/Facebook (their terms forbid it)
// and personal email addresses (only generic role mailboxes such as hello@ / partnerships@ are kept).
import { isRoleEmail, normDomain } from './core.mjs';

const YT = 'https://www.googleapis.com/youtube/v3';
const UA = 'GaneshaStudioBot/1.0 (+lead research; respects robots.txt)';

async function ytGet(env, path, params, fetchImpl) {
  const res = await fetchImpl(`${YT}/${path}?${new URLSearchParams(params)}`, { headers: { 'x-goog-api-key': env.YOUTUBE_API_KEY, accept: 'application/json' } });
  const text = await res.text();
  if (!res.ok) {
    let reason = '';
    try {
      reason = JSON.parse(text)?.error?.errors?.[0]?.reason ?? '';
    } catch {
      /* raw */
    }
    throw new Error(`YouTube API ${path} HTTP ${res.status}${reason ? ` (${reason})` : ''}`);
  }
  return JSON.parse(text);
}

/** Channels matching a query, with subscriber counts. Costs ~101 of the 10,000 free daily quota units. */
export async function youtubeChannels(env, query, { max = 8, regionCode = 'IN' } = {}, deps = {}) {
  if (!env.YOUTUBE_API_KEY) throw new Error('YOUTUBE_API_KEY is not set (Settings → API keys → Platforms)');
  const fetchImpl = deps.fetch ?? fetch;
  const s = await ytGet(env, 'search', { part: 'snippet', type: 'channel', q: query, maxResults: String(Math.min(25, max * 2)), regionCode, relevanceLanguage: 'en' }, fetchImpl);
  const ids = (s.items ?? []).map((i) => i.id?.channelId ?? i.snippet?.channelId).filter(Boolean);
  if (!ids.length) return [];
  const c = await ytGet(env, 'channels', { part: 'snippet,statistics', id: ids.join(',') }, fetchImpl);
  return (c.items ?? [])
    .map((ch) => ({
      id: ch.id,
      name: ch.snippet?.title ?? '',
      handle: ch.snippet?.customUrl ?? null,
      url: ch.snippet?.customUrl ? `https://www.youtube.com/${ch.snippet.customUrl}` : `https://www.youtube.com/channel/${ch.id}`,
      description: String(ch.snippet?.description ?? '').slice(0, 400),
      country: ch.snippet?.country ?? null,
      subscribers: ch.statistics?.hiddenSubscriberCount ? null : Number(ch.statistics?.subscriberCount ?? 0),
      videos: Number(ch.statistics?.videoCount ?? 0),
      views: Number(ch.statistics?.viewCount ?? 0),
    }))
    .filter((x) => x.name && x.videos > 0)
    .slice(0, max);
}

/* ---------------- website reader ---------------- */
function robotsAllows(txt, path) {
  let applies = false;
  const rules = [];
  for (const raw of String(txt).split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const k = m[1].toLowerCase();
    const v = m[2].trim();
    if (k === 'user-agent') applies = v === '*' || /ganesha/i.test(v);
    else if (applies && (k === 'disallow' || k === 'allow') && v) rules.push({ allow: k === 'allow', p: v });
  }
  const hit = rules.filter((r) => path.startsWith(r.p.replace(/\*.*$/, ''))).sort((a, b) => b.p.length - a.p.length)[0];
  return !hit || hit.allow;
}

async function getText(url, fetchImpl, ms = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetchImpl(url, { headers: { 'user-agent': UA, accept: 'text/html,text/plain;q=0.9' }, redirect: 'follow', signal: ctl.signal });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (type && !/text|html|xml/i.test(type)) return null;
    return (await res.text()).slice(0, 400_000);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const SOCIAL = /https?:\/\/(?:www\.)?(instagram\.com|youtube\.com|linkedin\.com|x\.com|twitter\.com|facebook\.com|threads\.net)\/[A-Za-z0-9_.\-@/]+/gi;

/** Public business contact facts from a lead's own website. Never throws; returns null when nothing usable. */
export async function readSite(url, deps = {}) {
  const fetchImpl = deps.fetch ?? fetch;
  const host = normDomain(url);
  if (!host) return null;
  const origin = `https://${host}`;
  const robots = (await getText(`${origin}/robots.txt`, fetchImpl, 5000)) ?? '';
  const pages = ['/', '/contact', '/about'].filter((p) => robotsAllows(robots, p));
  const emails = new Set();
  const socials = new Set();
  let title = null;
  let description = null;
  const read = [];
  for (const p of pages) {
    const html = await getText(`${origin}${p}`, fetchImpl);
    if (!html) continue;
    read.push(`${origin}${p}`);
    if (!title) title = /<title[^>]*>([^<]{1,160})<\/title>/i.exec(html)?.[1]?.trim() ?? null;
    if (!description) description = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,300})/i.exec(html)?.[1]?.trim() ?? null;
    for (const m of html.matchAll(/(?:mailto:)?([A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)) {
      const e = m[1].toLowerCase();
      if (isRoleEmail(e) && (e.endsWith(`@${host}`) || e.split('@')[1].endsWith(host.split('.').slice(-2).join('.')))) emails.add(e);
    }
    for (const m of html.matchAll(SOCIAL)) socials.add(m[0].replace(/[/"'.]+$/, ''));
  }
  if (!read.length) return robots && !pages.length ? { blocked: true, read: [] } : null;
  return { read, title, description, emails: [...emails].slice(0, 3), socials: [...socials].slice(0, 6), blocked: false };
}
