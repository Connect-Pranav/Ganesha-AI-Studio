// YouTube Analytics (Sunverse watch time) on a real local D1; every Google endpoint is MOCKED.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getBindings, disposeDb, resetDb } from './helpers.mjs';
import * as yt from '../ytanalytics.mjs';
import worker from '../index.mjs';

let db;
before(async () => ({ DB: db } = await getBindings()));
after(disposeDb);
beforeEach(() => resetDb(db));
const ENV = { YT_CLIENT_ID: '1234-abc.apps.googleusercontent.com', YT_CLIENT_SECRET: 'GOCSPX-secretvalue1234567', PUBLIC_BASE_URL: 'https://studio.example' };

const google = (calls = []) => async (url, init) => {
  const s = String(url);
  calls.push(s);
  if (s === 'https://oauth2.googleapis.com/token') {
    const g = init.body.get('grant_type');
    if (g === 'authorization_code') return Response.json({ access_token: 'AT1', refresh_token: 'REFRESH-1', expires_in: 3599 });
    if (g === 'refresh_token') return Response.json({ access_token: 'AT2', expires_in: 3599 });
  }
  if (s.startsWith('https://www.googleapis.com/youtube/v3/channels')) return Response.json({ items: [{ id: 'UC1', snippet: { title: 'SURVERSE', publishedAt: '2024-05-01T00:00:00Z' } }] });
  if (s.startsWith('https://youtubeanalytics.googleapis.com/v2/reports')) {
    const u = new URL(s);
    if (u.searchParams.get('dimensions') === 'creatorContentType')
      return Response.json({ columnHeaders: [{ name: 'creatorContentType' }, { name: 'views' }, { name: 'estimatedMinutesWatched' }], rows: [['VIDEO_ON_DEMAND', 300, 2400], ['SHORTS', 9000, 600]] });
    if (u.searchParams.get('dimensions') === 'day')
      return Response.json({ columnHeaders: [{ name: 'day' }, { name: 'views' }, { name: 'estimatedMinutesWatched' }], rows: [['2026-10-01', 10, 30], ['2026-10-02', 20, 90]] });
    const start = u.searchParams.get('startDate');
    const mins = start === '2024-05-01' ? 6000 : start.endsWith('-10-20') || start === '2025-10-20' ? 3000 : 600;
    return Response.json({ columnHeaders: [{ name: 'views' }, { name: 'estimatedMinutesWatched' }, { name: 'averageViewDuration' }], rows: [[500, mins, 42]] });
  }
  throw new Error(`unexpected ${s}`);
};

test('connect: state-checked Google OAuth → refresh token stored encrypted; watch time from YouTube Analytics', async () => {
  await assert.rejects(yt.startConnect({ PUBLIC_BASE_URL: 'x' }, db), /YT_CLIENT_ID and YT_CLIENT_SECRET/);
  const { url } = await yt.startConnect(ENV, db);
  const u = new URL(url);
  assert.equal(u.searchParams.get('redirect_uri'), 'https://studio.example/yt/callback');
  assert.equal(u.searchParams.get('access_type'), 'offline');
  assert.match(u.searchParams.get('scope'), /yt-analytics\.readonly/);
  const state = u.searchParams.get('state');
  await assert.rejects(yt.finishConnect(ENV, db, new URL('https://studio.example/yt/callback?code=c&state=bad')), /expired/);

  const calls = [];
  const r = await yt.finishConnect(ENV, db, new URL(`https://studio.example/yt/callback?code=abc&state=${state}`), { fetch: google(calls) });
  assert.equal(r.channelTitle, 'SURVERSE');
  const row = await db.prepare('SELECT * FROM yt_auth').first();
  assert.ok(!row.token_enc.includes('REFRESH'), 'refresh token is encrypted at rest');
  assert.equal((await yt.status(ENV, db)).connected, true);
  await assert.rejects(yt.finishConnect(ENV, db, new URL(`https://studio.example/yt/callback?code=abc&state=${state}`), { fetch: google() }), /expired/, 'state is single-use');

  const w = await yt.watchTime(ENV, db, { deps: { fetch: google(calls), now: new Date('2026-10-20T12:00:00Z') } });
  assert.equal(w.lifetime.watchHours, 100);
  assert.equal(w.last365.watchHours, 50);
  assert.equal(w.last28.watchHours, 10);
  assert.equal(w.lifetime.avgViewSeconds, 42);
  assert.deepEqual(w.daily.map((d) => d.watchHours), [0.5, 1.5]);
  assert.equal(w.ypp.hours, 4000, 'before 1 Feb 2027 the bar is 4,000 hours');
  assert.equal(w.split.longFormWatchHours365, 40, 'Shorts watch time is excluded from YPP hours');
  assert.equal(w.split.shortsViews90, 9000);
  assert.deepEqual(w.ypp.tiers.map((t) => [t.id, t.subscribers, t.hours, t.shortsViews90]), [['fan', 500, 3000, 3_000_000], ['ads', 1000, 4000, 10_000_000]]);
  const before = calls.length;
  const again = await yt.watchTime(ENV, db, { deps: { fetch: google(calls) } });
  assert.equal(again.cached, true);
  assert.equal(calls.length, before, 'cached: no Google calls');

  await yt.disconnect(db);
  assert.equal((await yt.status(ENV, db)).connected, false);
});

test('ypp target switches to 8,000 hours for new applicants from 1 Feb 2027', () => {
  assert.equal(yt.yppTarget(new Date('2027-01-31T23:00:00Z')).hours, 4000);
  assert.equal(yt.yppTarget(new Date('2027-02-01T00:00:00Z')).hours, 8000);
  assert.equal(yt.yppTarget(new Date('2027-02-01T00:00:00Z')).tiers[1].shortsViews90, 20_000_000);
  assert.equal(yt.yppTarget(new Date('2027-02-01T00:00:00Z')).tiers[0].hours, 3000, 'fan funding bar unchanged');
});

test('expired sign-in is reported plainly; changed secret is detected', async () => {
  const { url } = await yt.startConnect(ENV, db);
  const state = new URL(url).searchParams.get('state');
  await yt.finishConnect(ENV, db, new URL(`https://studio.example/yt/callback?code=abc&state=${state}`), { fetch: google() });
  const revoked = async (u, init) => (String(u).includes('oauth2') && init?.body?.get('grant_type') === 'refresh_token' ? Response.json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, { status: 400 }) : google()(u, init));
  await assert.rejects(yt.watchTime(ENV, db, { force: true, deps: { fetch: revoked } }), /Connect YouTube Analytics again/);
  const st = await yt.status({ ...ENV, YT_CLIENT_SECRET: 'GOCSPX-anothersecret99999' }, db);
  assert.equal(st.connected, false);
  assert.match(st.problem, /changed/);
});

test('http: watch time is owner-only', async () => {
  const ctx = { waitUntil: (p) => p.catch(() => {}) };
  const env = { DB: db, ASSETS: { fetch: async () => new Response('ok') }, ADMIN_TOKEN: 't', ...ENV };
  assert.equal((await worker.fetch(new Request('https://g.test/api/youtube/watchtime'), env, ctx)).status, 401);
  const r = await worker.fetch(new Request('https://g.test/api/youtube/watchtime', { headers: { authorization: 'Bearer t' } }), env, ctx);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.connected, false);
  assert.equal(/GOCSPX/.test(JSON.stringify(j)), false, 'never echoes the client secret');
});

test('monetization tracker: daily snapshots from real fetches, owner checklist validated', async () => {
  // Not connected: cron does nothing, nothing is invented.
  assert.deepEqual(await yt.trackDaily(ENV, db), { skipped: 'not connected' });
  assert.deepEqual((await yt.tracker(db)).history, []);

  const { url } = await yt.startConnect(ENV, db);
  const state = new URL(url).searchParams.get('state');
  await yt.finishConnect(ENV, db, new URL(`https://studio.example/yt/callback?code=abc&state=${state}`), { fetch: google() });

  const now = new Date('2026-10-20T12:00:00Z');
  assert.deepEqual(await yt.trackDaily(ENV, db, { fetch: google(), now }), { tracked: '2026-10-20' });
  let t = await yt.tracker(db);
  assert.equal(t.history.length, 1);
  assert.equal(t.history[0].longFormHours365, 40);
  assert.equal(t.history[0].shortsViews90, 9000);
  assert.deepEqual(await yt.trackDaily(ENV, db, { fetch: google(), now }), { skipped: 'already tracked today' });

  assert.equal(t.checklist.length, 6);
  assert.ok(t.checklist.every((c) => c.done === false), 'nothing is pre-ticked');
  t = await yt.setCheck(db, { id: 'twosv', done: true });
  assert.equal(t.checklist.find((c) => c.id === 'twosv').done, true);
  await assert.rejects(yt.setCheck(db, { id: 'nope', done: true }), /Unknown requirement/);
  await assert.rejects(yt.setCheck(db, { id: 'strikes', done: 'yes' }), /true or false/);
});

test('wrangler routes every Worker-handled page path to the Worker before static assets', async () => {
  const { readFileSync } = await import('node:fs');
  const root = new URL('../../', import.meta.url);
  const cfg = readFileSync(new URL('wrangler.jsonc', root), 'utf8');
  const first = JSON.parse(/"run_worker_first":\s*(\[[^\]]*\])/.exec(cfg)[1]);
  const src = readFileSync(new URL('worker/index.mjs', root), 'utf8');
  // Prefixes the fetch handler serves itself (e.g. the Google OAuth return /yt/callback).
  const handled = new Set([...src.matchAll(/pathname(?: ===|\.startsWith\()\s*'(\/[a-z]+)\//g)].map((m) => `${m[1]}/*`));
  assert.ok(handled.has('/yt/*'), 'sanity: /yt/callback is handled by the Worker');
  for (const p of handled) assert.ok(first.includes(p), `${p} must be in assets.run_worker_first, or the static app answers instead (blank page)`);
});
