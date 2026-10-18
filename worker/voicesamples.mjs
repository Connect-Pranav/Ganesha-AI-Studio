// Uploaded voice recordings (reference voices) — technical id: voice_sample_library.
// Owner uploads one or many audio files; each is stored in MEDIA KV and named after its file
// (editable). These are reference recordings for production; they are NOT used to clone a voice.
import { HttpError, newId, nowIso } from './util.mjs';

export const VOICE_MIMES = ['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/ogg', 'audio/webm', 'audio/flac'];
export const MAX_VOICE_BYTES = 20 * 1024 * 1024; // KV values are capped at 25 MB
export const VOICE_BRANDS = ['studio', 'littleloop', 'sunverse', 'foliocraft'];

const kv = (env) => {
  if (!env.MEDIA) throw new HttpError(503, 'KV binding MEDIA is not configured on the Worker.');
  return env.MEDIA;
};
const out = (r) => ({ id: r.id, brand: r.brand, name: r.name, mime: r.mime, bytes: r.bytes, createdAt: r.created_at, updatedAt: r.updated_at });
const cleanName = (n) => String(n ?? '').replace(/\s+/g, ' ').trim();
function checkName(name) {
  if (!name || name.length > 60) throw new HttpError(400, 'Name is required (max 60 characters)');
  return name;
}
const audit = (db, kind, message) =>
  db.prepare('INSERT INTO events (workflow_id, task_id, kind, message, created_at) VALUES (NULL,NULL,?,?,?)').bind(kind, message, nowIso()).run();

export async function listSamples(db, brand = null) {
  const q = brand ? db.prepare('SELECT * FROM voice_samples WHERE brand = ? ORDER BY created_at').bind(brand) : db.prepare('SELECT * FROM voice_samples ORDER BY created_at');
  return (await q.all()).results.map(out);
}

export async function addSample(env, db, { name, brand = 'studio', mime, body }) {
  name = checkName(cleanName(name));
  brand = String(brand || 'studio');
  if (!VOICE_BRANDS.includes(brand)) throw new HttpError(400, `brand must be one of ${VOICE_BRANDS.join(', ')}`);
  mime = String(mime ?? '').split(';')[0].trim().toLowerCase();
  if (!VOICE_MIMES.includes(mime)) throw new HttpError(415, 'Voice file must be MP3, M4A/AAC, WAV, OGG, WebM or FLAC audio');
  const bytes = new Uint8Array(await body);
  if (!bytes.length) throw new HttpError(400, 'Empty audio file');
  if (bytes.length > MAX_VOICE_BYTES) throw new HttpError(413, 'Voice file must be 20 MB or smaller');
  const id = newId('voice');
  const key = `voice/${id}`;
  await kv(env).put(key, bytes, { metadata: { mime } });
  const now = nowIso();
  try {
    await db.prepare('INSERT INTO voice_samples (id, brand, name, media_key, mime, bytes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)').bind(id, brand, name, key, mime, bytes.length, now, now).run();
  } catch (e) {
    await kv(env).delete(key);
    if (/UNIQUE/i.test(e.message)) throw new HttpError(409, `A voice named "${name}" already exists here. Rename it and upload again.`);
    throw e;
  }
  await audit(db, 'voice_sample_added', `Voice uploaded (${brand}): ${name}`);
  return out(await db.prepare('SELECT * FROM voice_samples WHERE id = ?').bind(id).first());
}

export async function renameSample(db, id, { name }) {
  const row = await db.prepare('SELECT * FROM voice_samples WHERE id = ?').bind(id).first();
  if (!row) throw new HttpError(404, 'Voice not found');
  name = checkName(cleanName(name));
  try {
    await db.prepare('UPDATE voice_samples SET name = ?, updated_at = ? WHERE id = ?').bind(name, nowIso(), id).run();
  } catch (e) {
    if (/UNIQUE/i.test(e.message)) throw new HttpError(409, `A voice named "${name}" already exists here.`);
    throw e;
  }
  if (name !== row.name) await audit(db, 'voice_sample_renamed', `Voice renamed: ${row.name} → ${name}`);
  return out(await db.prepare('SELECT * FROM voice_samples WHERE id = ?').bind(id).first());
}

export async function deleteSample(env, db, id) {
  const row = await db.prepare('SELECT * FROM voice_samples WHERE id = ?').bind(id).first();
  if (!row) throw new HttpError(404, 'Voice not found');
  await db.prepare('DELETE FROM voice_samples WHERE id = ?').bind(id).run();
  if (env.MEDIA) await env.MEDIA.delete(row.media_key);
  await audit(db, 'voice_sample_deleted', `Voice deleted: ${row.name}`);
  return { deleted: true };
}

export async function sampleAudio(env, db, id) {
  const row = await db.prepare('SELECT media_key, mime FROM voice_samples WHERE id = ?').bind(id).first();
  if (!row) throw new HttpError(404, 'Voice not found');
  const obj = await kv(env).get(row.media_key, 'stream');
  if (!obj) throw new HttpError(404, 'Voice audio is missing from storage');
  return new Response(obj, { headers: { 'content-type': row.mime, 'cache-control': 'private, max-age=300' } });
}
