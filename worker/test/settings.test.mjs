// App Settings keys (encrypted in D1) and analytics history ranges, on a real local D1.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getBindings, disposeDb, resetDb } from './helpers.mjs';
import * as secrets from '../secrets.mjs';
import { history } from '../analytics.mjs';

let db;
before(async () => ({ DB: db } = await getBindings()));
after(disposeDb);
beforeEach(async () => {
  await resetDb(db);
  secrets.resetSecretsCache();
});

test('keys saved in the app are encrypted, fill missing env, never override Cloudflare secrets', async () => {
  const env = { ADMIN_TOKEN: 'admin-1' };
  await assert.rejects(secrets.save(env, db, { name: 'NOPE', value: 'x' }), /Unknown setting/);
  await secrets.save(env, db, { name: 'OPENAI_API_KEY', value: 'sk-test-0123456789abcdefghijABCD' });
  await secrets.save(env, db, { name: 'GEMINI_API_KEY', value: 'g-from-app' });
  const row = await db.prepare("SELECT * FROM app_secrets WHERE name = 'OPENAI_API_KEY'").first();
  assert.ok(!row.enc.includes('sk-test'), 'stored encrypted');
  const merged = await secrets.withSecrets({ ...env, GEMINI_API_KEY: 'g-cloudflare' }, db);
  assert.equal(merged.OPENAI_API_KEY, 'sk-test-0123456789abcdefghijABCD');
  assert.equal(merged.GEMINI_API_KEY, 'g-cloudflare', 'Cloudflare secret wins');
  const list = await secrets.list({ ...env, GEMINI_API_KEY: 'g-cloudflare' }, db);
  const o = list.find((x) => x.name === 'OPENAI_API_KEY');
  assert.equal(o.source, 'app');
  assert.equal(o.hint, '••••ABCD');
  assert.ok(!JSON.stringify(list).includes('sk-test'), 'values never listed');
  assert.equal(list.find((x) => x.name === 'GEMINI_API_KEY').source, 'worker');
  secrets.resetSecretsCache();
  assert.equal((await secrets.withSecrets({ ADMIN_TOKEN: 'other' }, db)).OPENAI_API_KEY, undefined, 'unreadable with another admin token');
  await secrets.save(env, db, { name: 'OPENAI_API_KEY', value: null });
  secrets.resetSecretsCache();
  assert.equal((await secrets.withSecrets(env, db)).OPENAI_API_KEY, undefined);
});

test('analytics history: range filter and change from stored hourly fetches', async () => {
  const ins = (at, subs, views) =>
    db.prepare("INSERT INTO analytics_snapshots (id, brand, source, account_ref, fetched_at, data_json) VALUES (?, 'sunverse', 'youtube_data_api', '@x', ?, ?)").bind(`s${at}`, at, JSON.stringify({ channel: { subscribers: subs, totalViews: views, videoCount: 4 }, videos: [] })).run();
  const h = (n) => new Date(Date.now() - n * 3600_000).toISOString();
  await ins(h(200), 5, 100);
  await ins(h(20), 10, 400);
  await ins(h(2), 12, 520);
  const day = await history(db, 'sunverse', '24h');
  assert.equal(day.fetches, 2);
  assert.equal(day.change.views, 120);
  assert.equal(day.change.followers, 2);
  const all = await history(db, 'sunverse', 'all');
  assert.equal(all.fetches, 3);
  assert.equal(all.change.views, 420);
  assert.equal((await history(db, 'sunverse', 'bogus')).range, '7d');
});

test('Instagram keys: format-checked, autofilled admin password refused, saved IG keys enable Connect', async () => {
  const env = { ADMIN_TOKEN: 'Studio@0901' };
  await assert.rejects(secrets.save(env, db, { name: 'IG_APP_SECRET', value: 'Studio@0901' }), /admin password \(probably browser autofill\)/);
  await assert.rejects(secrets.save(env, db, { name: 'IG_APP_ID', value: 'abc123' }), /numeric Instagram app ID/);
  await assert.rejects(secrets.save(env, db, { name: 'IG_APP_SECRET', value: 'not-a-secret' }), /32 letters\/numbers/);
  await assert.rejects(secrets.save(env, db, { name: 'IG_ACCESS_TOKEN', value: 'short token' }), /Instagram access token/);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM app_secrets').first('n'), 0, 'nothing stored by refused saves');
  await secrets.save(env, db, { name: 'IG_APP_ID', value: '1988560575881781' });
  await secrets.save(env, db, { name: 'IG_APP_SECRET', value: '0123456789abcdef0123456789ABCDEF' });
  const list = await secrets.list(env, db);
  assert.equal(list.find((x) => x.name === 'IG_APP_ID').hint, '1988560575881781', 'app ID is not secret, shown in full');
  assert.equal(list.find((x) => x.name === 'IG_APP_SECRET').hint, '••••CDEF');
  assert.equal(list.find((x) => x.name === 'IG_ACCESS_TOKEN').source, null, 'optional token stays unset');
  const merged = await secrets.withSecrets(env, db);
  assert.equal(merged.IG_APP_ID, '1988560575881781');
  assert.equal(merged.IG_APP_SECRET, '0123456789abcdef0123456789ABCDEF');
});
