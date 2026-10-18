// LittleLoop Reel Factory on a real local D1 + KV (Miniflare). Instagram calls are MOCKED:
// these tests prove the gates and the state machine, not live Instagram/Gemini connectivity.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getBindings, disposeDb, resetDb } from './helpers.mjs';
import * as reels from '../reels.mjs';

let db, MEDIA, env;
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...new Array(64).fill(7)]);
const BIBLE = 'Species: a small round-faced toddler. Eyes: big brown. Hair: short black curls. Outfit: yellow raincoat with blue buttons. DO-NOT-CHANGE: yellow raincoat, curls, brown eyes.';
const script = (title = 'Puddle Jump') => ({
  title,
  caption: 'Splash time with Chiku! 💦',
  hashtags: ['#LittleLoop', '#KidsReels', 'not-a-tag'],
  scenes: [1, 2].map((n) => ({ n, duration_s: 10, beats: [{ t: '0-3s', action: 'jumps' }], video_prompt: `Vertical 9:16 animated shot, 10 seconds. Scene ${n} `.padEnd(120, 'x') })),
});

before(async () => {
  ({ DB: db, MEDIA } = await getBindings());
  env = { MEDIA, PUBLIC_BASE_URL: 'https://studio.example' };
});
after(disposeDb);
beforeEach(async () => {
  await resetDb(db);
  for (const k of (await MEDIA.list()).keys) await MEDIA.delete(k.name);
});

async function addReadySheets(names) {
  const ids = [];
  for (const name of names) {
    const id = await reels.addSheet(env, db, { name, mime: 'image/png', body: Promise.resolve(PNG.buffer) });
    await reels.setSheetDetails(db, id, { details: `${name}. ${BIBLE}` });
    ids.push(id);
  }
  return ids;
}

test('nothing is planned or rendered while the factory is off (switch = standing spend approval)', async () => {
  await addReadySheets(['Chiku']);
  const c = await reels.claim(env, db);
  assert.equal(c.enabled, false);
  assert.equal(c.job, null);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM reels').first()).n, 0);
});

test('2 reels/day, sheets rotate (least recently used first), idempotent, daily cap respected', async () => {
  await reels.saveConfig(db, { enabled: true, perDay: 2, dailyCapUsd: 5, estReelUsd: 2.2 });
  const none = await reels.planToday(db);
  assert.match(none.reason, /No active character sheet/);
  await addReadySheets(['Chiku', 'Mumu', 'Papa Bear']);
  const day1 = Date.parse('2026-10-18T03:00:00Z');
  const p1 = await reels.planToday(db, day1);
  assert.deepEqual(p1.created.map((c) => c.sheet), ['Chiku', 'Mumu']);
  assert.equal((await reels.planToday(db, day1)).created.length, 0, 'second pass adds nothing');
  const p2 = await reels.planToday(db, day1 + 86400_000);
  assert.equal(p2.created[0].sheet, 'Papa Bear', 'unused sheet goes first next day');
  // Cap: $3 allows one $2.20 reel only.
  await reels.saveConfig(db, { dailyCapUsd: 3 });
  const p3 = await reels.planToday(db, day1 + 2 * 86400_000);
  assert.equal(p3.created.length, 1);
  assert.match(p3.reason, /Daily cap reached/);
});

test('runner flow: claim → script (validated) → video → review; media is public only while servable', async () => {
  await reels.saveConfig(db, { enabled: true, perDay: 1 });
  await addReadySheets(['Chiku']);
  const c = await reels.claim(env, db);
  assert.equal(c.job.sheet.name, 'Chiku');
  assert.match(c.job.language, /Hinglish/);
  const id = c.job.reel.id;
  await assert.rejects(reels.saveScript(db, id, { title: 'x', scenes: [] }), /exactly 2 scenes/);
  await reels.saveScript(db, id, script());
  const row = await db.prepare('SELECT caption FROM reels WHERE id = ?').bind(id).first();
  assert.match(row.caption, /#LittleLoop #KidsReels$/, 'invalid hashtags dropped');
  const video = new Uint8Array(20_000).fill(1);
  await reels.saveVideo(env, db, id, { body: video, length: video.length, meta: { duration: 20.1 } });
  const ov = await reels.overview(env, db);
  const r = ov.reels.find((x) => x.id === id);
  assert.equal(r.status, 'review');
  assert.equal(ov.pendingApproval, 1);
  const name = r.videoUrl.split('/m/')[1];
  assert.equal(r.videoUrl, `https://studio.example/m/${name}`);
  const res = await reels.serveMedia(env, db, name);
  assert.equal(res.status, 200);
  assert.equal((await res.arrayBuffer()).byteLength, 20_000);
  assert.equal((await reels.serveMedia(env, db, 'nope.mp4')).status, 404);
  await reels.decide(db, id, 'reject', 'face looks off');
  assert.equal((await reels.serveMedia(env, db, name)).status, 404, 'rejected video is no longer public');
});

test('failures requeue up to 3 attempts, then fail; redo starts a fresh take', async () => {
  await reels.saveConfig(db, { enabled: true, perDay: 1 });
  await addReadySheets(['Chiku']);
  let id;
  for (let i = 1; i <= 3; i++) {
    const c = await reels.claim(env, db);
    id = c.job.reel.id;
    assert.equal(c.job.reel.attempt, i);
    const r = await reels.failJob(db, id, 'Video API 503');
    assert.equal(r.status, i < 3 ? 'queued' : 'failed');
  }
  assert.equal((await reels.claim(env, db)).job, null);
  await reels.decide(db, id, 'redo');
  assert.equal((await reels.claim(env, db)).job.reel.id, id);
});

test('Instagram: never posts without approval; approved → container → processing → published', async () => {
  await reels.saveConfig(db, { enabled: true, perDay: 1 });
  await addReadySheets(['Chiku']);
  const id = (await reels.claim(env, db)).job.reel.id;
  await reels.saveScript(db, id, script());
  await reels.saveVideo(env, db, id, { body: new Uint8Array(20_000), length: 20_000, meta: {} });

  const calls = [];
  let status = 'IN_PROGRESS';
  const fakeIg = async (url, init) => {
    const u = new URL(url);
    calls.push(`${init.method} ${u.pathname}`);
    assert.equal(u.searchParams.get('access_token'), 'IGTOKEN');
    if (u.pathname.endsWith('/me/media')) {
      assert.equal(u.searchParams.get('media_type'), 'REELS');
      assert.match(u.searchParams.get('video_url'), /^https:\/\/studio\.example\/m\/[0-9a-f]{32}\.mp4$/);
      assert.match(u.searchParams.get('caption'), /Splash time/);
      return Response.json({ id: 'C1' });
    }
    if (u.pathname.endsWith('/C1')) return Response.json({ status_code: status });
    if (u.pathname.endsWith('/me/media_publish')) return Response.json({ id: 'M1' });
    if (u.pathname.endsWith('/M1')) return Response.json({ permalink: 'https://www.instagram.com/reel/abc/' });
    throw new Error(`unexpected ${u}`);
  };
  const igEnv = { ...env, IG_ACCESS_TOKEN: 'IGTOKEN' };
  assert.deepEqual(await reels.publishPass(igEnv, db, { fetch: fakeIg }), [], 'review is not touched');
  assert.equal(calls.length, 0);

  await reels.decide(db, id, 'approve');
  assert.equal((await reels.publishPass({ ...env }, db, { fetch: fakeIg }))[0].skipped, 'IG_ACCESS_TOKEN not set');
  await reels.publishPass(igEnv, db, { fetch: fakeIg }); // container
  await reels.publishPass(igEnv, db, { fetch: fakeIg }); // still processing
  status = 'FINISHED';
  await reels.publishPass(igEnv, db, { fetch: fakeIg }); // publish
  const r = (await reels.overview(env, db)).reels[0];
  assert.equal(r.status, 'published');
  assert.equal(r.igPermalink, 'https://www.instagram.com/reel/abc/');
  assert.deepEqual(calls, ['POST /v24.0/me/media', 'GET /v24.0/C1', 'GET /v24.0/C1', 'POST /v24.0/me/media_publish', 'GET /v24.0/M1']);
});

test('runner usage lands in provider_calls (GANESHA ledger) and on the reel cost', async () => {
  await reels.saveConfig(db, { enabled: true, perDay: 1 });
  await addReadySheets(['Chiku']);
  const id = (await reels.claim(env, db)).job.reel.id;
  await reels.recordUsage(db, { reelId: id, calls: [{ model: 'gemini-omni-1.1-flash', purpose: 'video_scene1', input_tokens: 2000, output_tokens: 57920, cost_usd: 1.016 }, { model: 'gemini-3.8-flash', purpose: 'script', input_tokens: 1500, output_tokens: 900, cost_usd: null }] });
  const rows = (await db.prepare("SELECT provider, model, purpose, cost_usd FROM provider_calls ORDER BY model").all()).results;
  assert.equal(rows.length, 2);
  assert.ok(rows.every((x) => x.provider === 'gemini' && x.purpose.startsWith('littleloop_reel_factory:')));
  assert.equal((await db.prepare('SELECT cost_usd FROM reels WHERE id = ?').bind(id).first()).cost_usd, 1.016);
});
