// SOMA — brand analytics from real platform data.
// Sunverse: YouTube Data API v3 public statistics (channel totals + per-video views/likes/comments).
// Every number shown comes from the API response or is arithmetic on it. Metrics the
// public API does not provide (reach, impressions, watch time, CTR, retention) are listed
// as data gaps, never estimated. Each fetch is stored, so growth is measured, not guessed.
import { agentById } from './agents.mjs';
import { enginesFor } from './orchestrator.mjs';
import { callProvider } from './providers.mjs';
import { newId, nowIso } from './util.mjs';

export const BRAND_SOURCES = {
  sunverse: { platform: 'youtube', handle: '@SURVERSE_09' },
  littleloop: null, // no channel/account connected yet
  foliocraft: null, // no analytics source connected yet
};
const NOT_CONNECTED = {
  littleloop: 'No LittleLoop channel or account is connected yet. Instagram is on hold; share a YouTube channel handle to track it here.',
  foliocraft: 'No Foliocraft analytics source is connected yet (site visits, sign-ups and sales need a tracking source).',
};

const API = 'https://www.googleapis.com/youtube/v3';
const CACHE_MINUTES = 60; // a page view never triggers more than one fetch per hour
const CRON_REFRESH_HOURS = 6;
const INSIGHT_EVERY_HOURS = 20;
const MAX_VIDEOS = 200;

export const GAPS_YOUTUBE_PUBLIC = [
  'Reach, impressions, click-through rate, watch time, average view duration, audience retention and traffic sources need the channel owner to sign in (YouTube Analytics API). Not connected yet.',
  'Revenue and RPM need YouTube Partner Program data via the channel sign-in. Not connected yet.',
];

// Same DDL as migrations/0002_analytics.sql; idempotent, so the table exists even if the
// migration was not run by hand. Runs once per Worker instance.
let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS analytics_snapshots (id TEXT PRIMARY KEY, brand TEXT NOT NULL, source TEXT NOT NULL,
      account_ref TEXT NOT NULL, fetched_at TEXT NOT NULL, data_json TEXT NOT NULL, insights_json TEXT, insights_at TEXT)`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_analytics_brand ON analytics_snapshots(brand, fetched_at)'),
  ]);
  schemaReady = true;
}

const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

/** ISO 8601 duration (PT#H#M#S) → seconds. */
export function parseDuration(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso ?? '');
  if (!m) return null;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

async function yt(env, path, params, fetchImpl) {
  const url = `${API}/${path}?${new URLSearchParams(params)}`;
  // Key travels in a header, not the URL, so it never appears in logs.
  const res = await fetchImpl(url, { headers: { 'x-goog-api-key': env.YOUTUBE_API_KEY, accept: 'application/json' } });
  const text = await res.text();
  if (!res.ok) {
    let reason = '';
    try {
      reason = JSON.parse(text)?.error?.errors?.[0]?.reason ?? JSON.parse(text)?.error?.message ?? '';
    } catch {
      reason = text.slice(0, 200);
    }
    throw Object.assign(new Error(`YouTube API ${path} HTTP ${res.status}${reason ? ` (${reason})` : ''}`), { httpStatus: res.status });
  }
  return JSON.parse(text);
}

/** Fetches channel totals and every upload's public statistics (up to MAX_VIDEOS). */
export async function fetchYouTubeChannel(env, handle, fetchImpl = fetch) {
  const ch = await yt(env, 'channels', { part: 'snippet,statistics,contentDetails', forHandle: handle.replace(/^@/, '') }, fetchImpl);
  const c = ch.items?.[0];
  if (!c) throw new Error(`YouTube channel ${handle} not found`);
  const uploads = c.contentDetails?.relatedPlaylists?.uploads;

  const ids = [];
  let pageToken;
  while (uploads && ids.length < MAX_VIDEOS) {
    const pl = await yt(env, 'playlistItems', { part: 'contentDetails', playlistId: uploads, maxResults: '50', ...(pageToken ? { pageToken } : {}) }, fetchImpl);
    for (const it of pl.items ?? []) if (it.contentDetails?.videoId) ids.push(it.contentDetails.videoId);
    pageToken = pl.nextPageToken;
    if (!pageToken) break;
  }

  const videos = [];
  for (let i = 0; i < ids.length; i += 50) {
    const v = await yt(env, 'videos', { part: 'snippet,statistics,contentDetails', id: ids.slice(i, i + 50).join(',') }, fetchImpl);
    for (const x of v.items ?? []) {
      videos.push({
        id: x.id,
        title: x.snippet?.title ?? '(untitled)',
        publishedAt: x.snippet?.publishedAt ?? null,
        durationSec: parseDuration(x.contentDetails?.duration),
        views: num(x.statistics?.viewCount),
        likes: num(x.statistics?.likeCount), // null when the owner hides likes
        comments: num(x.statistics?.commentCount), // null when comments are off
        url: `https://www.youtube.com/watch?v=${x.id}`,
      });
    }
  }
  videos.sort((a, b) => Date.parse(b.publishedAt ?? 0) - Date.parse(a.publishedAt ?? 0));

  return {
    channel: {
      id: c.id,
      title: c.snippet?.title ?? handle,
      handle,
      url: `https://www.youtube.com/${handle}`,
      createdAt: c.snippet?.publishedAt ?? null,
      thumbnail: c.snippet?.thumbnails?.default?.url ?? null,
      subscribers: c.statistics?.hiddenSubscriberCount ? null : num(c.statistics?.subscriberCount),
      subscribersHidden: Boolean(c.statistics?.hiddenSubscriberCount),
      totalViews: num(c.statistics?.viewCount),
      videoCount: num(c.statistics?.videoCount),
    },
    videos,
    truncated: ids.length >= MAX_VIDEOS,
  };
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const ratio = (a, b) => (b > 0 ? a / b : null);

/** Pure arithmetic on fetched numbers. `prev` = an earlier snapshot for measured growth. */
export function summarize(data, prev = null, now = Date.now()) {
  const v = data.videos;
  const views = v.map((x) => x.views).filter((x) => x !== null);
  const withLikes = v.filter((x) => x.likes !== null && x.views !== null);
  const withComments = v.filter((x) => x.comments !== null && x.views !== null);
  const last30 = v.filter((x) => x.publishedAt && now - Date.parse(x.publishedAt) <= 30 * 86400_000);
  const short = v.filter((x) => x.durationSec !== null && x.durationSec <= 180);

  const s = {
    videosAnalysed: v.length,
    totalViewsOfVideos: sum(views),
    totalLikes: sum(withLikes.map((x) => x.likes)),
    totalComments: sum(withComments.map((x) => x.comments)),
    avgViewsPerVideo: views.length ? Math.round(sum(views) / views.length) : null,
    medianViewsPerVideo: median(views),
    likeRate: ratio(sum(withLikes.map((x) => x.likes)), sum(withLikes.map((x) => x.views))),
    commentRate: ratio(sum(withComments.map((x) => x.comments)), sum(withComments.map((x) => x.views))),
    last30Days: { uploads: last30.length, views: sum(last30.map((x) => x.views ?? 0)) },
    upTo3Min: { count: short.length, avgViews: short.length ? Math.round(sum(short.map((x) => x.views ?? 0)) / short.length) : null },
    over3Min: {
      count: v.length - short.length,
      avgViews: v.length - short.length ? Math.round(sum(v.filter((x) => !short.includes(x)).map((x) => x.views ?? 0)) / (v.length - short.length)) : null,
    },
    topVideos: [...v].filter((x) => x.views !== null).sort((a, b) => b.views - a.views).slice(0, 5).map((x) => x.id),
    likesHiddenOn: v.filter((x) => x.likes === null).length,
    latestUpload: v[0]?.publishedAt ?? null,
  };

  if (prev) {
    const hours = (Date.parse(data.fetchedAt) - Date.parse(prev.fetchedAt)) / 3_600_000;
    const d = (a, b) => (a !== null && b !== null && a !== undefined && b !== undefined ? a - b : null);
    s.growth = {
      since: prev.fetchedAt,
      hours: Math.round(hours),
      subscribers: d(data.channel.subscribers, prev.channel.subscribers),
      totalViews: d(data.channel.totalViews, prev.channel.totalViews),
      videoCount: d(data.channel.videoCount, prev.channel.videoCount),
    };
  }
  return s;
}

async function latestSnapshot(db, brand) {
  return db.prepare('SELECT * FROM analytics_snapshots WHERE brand = ? ORDER BY fetched_at DESC LIMIT 1').bind(brand).first();
}
/** Oldest snapshot at least `minHours` older than `beforeIso` — the baseline for measured growth. */
async function baselineSnapshot(db, brand, beforeIso, minHours = 20) {
  const cutoff = new Date(Date.parse(beforeIso) - minHours * 3_600_000).toISOString();
  return (
    (await db.prepare('SELECT * FROM analytics_snapshots WHERE brand = ? AND fetched_at <= ? ORDER BY fetched_at DESC LIMIT 1').bind(brand, cutoff).first()) ??
    null
  );
}
async function latestInsights(db, brand) {
  return db.prepare('SELECT insights_json, insights_at, fetched_at FROM analytics_snapshots WHERE brand = ? AND insights_json IS NOT NULL ORDER BY insights_at DESC LIMIT 1').bind(brand).first();
}

export async function refreshSnapshot(env, db, brand, deps = {}) {
  const src = BRAND_SOURCES[brand];
  const raw = await fetchYouTubeChannel(env, src.handle, deps.fetch ?? fetch);
  const fetchedAt = nowIso();
  const id = newId('an');
  await db
    .prepare('INSERT INTO analytics_snapshots (id, brand, source, account_ref, fetched_at, data_json) VALUES (?,?,?,?,?,?)')
    .bind(id, brand, 'youtube_data_api', src.handle, fetchedAt, JSON.stringify({ ...raw, fetchedAt }))
    .run();
  await db.prepare('INSERT INTO events (workflow_id, task_id, kind, message, created_at) VALUES (NULL, NULL, ?, ?, ?)')
    .bind('analytics_refresh', `SOMA fetched ${brand} YouTube stats: ${raw.videos.length} videos`, fetchedAt).run();
  return db.prepare('SELECT * FROM analytics_snapshots WHERE id = ?').bind(id).first();
}

/** SOMA writes a short analysis using ONLY the numbers in the snapshot summary. */
export async function generateInsights(env, db, row, summary, deps = {}) {
  const agent = agentById('ops_soma_analytics');
  const data = JSON.parse(row.data_json);
  const top = summary.topVideos.map((id) => data.videos.find((v) => v.id === id)).filter(Boolean);
  const facts = {
    channel: data.channel,
    fetchedAt: data.fetchedAt,
    summary,
    topVideos: top.map(({ title, views, likes, comments, publishedAt, durationSec }) => ({ title, views, likes, comments, publishedAt, durationSec })),
    recentVideos: data.videos.slice(0, 10).map(({ title, views, likes, comments, publishedAt, durationSec }) => ({ title, views, likes, comments, publishedAt, durationSec })),
    dataGaps: GAPS_YOUTUBE_PUBLIC,
  };
  const system = [
    `You are ${agent.name} (${agent.id}), ${agent.role} at Ganesha AI Studio.`,
    'You analyse the Sunverse YouTube music channel for its owner.',
    'Use ONLY numbers present in the provided data. Never estimate reach, impressions, watch time, CTR, retention or revenue — they are not in the data.',
    'Be specific and practical. Plain English, short sentences.',
  ].join('\n');
  const prompt = [
    'Channel data (from the YouTube Data API, public statistics):',
    JSON.stringify(facts, null, 2),
    'Return JSON: {"headline":string (<=140 chars),"working":[string],"notWorking":[string],"nextActions":[{"action":string,"why":string,"measureWith":string}],"dataGaps":[string]}',
    'working/notWorking: 2-4 items each, each citing a number from the data. nextActions: exactly 3.',
  ].join('\n\n');

  const errors = [];
  for (const provider of await enginesFor(db, env, agent)) {
    try {
      const r = await callProvider(env, db, provider, { system, prompt, json: true, maxTokens: 2000, purpose: 'analytics_insights' }, deps);
      const o = r.json;
      const ok = o && typeof o.headline === 'string' && Array.isArray(o.working) && Array.isArray(o.notWorking) && Array.isArray(o.nextActions) && o.nextActions.length > 0;
      if (!ok) throw new Error('SOMA output missing required fields');
      const insights = { ...o, provider: r.provider, model: r.model };
      const at = nowIso();
      await db.prepare('UPDATE analytics_snapshots SET insights_json = ?, insights_at = ? WHERE id = ?').bind(JSON.stringify(insights), at, row.id).run();
      return { ...insights, at };
    } catch (e) {
      errors.push(`${provider}: ${e.message}`);
    }
  }
  throw new Error(`SOMA could not write insights — ${errors.join(' | ')}`);
}

/** Report for the dashboard. Refreshes at most once per CACHE_MINUTES. */
export async function getReport(env, db, brand, { force = false, withInsights = false, forceInsights = false, deps = {} } = {}) {
  if (!(brand in BRAND_SOURCES)) return { brand, connected: false, reason: 'Unknown brand' };
  const src = BRAND_SOURCES[brand];
  if (!src) return { brand, connected: false, reason: NOT_CONNECTED[brand] };
  await ensureSchema(db);

  let row = await latestSnapshot(db, brand);
  let fetchError = null;
  const stale = !row || Date.now() - Date.parse(row.fetched_at) > CACHE_MINUTES * 60_000;
  if ((stale || force) && env.YOUTUBE_API_KEY) {
    try {
      row = await refreshSnapshot(env, db, brand, deps);
    } catch (e) {
      fetchError = e.message;
    }
  }
  if (!row) {
    return {
      brand,
      connected: false,
      source: 'YouTube Data API v3',
      account: src.handle,
      reason: env.YOUTUBE_API_KEY ? `Could not fetch the channel: ${fetchError}` : 'Waiting for the Worker secret YOUTUBE_API_KEY.',
    };
  }

  const data = JSON.parse(row.data_json);
  const base = await baselineSnapshot(db, brand, row.fetched_at);
  const summary = summarize(data, base ? JSON.parse(base.data_json) : null);

  let insights = null;
  let insightsError = null;
  const last = await latestInsights(db, brand);
  if (last) insights = { ...JSON.parse(last.insights_json), at: last.insights_at, basedOn: last.fetched_at };
  const due = !last || Date.now() - Date.parse(last.insights_at) > INSIGHT_EVERY_HOURS * 3_600_000;
  if (withInsights && (due || forceInsights)) {
    try {
      insights = { ...(await generateInsights(env, db, row, summary, deps)), basedOn: row.fetched_at };
    } catch (e) {
      insightsError = e.message;
    }
  }

  const gaps = [...GAPS_YOUTUBE_PUBLIC];
  if (data.channel.subscribersHidden) gaps.unshift('Subscriber count is hidden on this channel, so it cannot be reported.');
  if (summary.likesHiddenOn) gaps.push(`Likes are hidden on ${summary.likesHiddenOn} video(s); like rate uses the rest.`);
  if (data.truncated) gaps.push(`Only the latest ${MAX_VIDEOS} uploads were analysed.`);
  if (!summary.growth) gaps.push('Growth needs two fetches at least 20 hours apart; history starts with the first fetch.');

  return {
    brand,
    connected: true,
    source: 'YouTube Data API v3 (public statistics)',
    account: src.handle,
    fetchedAt: row.fetched_at,
    stale: Boolean(fetchError),
    fetchError,
    channel: data.channel,
    videos: data.videos,
    summary,
    insights,
    insightsError,
    dataGaps: gaps,
  };
}

/** Cron: refresh connected brands every few hours and let SOMA write a daily analysis. */
export async function scheduledAnalytics(env, db, deps = {}) {
  if (!env.YOUTUBE_API_KEY) return [];
  await ensureSchema(db);
  const out = [];
  for (const [brand, src] of Object.entries(BRAND_SOURCES)) {
    if (!src) continue;
    const row = await latestSnapshot(db, brand);
    const dataDue = !row || Date.now() - Date.parse(row.fetched_at) > CRON_REFRESH_HOURS * 3_600_000;
    const last = await latestInsights(db, brand);
    // Also run when fresh numbers exist but SOMA hasn't written today's analysis yet.
    const insightsDue = !last || Date.now() - Date.parse(last.insights_at) > INSIGHT_EVERY_HOURS * 3_600_000;
    if (!dataDue && !insightsDue) continue;
    try {
      const r = await getReport(env, db, brand, { force: dataDue, withInsights: true, deps });
      out.push(`${brand}: ${r.connected ? 'refreshed' : r.reason}${r.insightsError ? ` (insights: ${r.insightsError})` : ''}`);
    } catch (e) {
      out.push(`${brand}: ${e.message}`);
    }
  }
  return out;
}
