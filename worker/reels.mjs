// LittleLoop Reel Factory (agent id: littleloop_reel_factory).
//
//  Worker side (this file): owner settings, character sheets (images in KV), daily planning with
//  rotation, the runner job API, owner approval, Instagram publishing and the public media route.
//  Heavy work — script writing (Gemini vision), video rendering (Gemini Omni Flash, 10 s scene +
//  10 s extension) and QC with ffprobe — runs in GitHub Actions (scripts/reel-runner.py), because a
//  Worker cannot hold a multi-minute render or decode a large video inside its CPU limits.
//
//  Gates: nothing renders unless the owner switched the factory on (that switch is the standing
//  spend approval, capped per day); nothing is posted until the owner approves the finished video.
import { HttpError, newId, nowIso, isoIn } from './util.mjs';

const BRAND = 'littleloop';
const MAX_SHEET_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = 24 * 1024 * 1024; // KV value limit is 25 MiB
const SHEET_MIMES = ['image/png', 'image/jpeg', 'image/webp'];
const LEASE_MS = 45 * 60_000;
const MAX_ATTEMPTS = 3;
const VIDEO_TTL_S = 21 * 86400; // finished videos expire from KV after 3 weeks
const SERVABLE = ['review', 'approved', 'publishing', 'published'];
const FLOW_TICKET_MS = 3 * 86400_000; // Flow clips must arrive within 3 days
const MAX_CLIP_BYTES = 20 * 1024 * 1024;
export const FLOW_CLIPS = [8, 6, 6]; // Flow (Veo 3.1) clips are 4/6/8 s: 8 + 6 + 6 = 20 s
export const FLOW_MODELS = { 'Veo 3.1 Lite': 10, 'Veo 3.1 Fast': 20, 'Veo 3.1 Quality': 100 }; // Flow credits per clip (AI Pro)

/** Calendar day in India (the owner's timezone), YYYY-MM-DD. */
export const istDay = (ms = Date.now()) => new Date(ms + 5.5 * 3600_000).toISOString().slice(0, 10);

const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
const media = (env) => {
  if (!env.MEDIA) throw new HttpError(503, 'KV binding MEDIA is not configured on the Worker (it is created automatically on the next deploy).');
  return env.MEDIA;
};
async function audit(db, kind, message, data) {
  await db.prepare('INSERT INTO events (workflow_id, task_id, kind, message, data_json, created_at) VALUES (NULL,NULL,?,?,?,?)').bind(kind, String(message).slice(0, 1000), data ? JSON.stringify(data).slice(0, 4000) : null, nowIso()).run();
}

/* ---------------- config ---------------- */
export async function getConfig(db) {
  let c = await db.prepare('SELECT * FROM reel_config WHERE id = 1').first();
  if (!c) {
    await db.prepare('INSERT OR IGNORE INTO reel_config (id, updated_at) VALUES (1, ?)').bind(nowIso()).run();
    c = await db.prepare('SELECT * FROM reel_config WHERE id = 1').first();
  }
  let p = await db.prepare('SELECT * FROM reel_prefs WHERE id = 1').first();
  if (!p) {
    await db.prepare('INSERT OR IGNORE INTO reel_prefs (id, updated_at) VALUES (1, ?)').bind(nowIso()).run();
    p = await db.prepare('SELECT * FROM reel_prefs WHERE id = 1').first();
  }
  const flowCreditsPerReel = (FLOW_MODELS[p.flow_model] ?? 10) * FLOW_CLIPS.length;
  const se = await db.prepare("SELECT value FROM studio_prefs WHERE key = 'reels.script_engine'").first();
  const scriptEngine = SCRIPT_ENGINES.includes(se?.value) ? se.value : 'gemini';
  return { enabled: Boolean(c.enabled), perDay: c.per_day, dailyCapUsd: c.daily_cap_usd, estReelUsd: c.est_reel_usd, language: c.language, brief: c.brief, renderMode: p.render_mode, flowModel: p.flow_model, flowCreditsPerReel, scriptEngine, updatedAt: c.updated_at };
}

// Who writes the reel script: Gemini in the GitHub runner (free key, default) or OpenAI via the Worker (paid per request).
export const SCRIPT_ENGINES = ['gemini', 'openai'];

export async function saveConfig(db, b) {
  const cur = await getConfig(db);
  const next = { ...cur };
  if (b.enabled !== undefined) next.enabled = Boolean(b.enabled);
  if (b.perDay !== undefined) {
    if (!Number.isInteger(b.perDay) || b.perDay < 1 || b.perDay > 4) throw new HttpError(400, 'perDay must be 1–4');
    next.perDay = b.perDay;
  }
  if (b.dailyCapUsd !== undefined) {
    if (typeof b.dailyCapUsd !== 'number' || !(b.dailyCapUsd >= 0) || b.dailyCapUsd > 100) throw new HttpError(400, 'dailyCapUsd must be 0–100');
    next.dailyCapUsd = b.dailyCapUsd;
  }
  if (b.estReelUsd !== undefined) {
    if (typeof b.estReelUsd !== 'number' || !(b.estReelUsd > 0) || b.estReelUsd > 50) throw new HttpError(400, 'estReelUsd must be above 0 and at most 50');
    next.estReelUsd = b.estReelUsd;
  }
  for (const [k, max] of [['language', 120], ['brief', 1500]])
    if (b[k] !== undefined) {
      if (typeof b[k] !== 'string' || b[k].length > max || (k === 'language' && !b[k].trim())) throw new HttpError(400, `${k} must be text (max ${max} chars)`);
      next[k] = b[k].trim();
    }
  if (b.renderMode !== undefined) {
    if (!['flow', 'api'].includes(b.renderMode)) throw new HttpError(400, 'renderMode must be flow or api');
    next.renderMode = b.renderMode;
  }
  if (b.scriptEngine !== undefined) {
    if (!SCRIPT_ENGINES.includes(b.scriptEngine)) throw new HttpError(400, `scriptEngine must be ${SCRIPT_ENGINES.join(' or ')}`);
    if (b.scriptEngine !== cur.scriptEngine) {
      await db.prepare("INSERT INTO studio_prefs (key, value, updated_at) VALUES ('reels.script_engine', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(b.scriptEngine, nowIso()).run();
      await audit(db, 'reels_config', `LittleLoop script engine set to ${b.scriptEngine}`);
    }
  }
  if (b.flowModel !== undefined) {
    if (!(b.flowModel in FLOW_MODELS)) throw new HttpError(400, `flowModel must be one of ${Object.keys(FLOW_MODELS).join(', ')}`);
    next.flowModel = b.flowModel;
  }
  await db.prepare('UPDATE reel_prefs SET render_mode = ?, flow_model = ?, updated_at = ? WHERE id = 1').bind(next.renderMode, next.flowModel, nowIso()).run();
  await db.prepare('UPDATE reel_config SET enabled = ?, per_day = ?, daily_cap_usd = ?, est_reel_usd = ?, language = ?, brief = ?, updated_at = ? WHERE id = 1').bind(next.enabled ? 1 : 0, next.perDay, next.dailyCapUsd, next.estReelUsd, next.language, next.brief, nowIso()).run();
  if (next.enabled !== cur.enabled) await audit(db, 'reels_config', `Reel factory ${next.enabled ? 'switched ON' : 'switched OFF'} (${next.perDay}/day, cap $${next.dailyCapUsd}/day)`);
  return getConfig(db);
}

/* ---------------- character sheets ---------------- */
const sheetOut = (s) => ({ id: s.id, name: s.name, mime: s.mime, bytes: s.bytes, notes: s.notes, details: s.details, detailsStatus: s.details_status, active: Boolean(s.active), useCount: s.use_count, lastUsedAt: s.last_used_at, createdAt: s.created_at });

export async function listSheets(db) {
  return (await db.prepare('SELECT * FROM reel_sheets WHERE brand = ? ORDER BY created_at').bind(BRAND).all()).results.map(sheetOut);
}

export async function addSheet(env, db, { name, notes = '', mime, body }) {
  name = String(name ?? '').trim();
  if (!name || name.length > 60) throw new HttpError(400, 'name is required (max 60 chars)');
  mime = String(mime ?? '').split(';')[0].trim().toLowerCase();
  if (!SHEET_MIMES.includes(mime)) throw new HttpError(415, `Character sheet must be ${SHEET_MIMES.join(', ')}`);
  const bytes = new Uint8Array(await body);
  if (!bytes.length) throw new HttpError(400, 'Empty image');
  if (bytes.length > MAX_SHEET_BYTES) throw new HttpError(413, 'Character sheet image must be 8 MB or smaller');
  if (String(notes).length > 1000) throw new HttpError(400, 'notes max 1000 chars');
  const id = newId('sheet');
  const key = `sheet/${id}`;
  await media(env).put(key, bytes, { metadata: { mime } });
  const now = nowIso();
  try {
    await db.prepare('INSERT INTO reel_sheets (id, brand, name, media_key, mime, bytes, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(id, BRAND, name, key, mime, bytes.length, String(notes), now, now).run();
  } catch (e) {
    await media(env).delete(key);
    if (/UNIQUE/i.test(e.message)) throw new HttpError(409, `A character sheet named "${name}" already exists.`);
    throw e;
  }
  await audit(db, 'reel_sheet_added', `LittleLoop character sheet: ${name}`);
  return id;
}

export async function updateSheet(db, id, b) {
  const s = await db.prepare('SELECT * FROM reel_sheets WHERE id = ?').bind(id).first();
  if (!s) throw new HttpError(404, 'Character sheet not found');
  const name = b.name !== undefined ? String(b.name).trim() : s.name;
  if (!name || name.length > 60) throw new HttpError(400, 'name max 60 chars');
  const notes = b.notes !== undefined ? String(b.notes) : s.notes;
  if (notes.length > 1000) throw new HttpError(400, 'notes max 1000 chars');
  const active = b.active !== undefined ? (b.active ? 1 : 0) : s.active;
  // Changing notes means the runner re-reads the sheet so scripts use the corrected details.
  const reread = b.notes !== undefined && notes !== s.notes;
  try {
    await db.prepare(`UPDATE reel_sheets SET name = ?, notes = ?, active = ?, details_status = ?, updated_at = ? WHERE id = ?`).bind(name, notes, active, reread ? 'pending' : s.details_status, nowIso(), id).run();
  } catch (e) {
    if (/UNIQUE/i.test(e.message)) throw new HttpError(409, `A character sheet named "${name}" already exists.`);
    throw e;
  }
  return sheetOut(await db.prepare('SELECT * FROM reel_sheets WHERE id = ?').bind(id).first());
}

export async function sheetImage(env, db, id) {
  const s = await db.prepare('SELECT media_key, mime FROM reel_sheets WHERE id = ?').bind(id).first();
  if (!s) throw new HttpError(404, 'Character sheet not found');
  const obj = await media(env).get(s.media_key, 'stream');
  if (!obj) throw new HttpError(404, 'Character sheet image is missing from storage');
  return new Response(obj, { headers: { 'content-type': s.mime, 'cache-control': 'private, max-age=300' } });
}

/* ---------------- planning (rotation + daily cap) ---------------- */
async function spentToday(db, day) {
  const r = await db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(cost_usd),0) AS cost FROM reels WHERE day = ? AND status != 'rejected'").bind(day).first();
  return { count: r.n, cost: r.cost };
}

/**
 * Creates today's reels up to perDay. Sheets rotate: least recently used first, then least used.
 * The day's committed spend (estimates for unfinished reels, actuals for rendered ones) must fit
 * the cap — otherwise nothing is queued and the reason is returned.
 */
export async function planToday(db, now = Date.now()) {
  const cfg = await getConfig(db);
  const day = istDay(now);
  if (!cfg.enabled) return { day, created: [], reason: 'Reel factory is switched off.' };
  const existing = (await db.prepare('SELECT slot, status, cost_usd FROM reels WHERE day = ?').bind(day).all()).results;
  const slots = new Set(existing.map((r) => r.slot));
  const committed = existing.reduce((sum, r) => sum + (r.status === 'rejected' || r.status === 'failed' ? r.cost_usd : Math.max(r.cost_usd, ['queued', 'rendering'].includes(r.status) && cfg.renderMode !== 'flow' ? cfg.estReelUsd : 0)), 0);
  const sheets = (await db.prepare("SELECT * FROM reel_sheets WHERE brand = ? AND active = 1 AND details_status = 'ready' ORDER BY (last_used_at IS NOT NULL), last_used_at, use_count, created_at").bind(BRAND).all()).results;
  const created = [];
  const est = cfg.renderMode === 'flow' ? 0 : cfg.estReelUsd;
  let budget = cfg.dailyCapUsd - committed;
  let i = 0;
  for (let slot = 1; slot <= cfg.perDay; slot++) {
    if (slots.has(slot)) continue;
    if (!sheets.length) return { day, created, reason: 'No active character sheet is ready yet (upload one; the runner reads it first).' };
    if (est > 0 && budget < est) return { day, created, reason: `Daily cap reached: $${cfg.dailyCapUsd} cap, $${(cfg.dailyCapUsd - budget).toFixed(2)} already committed today.` };
    const sheet = sheets[i++ % sheets.length];
    const id = newId('reel');
    const ts = nowIso();
    const ins = await db.prepare("INSERT OR IGNORE INTO reels (id, day, slot, sheet_id, status, created_at, updated_at) VALUES (?,?,?,?,'queued',?,?)").bind(id, day, slot, sheet.id, ts, ts).run();
    if (!ins.meta?.changes) continue; // another pass created this slot
    await db.prepare('UPDATE reel_sheets SET last_used_at = ?, use_count = use_count + 1 WHERE id = ?').bind(ts, sheet.id).run();
    budget -= est;
    created.push({ id, slot, sheet: sheet.name });
    await audit(db, 'reel_planned', `LittleLoop reel ${day} #${slot} with character sheet "${sheet.name}"`);
  }
  return { day, created, reason: null };
}

/* ---------------- runner job API (GitHub Actions) ---------------- */
async function releaseExpired(db) {
  const now = nowIso();
  const stale = (await db.prepare("SELECT id, attempts FROM reels WHERE status = 'rendering' AND lease_until < ?").bind(now).all()).results;
  for (const r of stale) {
    const flow = await db.prepare('SELECT stage FROM reel_flow WHERE reel_id = ?').bind(r.id).first();
    if (flow) {
      await db.prepare('DELETE FROM reel_flow WHERE reel_id = ?').bind(r.id).run();
      if (flow.stage === 'awaiting_clips') {
        await db.prepare("UPDATE reels SET status = 'failed', lease_until = NULL, error = ?, updated_at = ? WHERE id = ? AND status = 'rendering'").bind('No Google Flow clips arrived within 3 days. Tap Try again for a fresh script.', now, r.id).run();
        continue;
      }
    }
    const failed = r.attempts >= MAX_ATTEMPTS;
    await db.prepare("UPDATE reels SET status = ?, lease_until = NULL, error = ?, updated_at = ? WHERE id = ? AND status = 'rendering'").bind(failed ? 'failed' : 'queued', 'Runner did not finish in time (lease expired).', now, r.id).run();
  }
}

export async function claim(env, db) {
  await releaseExpired(db);
  const plan = await planToday(db);
  const pendingSheets = (await db.prepare("SELECT * FROM reel_sheets WHERE brand = ? AND active = 1 AND details_status = 'pending' ORDER BY created_at LIMIT 5").bind(BRAND).all()).results.map(sheetOut);
  const cfg = await getConfig(db);
  let job = null;
  // Flow clips that arrived: the runner joins + checks them (no AI spend).
  const ready = await db.prepare("SELECT f.reel_id, f.clips_json FROM reel_flow f JOIN reels r ON r.id = f.reel_id WHERE f.stage = 'clips_uploaded' AND r.status = 'rendering' ORDER BY f.updated_at LIMIT 1").first();
  if (ready) {
    const ok = await db.prepare("UPDATE reel_flow SET stage = 'joining', updated_at = ? WHERE reel_id = ? AND stage = 'clips_uploaded'").bind(nowIso(), ready.reel_id).run();
    if (ok.meta?.changes) {
      await db.prepare('UPDATE reels SET lease_until = ?, updated_at = ? WHERE id = ?').bind(isoIn(LEASE_MS), nowIso(), ready.reel_id).run();
      return { enabled: cfg.enabled, plan, pendingSheets, job: { type: 'join', reel: { id: ready.reel_id }, clips: JSON.parse(ready.clips_json).map((c) => c.n), expectedSeconds: FLOW_CLIPS.reduce((a, b) => a + b, 0) } };
    }
  }
  if (cfg.enabled) {
    const next = await db.prepare("SELECT * FROM reels WHERE status = 'queued' AND attempts < ? ORDER BY day, slot LIMIT 1").bind(MAX_ATTEMPTS).first();
    if (next) {
      const ok = await db.prepare("UPDATE reels SET status = 'rendering', lease_until = ?, attempts = attempts + 1, error = NULL, updated_at = ? WHERE id = ? AND status = 'queued'").bind(isoIn(LEASE_MS), nowIso(), next.id).run();
      if (ok.meta?.changes) {
        const sheet = await db.prepare('SELECT * FROM reel_sheets WHERE id = ?').bind(next.sheet_id).first();
        const recent = (await db.prepare("SELECT script_json FROM reels WHERE script_json IS NOT NULL AND id != ? ORDER BY created_at DESC LIMIT 6").bind(next.id).all()).results
          .map((r) => { try { return JSON.parse(r.script_json).title; } catch { return null; } }).filter(Boolean);
        job = { type: 'script', mode: cfg.renderMode, scriptEngine: cfg.scriptEngine, flowClips: FLOW_CLIPS, language: cfg.language, brief: cfg.brief, reel: { id: next.id, day: next.day, slot: next.slot, attempt: next.attempts + 1, script: next.script_json ? JSON.parse(next.script_json) : null }, sheet: sheet ? sheetOut(sheet) : null, avoidTitles: recent };
      }
    }
  }
  return { enabled: cfg.enabled, plan, pendingSheets, job };
}

const reelOf = async (db, id) => {
  const r = await db.prepare('SELECT * FROM reels WHERE id = ?').bind(id).first();
  if (!r) throw new HttpError(404, 'Reel not found');
  return r;
};

export async function setSheetDetails(db, id, { details, error }) {
  const s = await db.prepare('SELECT id FROM reel_sheets WHERE id = ?').bind(id).first();
  if (!s) throw new HttpError(404, 'Character sheet not found');
  if (error) {
    await db.prepare("UPDATE reel_sheets SET details_status = 'error', details = ?, updated_at = ? WHERE id = ?").bind(String(error).slice(0, 500), nowIso(), id).run();
    return;
  }
  if (typeof details !== 'string' || details.trim().length < 40 || details.length > 16000) throw new HttpError(400, 'details must be 40–16000 chars');
  await db.prepare("UPDATE reel_sheets SET details = ?, details_status = 'ready', updated_at = ? WHERE id = ?").bind(details.trim(), nowIso(), id).run();
}

/** Validates the script the runner wrote before it is stored and rendered. */
export function validateScript(s, mode = 'api') {
  const errs = [];
  if (!s || typeof s !== 'object') return ['script must be an object'];
  if (typeof s.title !== 'string' || !s.title.trim()) errs.push('title missing');
  if (typeof s.caption !== 'string' || !s.caption.trim() || s.caption.length > 2000) errs.push('caption missing or too long');
  if (!Array.isArray(s.scenes) || s.scenes.length !== 2) errs.push('exactly 2 scenes required');
  else
    s.scenes.forEach((sc, i) => {
      if (sc?.duration_s !== 10) errs.push(`scene ${i + 1}: duration_s must be 10`);
      if (mode !== 'flow' && (typeof sc?.video_prompt !== 'string' || sc.video_prompt.length < 80)) errs.push(`scene ${i + 1}: video_prompt too short`);
      if (!Array.isArray(sc?.beats) || !sc.beats.length) errs.push(`scene ${i + 1}: beats missing`);
    });
  if (mode === 'flow') {
    if (!Array.isArray(s?.flow_clips) || s.flow_clips.length !== FLOW_CLIPS.length) errs.push(`exactly ${FLOW_CLIPS.length} flow_clips required`);
    else
      s.flow_clips.forEach((c, i) => {
        if (c?.duration_s !== FLOW_CLIPS[i]) errs.push(`flow clip ${i + 1}: duration_s must be ${FLOW_CLIPS[i]}`);
        if (typeof c?.prompt !== 'string' || c.prompt.length < 80) errs.push(`flow clip ${i + 1}: prompt too short`);
      });
  }
  return errs;
}

/**
 * OpenAI script writer (only when the owner picked scriptEngine=openai). The runner sends the same prompt
 * it would give Gemini; the Worker attaches the character sheet image, calls the OpenAI provider and
 * stores the validated script. Returns { script, usage, requestId }.
 */
export async function writeScriptWithOpenAI(env, db, id, prompt, call) {
  const r = await reelOf(db, id);
  if (r.status !== 'rendering') throw new HttpError(409, `Reel is ${r.status}, not rendering`);
  const cfg = await getConfig(db);
  if (cfg.scriptEngine !== 'openai') throw new HttpError(409, 'Script engine is Gemini — switch it to OpenAI in the Reel Factory settings first');
  if (typeof prompt !== 'string' || prompt.trim().length < 200 || prompt.length > 40_000) throw new HttpError(400, 'prompt must be 200–40000 chars');
  const s = await db.prepare('SELECT media_key, mime FROM reel_sheets WHERE id = ?').bind(r.sheet_id).first();
  const buf = s ? await media(env).get(s.media_key, 'arrayBuffer') : null;
  if (!buf) throw new HttpError(404, 'Character sheet image is missing from storage');
  if (buf.byteLength > 5 * 1024 * 1024) throw new HttpError(413, 'Character sheet image is over 5 MB; upload a smaller one for OpenAI');
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const out = await call({ system: 'You write scripts for LittleLoop, an original, safe kids (2-8) animated Instagram Reels series. Follow the brief exactly.', prompt, images: [`data:${s.mime};base64,${btoa(bin)}`], json: true, maxTokens: 12_000, reasoning: 'low', purpose: 'littleloop_script', workflowId: `reel:${id}` });
  await saveScript(db, id, out.json);
  return { script: out.json, model: out.model, usage: out.usage, requestId: out.requestId ?? null };
}

export async function saveScript(db, id, script) {
  const r = await reelOf(db, id);
  if (r.status !== 'rendering') throw new HttpError(409, `Reel is ${r.status}, not rendering`);
  const cfg = await getConfig(db);
  const errs = validateScript(script, cfg.renderMode);
  if (errs.length) throw new HttpError(400, `Script rejected: ${errs.join('; ')}`);
  const caption = [script.caption.trim(), (script.hashtags ?? []).filter((h) => /^#\w{1,40}$/.test(h)).slice(0, 12).join(' ')].filter(Boolean).join('\n\n');
  const flow = cfg.renderMode === 'flow';
  await db.prepare('UPDATE reels SET script_json = ?, caption = ?, lease_until = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(script), caption.slice(0, 2200), isoIn(flow ? FLOW_TICKET_MS : LEASE_MS), nowIso(), id).run();
  if (flow) {
    const ts = nowIso();
    await db.prepare("INSERT OR REPLACE INTO reel_flow (reel_id, stage, ticket, ticket_expires, clips_json, created_at, updated_at) VALUES (?, 'awaiting_clips', ?, ?, '[]', ?, ?)").bind(id, hex(16), isoIn(FLOW_TICKET_MS), ts, ts).run();
    await audit(db, 'reel_flow_ready', `LittleLoop reel ${r.day} #${r.slot}: script ready, waiting for Google Flow clips`, { reel: id });
  }
  return { mode: cfg.renderMode };
}

/* ---------------- Google Flow handoff (upload ticket, no admin token needed) ---------------- */
async function flowByTicket(db, ticket) {
  if (!/^[0-9a-f]{32}$/.test(ticket ?? '')) throw new HttpError(404, 'Unknown upload link');
  const f = await db.prepare('SELECT * FROM reel_flow WHERE ticket = ?').bind(ticket).first();
  if (!f || Date.parse(f.ticket_expires) < Date.now()) throw new HttpError(404, 'Upload link expired or unknown');
  return f;
}

export async function flowTicketInfo(db, ticket) {
  const f = await flowByTicket(db, ticket);
  const r = await reelOf(db, f.reel_id);
  const script = r.script_json ? JSON.parse(r.script_json) : {};
  return { reel: r.id, day: r.day, slot: r.slot, stage: f.stage, title: script.title ?? null, clips: FLOW_CLIPS.map((d, i) => ({ n: i + 1, duration_s: d, prompt: script.flow_clips?.[i]?.prompt ?? null })), uploaded: JSON.parse(f.clips_json).map((c) => c.n) };
}

/** Stores clip n (1..3) for the reel. When all clips are in, the runner joins them. */
export async function uploadClip(env, db, ticket, n, { body, length, mime }) {
  const f = await flowByTicket(db, ticket);
  if (f.stage !== 'awaiting_clips') throw new HttpError(409, 'Clips for this reel are already being processed.');
  n = Number(n);
  if (!Number.isInteger(n) || n < 1 || n > FLOW_CLIPS.length) throw new HttpError(400, `clip number must be 1-${FLOW_CLIPS.length}`);
  mime = String(mime ?? '').split(';')[0].trim().toLowerCase();
  if (!/^video\/(mp4|quicktime|webm)$/.test(mime)) throw new HttpError(415, 'Clip must be an MP4, MOV or WebM video');
  if (!(length > 0)) throw new HttpError(411, 'content-length is required');
  if (length > MAX_CLIP_BYTES) throw new HttpError(413, 'Clip must be 20 MB or smaller');
  await media(env).put(`flowclip/${f.reel_id}/${n}`, body, { expirationTtl: 7 * 86400, metadata: { mime } });
  const clips = JSON.parse(f.clips_json).filter((c) => c.n !== n);
  clips.push({ n, bytes: length, mime, at: nowIso() });
  clips.sort((a, b) => a.n - b.n);
  const done = clips.length === FLOW_CLIPS.length;
  await db.prepare('UPDATE reel_flow SET clips_json = ?, stage = ?, updated_at = ? WHERE reel_id = ?').bind(JSON.stringify(clips), done ? 'clips_uploaded' : 'awaiting_clips', nowIso(), f.reel_id).run();
  if (done) await audit(db, 'reel_flow_clips', `All ${clips.length} Google Flow clips received for reel ${f.reel_id}; joining next`, { reel: f.reel_id });
  return { uploaded: clips.map((c) => c.n), complete: done };
}

export async function clipFile(env, db, reelId, n) {
  const obj = await media(env).getWithMetadata(`flowclip/${reelId}/${Number(n)}`, 'stream');
  if (!obj?.value) throw new HttpError(404, 'Clip not found');
  return new Response(obj.value, { headers: { 'content-type': obj.metadata?.mime ?? 'video/mp4' } });
}

async function dropFlow(env, db, reelId) {
  if (env.MEDIA) for (let n = 1; n <= FLOW_CLIPS.length; n++) await env.MEDIA.delete(`flowclip/${reelId}/${n}`);
  await db.prepare('DELETE FROM reel_flow WHERE reel_id = ?').bind(reelId).run();
}

/** Stores the finished, QC-passed video (streamed into KV) and puts the reel up for approval. */
export async function saveVideo(env, db, id, { body, length, meta }) {
  const r = await reelOf(db, id);
  if (r.status !== 'rendering') throw new HttpError(409, `Reel is ${r.status}, not rendering`);
  if (!r.script_json) throw new HttpError(409, 'Save the script before the video');
  if (!(length > 0)) throw new HttpError(411, 'content-length is required');
  if (length > MAX_VIDEO_BYTES) throw new HttpError(413, 'Video is larger than 24 MB');
  const key = `reel/${hex(16)}.mp4`;
  await media(env).put(key, body, { expirationTtl: VIDEO_TTL_S, metadata: { mime: 'video/mp4' } });
  await db.prepare("UPDATE reels SET status = 'review', video_key = ?, video_bytes = ?, video_meta_json = ?, lease_until = NULL, updated_at = ? WHERE id = ?").bind(key, length, JSON.stringify(meta ?? {}), nowIso(), id).run();
  await dropFlow(env, db, id);
  await audit(db, 'reel_ready', `LittleLoop reel ${r.day} #${r.slot} is ready for your approval`, { reel: id });
}

export async function failJob(db, id, error, env = {}) {
  const r = await reelOf(db, id);
  if (r.status !== 'rendering') return { status: r.status };
  const flow = await db.prepare('SELECT stage FROM reel_flow WHERE reel_id = ?').bind(id).first();
  if (flow?.stage === 'joining') {
    if (env.MEDIA) for (let n = 1; n <= FLOW_CLIPS.length; n++) await env.MEDIA.delete(`flowclip/${id}/${n}`);
    await db.prepare("UPDATE reel_flow SET stage = 'awaiting_clips', clips_json = '[]', ticket_expires = ?, updated_at = ? WHERE reel_id = ?").bind(isoIn(FLOW_TICKET_MS), nowIso(), id).run();
    await db.prepare('UPDATE reels SET lease_until = ?, error = ?, updated_at = ? WHERE id = ?').bind(isoIn(FLOW_TICKET_MS), `Flow clips rejected: ${String(error ?? '').slice(0, 800)} — upload new clips.`, nowIso(), id).run();
    return { status: 'rendering', flow: 'awaiting_clips' };
  }
  const status = r.attempts >= MAX_ATTEMPTS ? 'failed' : 'queued';
  await db.prepare('UPDATE reels SET status = ?, lease_until = NULL, error = ?, updated_at = ? WHERE id = ?').bind(status, String(error ?? 'unknown error').slice(0, 1000), nowIso(), id).run();
  if (status === 'failed') await audit(db, 'reel_failed', `LittleLoop reel ${r.day} #${r.slot} failed after ${r.attempts} attempts: ${String(error).slice(0, 300)}`);
  return { status };
}

/** Runner usage → provider_calls (shows in Usage as GANESHA's own Gemini calls) and the reel's cost. */
export async function recordUsage(db, { reelId = null, calls }) {
  if (!Array.isArray(calls) || calls.length > 20) throw new HttpError(400, 'calls must be an array (max 20)');
  let added = 0;
  for (const c of calls) {
    const model = String(c.model ?? '').slice(0, 80);
    const purpose = String(c.purpose ?? 'reel').slice(0, 60);
    if (!model) throw new HttpError(400, 'model required');
    const n = (v) => (v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : null);
    const cost = c.cost_usd === null || c.cost_usd === undefined ? null : Number(c.cost_usd);
    await db.prepare(`INSERT INTO provider_calls (id, provider, model, purpose, task_id, status, http_status, input_tokens, output_tokens, cost_usd, latency_ms, error, created_at) VALUES (?, 'gemini', ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(newId('pc'), model, `littleloop_reel_factory:${purpose}`, c.ok === false ? 'error' : 'success', n(c.http_status), n(c.input_tokens), n(c.output_tokens), Number.isFinite(cost) ? cost : null, n(c.latency_ms) ?? 0, c.error ? String(c.error).slice(0, 500) : null, nowIso())
      .run();
    if (reelId && Number.isFinite(cost) && cost > 0) await db.prepare('UPDATE reels SET cost_usd = cost_usd + ? WHERE id = ?').bind(cost, reelId).run();
    added++;
  }
  return { added };
}

/* ---------------- owner decisions ---------------- */
export async function decide(db, id, decision, reason = '', env = {}) {
  const r = await reelOf(db, id);
  if (decision === 'approve') {
    if (r.status !== 'review') throw new HttpError(409, `Only a reel waiting for review can be approved (this one is ${r.status}).`);
    await db.prepare("UPDATE reels SET status = 'approved', decided_at = ?, error = NULL, updated_at = ? WHERE id = ?").bind(nowIso(), nowIso(), id).run();
    await audit(db, 'reel_approved', `Owner approved LittleLoop reel ${r.day} #${r.slot} for Instagram`);
  } else if (decision === 'reject') {
    if (!['review', 'failed', 'queued', 'rendering'].includes(r.status)) throw new HttpError(409, `This reel is ${r.status} and cannot be rejected.`);
    await dropFlow(env, db, id);
    await db.prepare("UPDATE reels SET status = 'rejected', decided_at = ?, error = ?, updated_at = ? WHERE id = ?").bind(nowIso(), String(reason).slice(0, 500) || null, nowIso(), id).run();
    await audit(db, 'reel_rejected', `Owner rejected LittleLoop reel ${r.day} #${r.slot}${reason ? `: ${reason}` : ''}`);
  } else if (decision === 'redo') {
    // Re-render the same slot with a fresh script (owner asked for another take).
    if (!['review', 'failed', 'rejected'].includes(r.status)) throw new HttpError(409, `This reel is ${r.status} and cannot be redone.`);
    await dropFlow(env, db, id);
    await db.prepare("UPDATE reels SET status = 'queued', attempts = 0, script_json = NULL, caption = NULL, video_key = NULL, error = ?, updated_at = ? WHERE id = ?").bind(reason ? `Redo requested: ${String(reason).slice(0, 400)}` : null, nowIso(), id).run();
    await audit(db, 'reel_redo', `Owner asked for a new take of LittleLoop reel ${r.day} #${r.slot}`);
  } else throw new HttpError(400, 'decision must be approve, reject or redo');
  return reelView(await reelOf(db, id));
}

/* ---------------- Instagram publishing (after approval only) ---------------- */
const igBase = (env) => `https://${env.IG_GRAPH_HOST || 'graph.instagram.com'}/${env.IG_GRAPH_VERSION || 'v24.0'}`;
const publicBase = (env) => String(env.PUBLIC_BASE_URL || 'https://ganesha-studio.pravanigroup.workers.dev').replace(/\/$/, '');
export const mediaUrl = (env, key) => `${publicBase(env)}/m/${key.replace(/^reel\//, '')}`;

async function ig(env, fetchImpl, method, path, params) {
  const url = new URL(`${igBase(env)}/${path}`);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
  url.searchParams.set('access_token', env.IG_ACCESS_TOKEN);
  const res = await fetchImpl(url, { method });
  const text = await res.text();
  let body = {};
  try { body = JSON.parse(text); } catch { /* keep raw */ }
  if (!res.ok || body.error) {
    const msg = body.error?.message ?? text.slice(0, 300);
    throw Object.assign(new Error(`Instagram API ${res.status}: ${String(msg).split(env.IG_ACCESS_TOKEN).join('[redacted]')}`), { status: res.status, code: body.error?.code });
  }
  return body;
}

/** One publishing step per reel per pass (container → wait → publish). Never touches unapproved reels. */
export async function publishPass(env, db, deps = {}) {
  const fetchImpl = deps.fetch ?? fetch;
  const out = [];
  const rows = (await db.prepare("SELECT * FROM reels WHERE status IN ('approved','publishing') ORDER BY day, slot LIMIT 4").all()).results;
  if (!rows.length) return out;
  if (!env.IG_ACCESS_TOKEN) {
    for (const r of rows) if (r.error !== IG_MISSING) await db.prepare('UPDATE reels SET error = ?, updated_at = ? WHERE id = ?').bind(IG_MISSING, nowIso(), r.id).run();
    return [{ skipped: 'IG_ACCESS_TOKEN not set' }];
  }
  const user = env.IG_USER_ID || 'me';
  for (const r of rows) {
    try {
      if (r.status === 'approved') {
        const c = await ig(env, fetchImpl, 'POST', `${user}/media`, { media_type: 'REELS', video_url: mediaUrl(env, r.video_key), caption: r.caption ?? '', share_to_feed: 'true' });
        await db.prepare("UPDATE reels SET status = 'publishing', ig_container = ?, error = NULL, updated_at = ? WHERE id = ? AND status = 'approved'").bind(c.id, nowIso(), r.id).run();
        out.push({ id: r.id, step: 'container', container: c.id });
        continue;
      }
      const st = await ig(env, fetchImpl, 'GET', r.ig_container, { fields: 'status_code,status' });
      if (st.status_code === 'IN_PROGRESS') {
        out.push({ id: r.id, step: 'processing' });
        continue;
      }
      if (st.status_code === 'ERROR' || st.status_code === 'EXPIRED') {
        // Instagram rejected the upload: back to approved so the next pass makes a fresh container.
        const tries = (await db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind = 'reel_ig_error' AND data_json LIKE ?").bind(`%${r.id}%`).first()).n;
        const status = tries >= 2 ? 'failed' : 'approved';
        await db.prepare('UPDATE reels SET status = ?, ig_container = NULL, error = ?, updated_at = ? WHERE id = ?').bind(status, `Instagram processing ${st.status_code}: ${st.status ?? ''}`.slice(0, 500), nowIso(), r.id).run();
        await audit(db, 'reel_ig_error', `Instagram could not process reel ${r.day} #${r.slot}: ${st.status ?? st.status_code}`, { reel: r.id });
        out.push({ id: r.id, step: 'error', status });
        continue;
      }
      if (st.status_code !== 'FINISHED') {
        out.push({ id: r.id, step: `waiting:${st.status_code}` });
        continue;
      }
      const pub = await ig(env, fetchImpl, 'POST', `${user}/media_publish`, { creation_id: r.ig_container });
      let permalink = null;
      try { permalink = (await ig(env, fetchImpl, 'GET', pub.id, { fields: 'permalink' })).permalink ?? null; } catch { /* optional */ }
      await db.prepare("UPDATE reels SET status = 'published', ig_media_id = ?, ig_permalink = ?, published_at = ?, error = NULL, updated_at = ? WHERE id = ?").bind(pub.id, permalink, nowIso(), nowIso(), r.id).run();
      await audit(db, 'reel_published', `LittleLoop reel ${r.day} #${r.slot} posted to Instagram`, { reel: r.id, media: pub.id, permalink });
      out.push({ id: r.id, step: 'published', media: pub.id });
    } catch (e) {
      await db.prepare('UPDATE reels SET error = ?, updated_at = ? WHERE id = ?').bind(String(e.message).slice(0, 500), nowIso(), r.id).run();
      out.push({ id: r.id, error: e.message });
    }
  }
  return out;
}
const IG_MISSING = 'Approved, waiting for Instagram connection: set the Worker secret IG_ACCESS_TOKEN.';

/* ---------------- public media (Instagram fetches the approved video from here) ---------------- */
export async function serveMedia(env, db, name) {
  if (!/^[0-9a-f]{32}\.mp4$/.test(name)) return new Response('Not found', { status: 404 });
  const key = `reel/${name}`;
  const r = await db.prepare('SELECT status FROM reels WHERE video_key = ?').bind(key).first();
  if (!r || !SERVABLE.includes(r.status) || !env.MEDIA) return new Response('Not found', { status: 404 });
  const obj = await env.MEDIA.getWithMetadata(key, 'arrayBuffer');
  if (!obj?.value) return new Response('Not found', { status: 404 });
  return new Response(obj.value, { headers: { 'content-type': 'video/mp4', 'content-length': String(obj.value.byteLength), 'cache-control': 'public, max-age=3600', 'x-robots-tag': 'noindex' } });
}

/* ---------------- dashboard view ---------------- */
function reelView(r, env = {}) {
  let script = null;
  try { script = r.script_json ? JSON.parse(r.script_json) : null; } catch { /* ignore */ }
  return {
    id: r.id, day: r.day, slot: r.slot, sheetId: r.sheet_id, status: r.status, script, caption: r.caption,
    videoUrl: r.video_key && SERVABLE.includes(r.status) ? mediaUrl(env, r.video_key) : null,
    videoBytes: r.video_bytes, videoMeta: r.video_meta_json ? JSON.parse(r.video_meta_json) : null,
    attempts: r.attempts, costUsd: r.cost_usd, error: r.error, igPermalink: r.ig_permalink, publishedAt: r.published_at,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export async function overview(env, db) {
  const cfg = await getConfig(db);
  const day = istDay();
  const flows = new Map((await db.prepare('SELECT * FROM reel_flow').all()).results.map((f) => [f.reel_id, f]));
  const reels = (await db.prepare('SELECT * FROM reels ORDER BY day DESC, slot LIMIT 40').all()).results.map((r) => {
    const v = reelView(r, env);
    const f = flows.get(r.id);
    if (f) v.flow = { stage: f.stage, uploadUrl: `${publicBase(env)}/t/${f.ticket}`, expires: f.ticket_expires, uploaded: JSON.parse(f.clips_json).map((c) => c.n), clips: FLOW_CLIPS.map((d, i) => ({ n: i + 1, duration_s: d, prompt: v.script?.flow_clips?.[i]?.prompt ?? null })) };
    return v;
  });
  const today = await spentToday(db, day);
  const month = await db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(cost_usd),0) AS cost FROM reels WHERE day >= ? AND status != 'rejected'").bind(`${day.slice(0, 8)}01`).first();
  return {
    config: cfg,
    day,
    sheets: await listSheets(db),
    reels,
    spend: { todayUsd: today.cost, monthUsd: month.cost, monthReels: month.n },
    connections: {
      media: Boolean(env.MEDIA),
      instagram: Boolean(env.IG_ACCESS_TOKEN),
      runnerLastSeen: (await db.prepare("SELECT MAX(created_at) AS t FROM events WHERE kind = 'reel_runner_seen'").first())?.t ?? null,
    },
    pendingApproval: reels.filter((r) => r.status === 'review').length,
    waitingForFlow: reels.filter((r) => r.flow?.stage === 'awaiting_clips').length,
  };
}

/** Marks that the runner checked in (shown as "runner last seen" — at most one event per 10 min). */
export async function runnerSeen(db) {
  const last = (await db.prepare("SELECT MAX(created_at) AS t FROM events WHERE kind = 'reel_runner_seen'").first())?.t;
  if (!last || Date.now() - Date.parse(last) > 10 * 60_000) await audit(db, 'reel_runner_seen', 'Reel runner checked in');
}
