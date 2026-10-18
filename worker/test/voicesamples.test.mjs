// Voice uploads + character-sheet rename on a real local D1 + KV (no external APIs).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getBindings, disposeDb, resetDb } from './helpers.mjs';
import * as vs from '../voicesamples.mjs';
import * as reels from '../reels.mjs';

let db, env;
before(async () => {
  const b = await getBindings();
  db = b.DB;
  env = { MEDIA: b.MEDIA };
});
after(disposeDb);
beforeEach(() => resetDb(db));
const audio = (n = 64) => Promise.resolve(new Uint8Array(n).fill(7).buffer);

test('voice uploads: stored per brand, validated, renamed, duplicates refused, deleted from storage', async () => {
  const a = await vs.addSample(env, db, { name: '  Chiku   happy ', brand: 'littleloop', mime: 'audio/mpeg', body: audio() });
  assert.equal(a.name, 'Chiku happy', 'name trimmed and spaces collapsed');
  await vs.addSample(env, db, { name: 'Narrator', brand: 'sunverse', mime: 'audio/wav; codecs=1', body: audio() });
  await assert.rejects(vs.addSample(env, db, { name: 'Chiku happy', brand: 'littleloop', mime: 'audio/mpeg', body: audio() }), /already exists/);
  await vs.addSample(env, db, { name: 'Chiku happy', brand: 'sunverse', mime: 'audio/mpeg', body: audio() }); // same name, other brand is fine
  await assert.rejects(vs.addSample(env, db, { name: 'x', mime: 'video/mp4', body: audio() }), /must be MP3/);
  await assert.rejects(vs.addSample(env, db, { name: 'x', brand: 'acme', mime: 'audio/mpeg', body: audio() }), /brand must be/);
  await assert.rejects(vs.addSample(env, db, { name: '', mime: 'audio/mpeg', body: audio() }), /Name is required/);
  await assert.rejects(vs.addSample(env, db, { name: 'big', mime: 'audio/mpeg', body: audio(vs.MAX_VOICE_BYTES + 1) }), /20 MB/);
  assert.equal((await vs.listSamples(db, 'littleloop')).length, 1, 'brands stay separate');
  assert.equal((await vs.listSamples(db)).length, 3);
  const res = await vs.sampleAudio(env, db, a.id);
  assert.equal(res.headers.get('content-type'), 'audio/mpeg');
  assert.equal((await res.arrayBuffer()).byteLength, 64);
  const r = await vs.renameSample(db, a.id, { name: 'Chiku giggle' });
  assert.equal(r.name, 'Chiku giggle');
  await vs.addSample(env, db, { name: 'Momo', brand: 'littleloop', mime: 'audio/mpeg', body: audio() });
  await assert.rejects(vs.renameSample(db, a.id, { name: 'Momo' }), /already exists/);
  await vs.deleteSample(env, db, a.id);
  assert.equal(await env.MEDIA.get(`voice/${a.id}`), null, 'audio removed from KV');
  await assert.rejects(vs.sampleAudio(env, db, a.id), /not found/);
});

test('character sheets: rename keeps details, duplicate rename gives a clear 409', async () => {
  const png = Promise.resolve(new Uint8Array([137, 80, 78, 71]).buffer);
  const id = await reels.addSheet(env, db, { name: 'Jungle cast', mime: 'image/png', body: png });
  await reels.addSheet(env, db, { name: 'Ocean cast', mime: 'image/png', body: Promise.resolve(new Uint8Array([1, 2]).buffer) });
  const s = await reels.updateSheet(db, id, { name: 'Jungle Expedition' });
  assert.equal(s.name, 'Jungle Expedition');
  assert.equal(s.detailsStatus, 'pending', 'rename alone does not change reading status');
  await assert.rejects(reels.updateSheet(db, id, { name: 'Ocean cast' }), (e) => e.status === 409 && /already exists/.test(e.message));
});
