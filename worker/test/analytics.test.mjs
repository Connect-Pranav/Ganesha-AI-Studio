// SOMA analytics tests on local D1 with a MOCKED YouTube API and provider (no network).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDb, disposeDb, resetDb, noSleep } from './helpers.mjs';
import { getReport, summarize, parseDuration, scheduledAnalytics, fetchInstagram } from '../analytics.mjs';
import worker from '../index.mjs';

let db;
before(async () => {
  db = await getDb();
});
after(disposeDb);
beforeEach(() => resetDb(db));

const DAY = 86400_000;
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Fake YouTube Data API + Gemini. `subs` lets a test change the channel between fetches. */
function fakeApis(state = {}) {
  const calls = [];
  const videos = [
    { id: 'v1', title: 'Monsoon lofi', publishedAt: iso(2 * DAY), duration: 'PT2M30S', views: '1200', likes: '90', comments: '12' },
    { id: 'v2', title: 'Night drive', publishedAt: iso(20 * DAY), duration: 'PT3M45S', views: '300', likes: '10', comments: '1' },
    { id: 'v3', title: 'First song', publishedAt: iso(90 * DAY), duration: 'PT4M', views: '50', comments: '0' }, // likes hidden
  ];
  const fn = async (url, init) => {
    calls.push(url);
    if (url.includes('generativelanguage')) {
      const text = JSON.stringify({ headline: 'Short music clips get 4x the views', working: ['Monsoon lofi: 1,200 views'], notWorking: ['First song: 50 views'], nextActions: [{ action: 'Post 2 clips a week', why: 'up-to-3-min avg higher', measureWith: 'avg views' }], dataGaps: [] });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: {} }), { status: 200 });
    }
    assert.equal(init.headers['x-goog-api-key'], 'yt-key', 'key sent in header');
    assert.ok(!url.includes('yt-key'), 'key never in URL');
    if (state.fail) return new Response(JSON.stringify({ error: { errors: [{ reason: 'quotaExceeded' }] } }), { status: 403 });
    const u = new URL(url);
    if (u.pathname.endsWith('/channels')) {
      assert.equal(u.searchParams.get('forHandle'), 'SURVERSE_09');
      return Response.json({ items: [{ id: 'UC1', snippet: { title: 'SURVERSE', publishedAt: '2026-01-01T00:00:00Z' }, statistics: { subscriberCount: String(state.subs ?? 100), viewCount: String(state.views ?? 1550), videoCount: '3', hiddenSubscriberCount: false }, contentDetails: { relatedPlaylists: { uploads: 'UU1' } } }] });
    }
    if (u.pathname.endsWith('/playlistItems')) return Response.json({ items: videos.map((v) => ({ contentDetails: { videoId: v.id } })) });
    if (u.pathname.endsWith('/videos'))
      return Response.json({
        items: videos.map((v) => ({ id: v.id, snippet: { title: v.title, publishedAt: v.publishedAt }, contentDetails: { duration: v.duration }, statistics: { viewCount: v.views, likeCount: v.likes, commentCount: v.comments } })),
      });
    throw new Error(`unexpected ${url}`);
  };
  fn.calls = calls;
  return fn;
}
const ENV = { YOUTUBE_API_KEY: 'yt-key', GEMINI_API_KEY: 'g', PRIMARY_ENGINE: 'gemini' };

test('parseDuration handles YouTube ISO durations', () => {
  assert.equal(parseDuration('PT2M30S'), 150);
  assert.equal(parseDuration('PT1H2M3S'), 3723);
  assert.equal(parseDuration('P1DT1S'), 86401);
  assert.equal(parseDuration('bad'), null);
});

test('report: real numbers only; hidden likes reported as a gap, not zero', async () => {
  const fetch = fakeApis();
  const r = await getReport(ENV, db, 'sunverse', { deps: { fetch, sleep: noSleep } });
  assert.equal(r.connected, true);
  assert.equal(r.channel.subscribers, 100);
  assert.equal(r.channel.videoCount, 3);
  assert.equal(r.summary.videosAnalysed, 3);
  assert.equal(r.summary.totalViewsOfVideos, 1550);
  assert.equal(r.summary.avgViewsPerVideo, 517);
  assert.equal(r.summary.medianViewsPerVideo, 300);
  assert.equal(r.summary.likesHiddenOn, 1);
  assert.equal(r.summary.likeRate, 100 / 1500, 'like rate excludes the video with hidden likes');
  assert.deepEqual(r.summary.last30Days, { uploads: 2, views: 1500 });
  assert.deepEqual(r.summary.upTo3Min, { count: 1, avgViews: 1200 });
  assert.deepEqual(r.summary.topVideos, ['v1', 'v2', 'v3']);
  assert.equal(r.videos.find((v) => v.id === 'v3').likes, null);
  assert.ok(r.dataGaps.some((g) => /impressions/.test(g)));
  assert.ok(r.dataGaps.some((g) => /Likes are hidden on 1/.test(g)));
  assert.equal(r.summary.growth, undefined, 'no growth from a single fetch');
  assert.equal(r.insights, null, 'public read never calls the AI provider');
  assert.ok(!fetch.calls.some((u) => u.includes('generativelanguage')));
});

test('cache: a second read within the hour does not call YouTube again', async () => {
  const fetch = fakeApis();
  await getReport(ENV, db, 'sunverse', { deps: { fetch } });
  const n = fetch.calls.length;
  await getReport(ENV, db, 'sunverse', { deps: { fetch } });
  assert.equal(fetch.calls.length, n);
});

test('growth is measured between two real fetches >= 20h apart', async () => {
  await getReport(ENV, db, 'sunverse', { deps: { fetch: fakeApis({ subs: 100, views: 1550 }) } });
  await db.prepare("UPDATE analytics_snapshots SET fetched_at = ?, data_json = json_set(data_json, '$.fetchedAt', ?)").bind(iso(DAY), iso(DAY)).run();
  const r = await getReport(ENV, db, 'sunverse', { force: true, deps: { fetch: fakeApis({ subs: 112, views: 1700 }) } });
  assert.equal(r.summary.growth.subscribers, 12);
  assert.equal(r.summary.growth.totalViews, 150);
  assert.equal(r.summary.growth.videoCount, 0);
  assert.ok(r.summary.growth.hours >= 23);
});

test('SOMA insights via Gemini are stored and returned; scheduled pass refreshes', async () => {
  const fetch = fakeApis();
  const out = await scheduledAnalytics(ENV, db, { fetch, sleep: noSleep });
  assert.deepEqual(out, ['sunverse: refreshed']);
  const r = await getReport(ENV, db, 'sunverse', { deps: { fetch } });
  assert.equal(r.insights.headline, 'Short music clips get 4x the views');
  assert.equal(r.insights.provider, 'gemini');
  assert.equal((await scheduledAnalytics(ENV, db, { fetch })).length, 0, 'not due again within 6h');
});

test('cron writes SOMA analysis for fresh data that has none yet, without refetching', async () => {
  const fetch = fakeApis();
  await getReport(ENV, db, 'sunverse', { deps: { fetch } }); // public view: data only
  const ytCalls = fetch.calls.filter((u) => u.includes('googleapis.com/youtube')).length;
  assert.deepEqual(await scheduledAnalytics(ENV, db, { fetch, sleep: noSleep }), ['sunverse: refreshed']);
  assert.equal(fetch.calls.filter((u) => u.includes('googleapis.com/youtube')).length, ytCalls, 'no extra YouTube fetch');
  assert.ok((await getReport(ENV, db, 'sunverse', { deps: { fetch } })).insights.headline);
});

test('SOMA failure is stored and shown on the public report', async () => {
  const fetch = fakeApis();
  const bad = async (url, init) => (url.includes('generativelanguage') ? new Response('{"error":{"message":"quota"}}', { status: 400 }) : fetch(url, init));
  await scheduledAnalytics(ENV, db, { fetch: bad, sleep: noSleep });
  const r = await getReport(ENV, db, 'sunverse', { deps: { fetch } });
  assert.equal(r.insights, null);
  assert.match(r.insightsError, /SOMA analysis failed for sunverse: .*gemini HTTP 400/);
});

test('no key / API error / unconnected brand are reported honestly', async () => {
  const noKey = await getReport({}, db, 'sunverse');
  assert.equal(noKey.connected, false);
  assert.match(noKey.reason, /YOUTUBE_API_KEY/);
  const err = await getReport(ENV, db, 'sunverse', { deps: { fetch: fakeApis({ fail: true }) } });
  assert.equal(err.connected, false);
  assert.match(err.reason, /quotaExceeded/);
  const ll = await getReport(ENV, db, 'littleloop');
  assert.equal(ll.connected, false);
  assert.equal(ll.platform, 'instagram');
  assert.match(ll.reason, /IG_ACCESS_TOKEN/);
});

test('LittleLoop Instagram: followers + per-post insights from the Instagram API (mocked)', async () => {
  const calls = [];
  const fakeIg = async (url) => {
    const u = new URL(url);
    calls.push(u.pathname);
    assert.equal(u.searchParams.get('access_token'), 'IGT');
    if (u.pathname.endsWith('/me')) return Response.json({ id: '17', username: 'little_loop09', followers_count: 120, follows_count: 3, media_count: 2 });
    if (u.pathname.endsWith('/me/media')) return Response.json({ data: [
      { id: 'm1', caption: 'Chiku puddle jump\n#kids', media_type: 'VIDEO', media_product_type: 'REELS', permalink: 'https://www.instagram.com/reel/a/', timestamp: '2026-10-17T05:00:00+0000', like_count: 30, comments_count: 4 },
      { id: 'm2', caption: 'Hello', media_type: 'IMAGE', permalink: 'https://www.instagram.com/p/b/', timestamp: '2026-10-10T05:00:00+0000', like_count: 5, comments_count: 0 },
    ] });
    if (u.pathname.endsWith('/m1/insights')) return Response.json({ data: [{ name: 'views', total_value: { value: 900 } }, { name: 'reach', values: [{ value: 700 }] }, { name: 'saved', values: [{ value: 12 }] }, { name: 'shares', values: [{ value: 3 }] }] });
    if (u.pathname.endsWith('/m2/insights')) return Response.json({ error: { message: 'unsupported' } }, { status: 400 });
    throw new Error(`unexpected ${u}`);
  };
  const r = await getReport({ IG_ACCESS_TOKEN: 'IGT' }, db, 'littleloop', { force: true, deps: { fetch: fakeIg } });
  assert.equal(r.connected, true);
  assert.equal(r.platform, 'instagram');
  assert.equal(r.channel.subscribers, 120);
  assert.equal(r.channel.handle, '@little_loop09');
  assert.equal(r.videos[0].title, 'Chiku puddle jump');
  assert.equal(r.videos[0].views, 900);
  assert.equal(r.videos[0].saves, 12);
  assert.equal(r.videos[1].views, null, 'missing insight stays unknown, never guessed');
  assert.equal(r.summary.totalLikes, 30, 'like totals only count posts that have views');
});

test('LittleLoop Instagram: follows media pagination; expired token gives a reconnect message without leaking it', async () => {
  const pages = [];
  const fakeIg = async (url) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/me')) return Response.json({ id: '17', username: 'little_loop09', followers_count: 1, media_count: 3 });
    if (u.pathname.endsWith('/me/media')) {
      pages.push(u.searchParams.get('after'));
      return u.searchParams.get('after') === 'C1'
        ? Response.json({ data: [{ id: 'p3', media_type: 'IMAGE', timestamp: '2026-10-01T00:00:00+0000' }], paging: { cursors: { after: 'C2' } } })
        : Response.json({ data: [{ id: 'p1', media_type: 'IMAGE' }, { id: 'p2', media_type: 'IMAGE' }], paging: { cursors: { after: 'C1' }, next: 'https://graph.instagram.com/next' } });
    }
    if (u.pathname.endsWith('/insights')) return Response.json({ data: [] });
    throw new Error(`unexpected ${u}`);
  };
  const r = await getReport({ IG_ACCESS_TOKEN: 'IGT' }, db, 'littleloop', { force: true, deps: { fetch: fakeIg } });
  assert.deepEqual(pages, [null, 'C1']);
  assert.deepEqual(r.videos.map((v) => v.id), ['p1', 'p2', 'p3']);
  const expired = async () => Response.json({ error: { message: 'Error validating access token: Session has expired IGT-SECRET', code: 190 } }, { status: 400 });
  await assert.rejects(fetchInstagram({ IG_ACCESS_TOKEN: 'IGT-SECRET' }, expired), (e) => /Connect Instagram again/.test(e.message) && !e.message.includes('IGT-SECRET') && e.igCode === 190);
});

test('summarize: pure arithmetic, no invented values for empty channels', () => {
  const s = summarize({ fetchedAt: iso(0), channel: {}, videos: [] });
  assert.equal(s.avgViewsPerVideo, null);
  assert.equal(s.likeRate, null);
  assert.equal(s.videosAnalysed, 0);
});

test('http: analytics GET is public with CORS for the Pages mirror; refresh needs admin', async () => {
  const env = { DB: db, ASSETS: { fetch: async () => new Response('x') } };
  const ctx = { waitUntil: () => {} };
  const res = await worker.fetch(new Request('https://g.test/api/analytics/littleloop', { headers: { origin: 'https://connect-pranav.github.io' } }), env, ctx);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://connect-pranav.github.io');
  const other = await worker.fetch(new Request('https://g.test/api/analytics/littleloop', { headers: { origin: 'https://evil.example' } }), env, ctx);
  assert.equal(other.headers.get('access-control-allow-origin'), null);
  assert.equal((await worker.fetch(new Request('https://g.test/api/analytics/nope'), env, ctx)).status, 404);
  assert.equal((await worker.fetch(new Request('https://g.test/api/analytics/sunverse/refresh', { method: 'POST' }), env, ctx)).status, 503);
});
