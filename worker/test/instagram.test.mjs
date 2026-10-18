// Instagram "Connect" flow on a real local D1; Instagram endpoints are MOCKED.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getBindings, disposeDb, resetDb } from './helpers.mjs';
import * as ig from '../instagram.mjs';

let db;
before(async () => ({ DB: db } = await getBindings()));
after(disposeDb);
beforeEach(() => resetDb(db));
const ENV = { IG_APP_ID: '123', IG_APP_SECRET: 'appsecret', PUBLIC_BASE_URL: 'https://studio.example' };

test('connect: state-checked OAuth → long-lived token stored encrypted → used everywhere; refresh when due', async () => {
  await assert.rejects(ig.startConnect({}, db), /IG_APP_ID and IG_APP_SECRET/);
  const { url } = await ig.startConnect(ENV, db);
  const u = new URL(url);
  assert.equal(u.searchParams.get('redirect_uri'), 'https://studio.example/ig/callback');
  assert.match(u.searchParams.get('scope'), /instagram_business_content_publish/);
  const state = u.searchParams.get('state');
  await assert.rejects(ig.finishConnect(ENV, db, new URL('https://studio.example/ig/callback?code=c&state=bad')), /expired/);
  const fake = async (url, init) => {
    const s = String(url);
    if (s === 'https://api.instagram.com/oauth/access_token') {
      assert.equal(init.body.get('code'), 'abc');
      return Response.json({ access_token: 'SHORT', user_id: 17 });
    }
    if (s.includes('/access_token?grant_type=ig_exchange_token')) return Response.json({ access_token: 'LONG', expires_in: 5184000 });
    if (s.includes('/me?')) return Response.json({ user_id: '17', username: 'little_loop09' });
    if (s.includes('/refresh_access_token')) return Response.json({ access_token: 'LONG2', expires_in: 5184000 });
    throw new Error(`unexpected ${s}`);
  };
  const r = await ig.finishConnect(ENV, db, new URL(`https://studio.example/ig/callback?code=abc%23_&state=${state}`), { fetch: fake });
  assert.equal(r.username, 'little_loop09');
  const row = await db.prepare('SELECT * FROM ig_auth').first();
  assert.ok(!row.token_enc.includes('LONG'), 'token is encrypted at rest');
  assert.equal(await ig.igToken(ENV, db), 'LONG');
  assert.equal((await ig.withIg(ENV, db)).IG_ACCESS_TOKEN, 'LONG');
  assert.equal((await ig.status(ENV, db)).username, 'little_loop09');
  assert.equal(await ig.refreshIfDue(ENV, db, { fetch: fake }), null, 'not due yet');
  await db.prepare("UPDATE ig_auth SET expires_at = '2000-01-01T00:00:00Z'").run();
  assert.equal((await ig.refreshIfDue(ENV, db, { fetch: fake })).refreshed, true);
  assert.equal(await ig.igToken(ENV, db), 'LONG2');
  assert.equal(await ig.igToken({ ...ENV, IG_ACCESS_TOKEN: 'SECRET' }, db), 'SECRET', 'Worker secret still wins');
  await ig.disconnect(db);
  assert.equal(await ig.igToken(ENV, db), null);
});
