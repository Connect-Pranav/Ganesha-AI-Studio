// AI Video & Filmmaking Studio backend: characters, productions, scenes (versioned), continuity
// checks, media asset references, provider jobs (Google Flow = manual handoff), prompt builder.
// No media binaries are stored here — only references to files that live in the provider/your drive.
import { HttpError, newId, nowIso } from './util.mjs';
import { listAssignments, profileById } from './voices.mjs';

const BRANDS = ['littleloop', 'sunverse', 'foliocraft', 'studio'];
const str = (v, name, max, { required = false } = {}) => {
  if (v === undefined || v === null || v === '') {
    if (required) throw new HttpError(400, `${name} is required`);
    return '';
  }
  if (typeof v !== 'string' || v.length > max) throw new HttpError(400, `${name} must be text (max ${max} chars)`);
  return v.trim();
};
const brandOf = (b) => {
  if (!BRANDS.includes(b)) throw new HttpError(400, `brand must be one of ${BRANDS.join(', ')}`);
  return b;
};
async function audit(db, kind, message, data) {
  await db.prepare('INSERT INTO events (workflow_id, task_id, kind, message, data_json, created_at) VALUES (NULL,NULL,?,?,?,?)').bind(kind, String(message).slice(0, 1000), data ? JSON.stringify(data).slice(0, 4000) : null, nowIso()).run();
}

/* ---------------- characters ---------------- */
export async function listCharacters(db, brand) {
  const rows = (await (brand ? db.prepare('SELECT * FROM characters WHERE brand = ? ORDER BY name').bind(brand) : db.prepare('SELECT * FROM characters ORDER BY brand, name')).all()).results;
  const out = [];
  for (const c of rows) {
    const voices = await listAssignments(db, 'character', c.id);
    out.push({ ...c, reference_assets: JSON.parse(c.reference_assets_json), reference_assets_json: undefined, approved: Boolean(c.approved), voices });
  }
  return out;
}

export async function saveCharacter(db, b, id = null) {
  const fields = {
    name: str(b.name, 'name', 60, { required: !id }),
    description: str(b.description, 'description', 1000),
    appearance: str(b.appearance, 'appearance', 1000),
    wardrobe: str(b.wardrobe, 'wardrobe', 600),
    personality: str(b.personality, 'personality', 600),
    language: str(b.language, 'language', 60),
    style_constraints: str(b.styleConstraints, 'styleConstraints', 600),
  };
  const refs = b.referenceAssets ?? null;
  if (refs !== null && (!Array.isArray(refs) || refs.length > 20 || !refs.every((r) => typeof r === 'string' && /^https:\/\//.test(r)))) throw new HttpError(400, 'referenceAssets must be up to 20 https links');
  const now = nowIso();
  if (!id) {
    const nid = newId('ch');
    try {
      await db
        .prepare(`INSERT INTO characters (id, brand, name, description, appearance, wardrobe, personality, language, style_constraints, reference_assets_json, approved, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(nid, brandOf(b.brand), fields.name, fields.description, fields.appearance, fields.wardrobe, fields.personality, fields.language, fields.style_constraints, JSON.stringify(refs ?? []), b.approved ? 1 : 0, now, now)
        .run();
    } catch (e) {
      if (/UNIQUE/i.test(e.message)) throw new HttpError(409, `A ${b.brand} character named "${fields.name}" already exists — reuse it instead of recreating it.`);
      throw e;
    }
    await audit(db, 'character_created', `${b.brand}: ${fields.name}`);
    return nid;
  }
  const cur = await db.prepare('SELECT * FROM characters WHERE id = ?').bind(id).first();
  if (!cur) throw new HttpError(404, 'Character not found');
  // Approved characters keep their look unless the change is confirmed (continuity).
  const visual = ['appearance', 'wardrobe', 'style_constraints'].filter((k) => b[k === 'style_constraints' ? 'styleConstraints' : k] !== undefined && fields[k] !== cur[k]);
  if (cur.approved && (visual.length || refs !== null) && !b.confirmChange) throw new HttpError(409, `"${cur.name}" is approved. Changing ${[...visual, ...(refs !== null ? ['reference assets'] : [])].join(', ')} breaks continuity — resend with confirmChange: true.`);
  const merged = {};
  for (const k of Object.keys(fields)) merged[k] = (k === 'style_constraints' ? b.styleConstraints : b[k]) === undefined ? cur[k] : fields[k];
  await db
    .prepare(`UPDATE characters SET name = ?, description = ?, appearance = ?, wardrobe = ?, personality = ?, language = ?, style_constraints = ?, reference_assets_json = ?, approved = ?, updated_at = ? WHERE id = ?`)
    .bind(merged.name || cur.name, merged.description, merged.appearance, merged.wardrobe, merged.personality, merged.language, merged.style_constraints, refs === null ? cur.reference_assets_json : JSON.stringify(refs), b.approved === undefined ? cur.approved : b.approved ? 1 : 0, now, id)
    .run();
  await audit(db, 'character_updated', `${cur.brand}: ${cur.name}${visual.length ? ` (changed ${visual.join(', ')})` : ''}`);
  return id;
}

/* ---------------- prompt builder (provider-neutral) ---------------- */
export const PROMPT_FIELDS = ['subject', 'action', 'scene', 'composition', 'lighting', 'camera', 'motion', 'style', 'audio', 'duration', 'aspectRatio', 'constraints'];

/** Builds a detailed text-to-video prompt. Pure function; no provider call. */
export function buildVideoPrompt(f = {}, characters = []) {
  for (const k of PROMPT_FIELDS) if (f[k] !== undefined && (typeof f[k] !== 'string' || f[k].length > 600)) throw new HttpError(400, `${k} must be text (max 600 chars)`);
  const lines = [];
  const who = characters.map((c) => `${c.name}: ${[c.appearance, c.wardrobe].filter(Boolean).join('; ')}`).filter((x) => x.includes(':'));
  if (f.subject) lines.push(`Subject: ${f.subject}`);
  if (who.length) lines.push(`Characters (keep exactly consistent): ${who.join(' | ')}`);
  if (f.action) lines.push(`Action: ${f.action}`);
  if (f.scene) lines.push(`Setting: ${f.scene}`);
  if (f.composition) lines.push(`Composition: ${f.composition}`);
  if (f.camera) lines.push(`Camera: ${f.camera}`);
  if (f.motion) lines.push(`Motion: ${f.motion}`);
  if (f.lighting) lines.push(`Lighting: ${f.lighting}`);
  if (f.style) lines.push(`Style: ${f.style}`);
  if (f.audio) lines.push(`Audio: ${f.audio}`);
  const fmt = [f.duration && `${f.duration}`, f.aspectRatio && `aspect ratio ${f.aspectRatio}`].filter(Boolean).join(', ');
  if (fmt) lines.push(`Format: ${fmt}`);
  const constraints = [f.constraints, 'original characters and designs only', 'no text overlays, logos or watermarks unless specified'].filter(Boolean);
  const styleCons = characters.map((c) => c.style_constraints).filter(Boolean);
  lines.push(`Constraints: ${[...constraints, ...styleCons].join('; ')}`);
  return lines.join('\n');
}

/* ---------------- productions + scenes ---------------- */
export const PILLARS = {
  fundamentals: ['text_to_video', 'image_to_video', 'reference_based'],
  methods: ['prompt_to_video', 'avatar_video', 'meta_ai_video', 'vlogger_video'],
  filmmaking: ['film_documentary', 'narration_music', 'graphic_novel'],
  production: ['ad', 'avatar_presentation', 'vfx', 'product_ad', 'reel', 'youtube_short', 'youtube_long', 'music_video', 'kids_episode'],
};
const FORMATS = ['instagram_reel', 'youtube_short', 'youtube_long', 'music_video', 'film', 'ad', 'graphic_novel'];

export async function createProduction(db, b) {
  const pillar = b.pillar;
  if (!(pillar in PILLARS)) throw new HttpError(400, `pillar must be ${Object.keys(PILLARS).join(', ')}`);
  if (!PILLARS[pillar].includes(b.method)) throw new HttpError(400, `method for ${pillar} must be ${PILLARS[pillar].join(', ')}`);
  if (!FORMATS.includes(b.format)) throw new HttpError(400, `format must be ${FORMATS.join(', ')}`);
  const req = b.requirements ?? {};
  if (typeof req !== 'object' || Array.isArray(req)) throw new HttpError(400, 'requirements must be an object');
  const vr = req.vocalRequirement;
  if (vr !== undefined && !['male_only', 'female_only', 'duet', 'none'].includes(vr)) throw new HttpError(400, 'requirements.vocalRequirement must be male_only, female_only, duet or none');
  const id = newId('pd');
  const now = nowIso();
  await db
    .prepare(`INSERT INTO productions (id, brand, title, format, pillar, method, workflow_id, brief, requirements_json, status, deadline, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,'planning',?,?,?)`)
    .bind(id, brandOf(b.brand), str(b.title, 'title', 120, { required: true }), b.format, pillar, b.method, b.workflowId ?? null, str(b.brief, 'brief', 4000), JSON.stringify(req), typeof b.deadline === 'string' ? b.deadline.slice(0, 25) : null, now, now)
    .run();
  await audit(db, 'production_created', `${b.brand}: ${b.title} (${pillar}/${b.method})`);
  return id;
}

export async function listProductions(db, brand) {
  const stmt = brand ? db.prepare('SELECT * FROM productions WHERE brand = ? ORDER BY updated_at DESC LIMIT 100').bind(brand) : db.prepare('SELECT * FROM productions ORDER BY updated_at DESC LIMIT 100');
  const rows = (await stmt.all()).results;
  const out = [];
  for (const p of rows) {
    const s = await db.prepare("SELECT COUNT(*) AS n, SUM(status = 'approved') AS approved FROM scenes WHERE production_id = ?").bind(p.id).first();
    out.push({ ...p, requirements: JSON.parse(p.requirements_json), requirements_json: undefined, scenes: s.n, approvedScenes: s.approved ?? 0 });
  }
  return out;
}

export async function getProduction(db, id) {
  const p = await db.prepare('SELECT * FROM productions WHERE id = ?').bind(id).first();
  if (!p) throw new HttpError(404, 'Production not found');
  const scenes = (await db.prepare('SELECT * FROM scenes WHERE production_id = ? ORDER BY ord').bind(id).all()).results.map(sceneOut);
  const assets = (await db.prepare('SELECT * FROM media_assets WHERE production_id = ? ORDER BY created_at DESC').bind(id).all()).results.map((a) => ({ ...a, metadata: JSON.parse(a.metadata_json), metadata_json: undefined }));
  const jobs = (await db.prepare('SELECT * FROM provider_jobs WHERE production_id = ? ORDER BY created_at DESC').bind(id).all()).results.map((j) => ({ ...j, request: JSON.parse(j.request_json), request_json: undefined, result: j.result_json ? JSON.parse(j.result_json) : null, result_json: undefined }));
  const voices = await listAssignments(db, 'project', id);
  const continuity = await continuityCheck(db, p, scenes);
  return { production: { ...p, requirements: JSON.parse(p.requirements_json), requirements_json: undefined }, scenes, assets, jobs, voices, continuity };
}
const sceneOut = (s) => ({ ...s, characters: JSON.parse(s.characters_json), voice: JSON.parse(s.voice_json), qc: s.qc_json ? JSON.parse(s.qc_json) : null, characters_json: undefined, voice_json: undefined, qc_json: undefined });

async function charactersByIds(db, ids) {
  const out = [];
  for (const id of ids) {
    const c = await db.prepare('SELECT * FROM characters WHERE id = ?').bind(id).first();
    if (c) out.push(c);
  }
  return out;
}

export async function addScene(db, productionId, b) {
  const p = await db.prepare('SELECT * FROM productions WHERE id = ?').bind(productionId).first();
  if (!p) throw new HttpError(404, 'Production not found');
  const chars = Array.isArray(b.characters) ? b.characters.slice(0, 10) : [];
  const found = await charactersByIds(db, chars);
  if (found.length !== chars.length) throw new HttpError(400, 'Unknown character id in characters');
  if (found.some((c) => c.brand !== p.brand)) throw new HttpError(400, 'Characters must belong to the production brand (brands stay isolated)');
  const voice = await sceneVoices(db, found, b.voice);
  const prompt = typeof b.prompt === 'string' && b.prompt.trim() ? str(b.prompt, 'prompt', 6000) : buildVideoPrompt(b.fields ?? {}, found);
  const ord = (await db.prepare('SELECT COALESCE(MAX(ord),0) + 1 AS n FROM scenes WHERE production_id = ?').bind(productionId).first()).n;
  const id = newId('sc');
  const now = nowIso();
  await db.batch([
    db.prepare(`INSERT INTO scenes (id, production_id, ord, title, prompt, characters_json, voice_json, status, version, created_at, updated_at) VALUES (?,?,?,?,?,?,?,'prompt_ready',1,?,?)`).bind(id, productionId, ord, str(b.title, 'title', 120, { required: true }), prompt, JSON.stringify(chars), JSON.stringify(voice), now, now),
    db.prepare('INSERT INTO scene_versions (id, scene_id, version, prompt, characters_json, voice_json, reason, created_at) VALUES (?,?,1,?,?,?,?,?)').bind(newId('sv'), id, prompt, JSON.stringify(chars), JSON.stringify(voice), 'created', now),
    db.prepare("UPDATE productions SET status = CASE status WHEN 'planning' THEN 'in_production' ELSE status END, updated_at = ? WHERE id = ?").bind(now, productionId),
  ]);
  return id;
}

/** Voice per character: the character's approved voice wins; explicit overrides must match it or are flagged. */
async function sceneVoices(db, chars, explicit = {}) {
  const out = {};
  for (const c of chars) {
    const a = (await listAssignments(db, 'character', c.id)).find((x) => x.role === 'main');
    const want = explicit?.[c.id];
    if (want && !profileById(want)) throw new HttpError(400, `Unknown voice profile ${want}`);
    out[c.id] = want ?? a?.profile_id ?? null;
  }
  return out;
}

/** Regenerates ONE scene: new version, keeps approved characters/voices unless explicitly changed. */
export async function regenerateScene(db, sceneId, b) {
  const s = await db.prepare('SELECT * FROM scenes WHERE id = ?').bind(sceneId).first();
  if (!s) throw new HttpError(404, 'Scene not found');
  const reason = str(b.reason, 'reason', 500, { required: true });
  const chars = Array.isArray(b.characters) ? b.characters.slice(0, 10) : JSON.parse(s.characters_json);
  const found = await charactersByIds(db, chars);
  if (found.length !== chars.length) throw new HttpError(400, 'Unknown character id in characters');
  const prevVoice = JSON.parse(s.voice_json);
  const voice = b.voice ? await sceneVoices(db, found, b.voice) : Object.fromEntries(chars.map((id) => [id, prevVoice[id] ?? null]));
  const changedVoices = Object.keys(voice).filter((k) => prevVoice[k] && voice[k] !== prevVoice[k]);
  if (changedVoices.length && !b.confirmVoiceChange) throw new HttpError(409, `This changes the established voice for ${changedVoices.join(', ')}. Resend with confirmVoiceChange: true.`);
  const prompt = typeof b.prompt === 'string' && b.prompt.trim() ? str(b.prompt, 'prompt', 6000) : b.fields ? buildVideoPrompt(b.fields, found) : s.prompt;
  const v = s.version + 1;
  const now = nowIso();
  await db.batch([
    db.prepare('INSERT INTO scene_versions (id, scene_id, version, prompt, characters_json, voice_json, reason, created_at) VALUES (?,?,?,?,?,?,?,?)').bind(newId('sv'), sceneId, v, prompt, JSON.stringify(chars), JSON.stringify(voice), reason, now),
    db.prepare("UPDATE scenes SET prompt = ?, characters_json = ?, voice_json = ?, version = ?, status = 'prompt_ready', qc_json = NULL, updated_at = ? WHERE id = ?").bind(prompt, JSON.stringify(chars), JSON.stringify(voice), v, now, sceneId),
  ]);
  await audit(db, 'scene_regenerated', `Scene ${s.title} → v${v}: ${reason}`, { sceneId, changedVoices });
  return { sceneId, version: v };
}

export async function sceneVersions(db, sceneId) {
  return (await db.prepare('SELECT * FROM scene_versions WHERE scene_id = ? ORDER BY version DESC').bind(sceneId).all()).results;
}

const SCENE_STATUSES = ['draft', 'prompt_ready', 'manual_generation', 'generated', 'approved', 'rejected'];
export async function setSceneStatus(db, sceneId, { status, qc }) {
  if (!SCENE_STATUSES.includes(status)) throw new HttpError(400, `status must be ${SCENE_STATUSES.join(', ')}`);
  const s = await db.prepare('SELECT * FROM scenes WHERE id = ?').bind(sceneId).first();
  if (!s) throw new HttpError(404, 'Scene not found');
  if (['generated', 'approved'].includes(status)) {
    const asset = await db.prepare("SELECT id FROM media_assets WHERE scene_id = ? AND kind = 'video' AND status IN ('registered','verified')").bind(sceneId).first();
    if (!asset) throw new HttpError(409, 'Register the generated video file for this scene first — a scene is not "generated" without a real output.');
  }
  if (qc !== undefined && (typeof qc !== 'object' || qc === null)) throw new HttpError(400, 'qc must be an object of checks');
  await db.prepare('UPDATE scenes SET status = ?, qc_json = COALESCE(?, qc_json), updated_at = ? WHERE id = ?').bind(status, qc ? JSON.stringify(qc).slice(0, 4000) : null, nowIso(), sceneId).run();
  await audit(db, 'scene_status', `Scene ${s.title}: ${s.status} → ${status}`);
}

/** Flags likely continuity problems. It cannot guarantee consistency in the generated video. */
export async function continuityCheck(db, production, scenes) {
  const issues = [];
  const req = JSON.parse(production.requirements_json ?? '{}');
  for (const s of scenes) {
    const chars = await charactersByIds(db, s.characters);
    for (const c of chars) {
      if (!c.approved) issues.push({ sceneId: s.id, level: 'warn', message: `${c.name} is not approved yet.` });
      if (JSON.parse(c.reference_assets_json).length === 0) issues.push({ sceneId: s.id, level: 'warn', message: `${c.name} has no reference images — the video model may drift between scenes.` });
      const a = (await listAssignments(db, 'character', c.id)).find((x) => x.role === 'main');
      if (a && s.voice[c.id] && s.voice[c.id] !== a.profile_id) issues.push({ sceneId: s.id, level: 'error', message: `${c.name} uses voice ${s.voice[c.id]} but the approved voice is ${a.profile_id}.` });
      if (!a) issues.push({ sceneId: s.id, level: 'info', message: `${c.name} has no approved voice yet.` });
      if (!s.prompt.includes(c.name)) issues.push({ sceneId: s.id, level: 'warn', message: `Prompt does not mention ${c.name}.` });
    }
    const voices = Object.values(s.voice).filter(Boolean);
    if (new Set(voices).size !== voices.length) issues.push({ sceneId: s.id, level: 'error', message: 'Two characters share the same voice in this scene.' });
    if (req.vocalRequirement === 'male_only' && voices.some((v) => profileById(v)?.gender === 'female')) issues.push({ sceneId: s.id, level: 'error', message: 'Male-only production uses a female voice.' });
    if (req.vocalRequirement === 'female_only' && voices.some((v) => profileById(v)?.gender === 'male')) issues.push({ sceneId: s.id, level: 'error', message: 'Female-only production uses a male voice.' });
  }
  return { ok: !issues.some((i) => i.level === 'error'), issues, note: 'Checks records and prompts only. Visual consistency of generated video depends on the model and must be reviewed by eye.' };
}

/* ---------------- media assets + provider jobs ---------------- */
const KINDS = ['image', 'video', 'audio', 'design', 'document', 'other'];
export async function registerAsset(db, b) {
  if (!KINDS.includes(b.kind)) throw new HttpError(400, `kind must be ${KINDS.join(', ')}`);
  const ref = str(b.externalRef, 'externalRef', 1000, { required: true });
  let brand = b.brand;
  if (b.productionId) {
    const p = await db.prepare('SELECT brand FROM productions WHERE id = ?').bind(b.productionId).first();
    if (!p) throw new HttpError(404, 'Production not found');
    brand = p.brand;
  }
  if (b.sceneId && !(await db.prepare('SELECT 1 FROM scenes WHERE id = ? AND production_id = ?').bind(b.sceneId, b.productionId ?? '').first())) throw new HttpError(400, 'sceneId must belong to productionId');
  const id = newId('ma');
  const now = nowIso();
  await db
    .prepare(`INSERT INTO media_assets (id, production_id, scene_id, brand, kind, provider, external_ref, status, metadata_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,'registered',?,?,?)`)
    .bind(id, b.productionId ?? null, b.sceneId ?? null, brandOf(brand), b.kind, str(b.provider, 'provider', 40, { required: true }), ref, JSON.stringify(b.metadata ?? {}).slice(0, 4000), now, now)
    .run();
  await audit(db, 'asset_registered', `${b.kind} from ${b.provider} (${brand})`, { id });
  return id;
}

export async function setAssetStatus(db, id, status) {
  if (!['registered', 'verified', 'missing', 'rejected'].includes(status)) throw new HttpError(400, 'status must be registered, verified, missing or rejected');
  const r = await db.prepare('UPDATE media_assets SET status = ?, updated_at = ? WHERE id = ?').bind(status, nowIso(), id).run();
  if (r.meta.changes !== 1) throw new HttpError(404, 'Asset not found');
  await audit(db, 'asset_status', `Asset ${id} → ${status}`);
}

/** Google Flow has no public API: a job is prepared as a manual handoff with exact steps. */
export async function prepareFlowHandoff(db, sceneId) {
  const s = await db.prepare('SELECT * FROM scenes WHERE id = ?').bind(sceneId).first();
  if (!s) throw new HttpError(404, 'Scene not found');
  const voice = JSON.parse(s.voice_json);
  const voiceNotes = Object.entries(voice).filter(([, v]) => v).map(([cid, v]) => `${cid}: ${v} — ${profileById(v)?.name ?? ''}`);
  const steps = [
    'Open Flow (labs.google/flow) with the Google account that has your Google AI Pro plan.',
    'Upload the approved character reference images for this scene (Character & Asset Library) as ingredients.',
    'Paste the scene prompt below. Keep the aspect ratio and duration from the prompt.',
    'Flow generates its own audio: the voice profiles below are direction only — Flow cannot be told to use them. For exact voices, generate speech separately and replace the audio in your editor.',
    'Download the clip, store it in your drive, and register its link here (Register output). Then mark the scene generated.',
  ];
  const id = newId('pj');
  const now = nowIso();
  await db
    .prepare(`INSERT INTO provider_jobs (id, provider, kind, production_id, scene_id, status, request_json, created_at, updated_at) VALUES (?,?,?,?,?,'manual_handoff',?,?,?)`)
    .bind(id, 'google_flow', 'video', s.production_id, sceneId, JSON.stringify({ prompt: s.prompt, sceneVersion: s.version, voiceDirection: voiceNotes, steps }), now, now)
    .run();
  await db.prepare("UPDATE scenes SET status = 'manual_generation', updated_at = ? WHERE id = ?").bind(now, sceneId).run();
  await audit(db, 'flow_handoff', `Prepared Flow handoff for scene ${s.title} v${s.version}`, { jobId: id });
  return { jobId: id, prompt: s.prompt, voiceDirection: voiceNotes, steps, automation: 'manual_handoff', reason: 'No public Google Flow API was found (checked 2026-10-14). Nothing is sent to Flow automatically.' };
}

export async function completeJob(db, jobId, { status, externalRef, error }) {
  const j = await db.prepare('SELECT * FROM provider_jobs WHERE id = ?').bind(jobId).first();
  if (!j) throw new HttpError(404, 'Job not found');
  if (!['succeeded', 'failed', 'cancelled'].includes(status)) throw new HttpError(400, 'status must be succeeded, failed or cancelled');
  if (['succeeded', 'failed', 'cancelled'].includes(j.status)) throw new HttpError(409, `Job is already ${j.status}`);
  let assetId = null;
  if (status === 'succeeded') {
    if (typeof externalRef !== 'string' || !externalRef.trim()) throw new HttpError(400, 'externalRef (link to the real output file) is required for a succeeded job');
    const p = await db.prepare('SELECT brand FROM productions WHERE id = ?').bind(j.production_id).first();
    assetId = await registerAsset(db, { kind: j.kind === 'audio' ? 'audio' : 'video', provider: j.provider, externalRef, productionId: j.production_id, sceneId: j.scene_id, brand: p?.brand ?? 'studio', metadata: { jobId } });
  }
  await db.prepare('UPDATE provider_jobs SET status = ?, result_json = ?, error = ?, updated_at = ? WHERE id = ?').bind(status, assetId ? JSON.stringify({ assetId, externalRef }) : null, error ? String(error).slice(0, 500) : null, nowIso(), jobId).run();
  if (status === 'succeeded' && j.scene_id) await db.prepare("UPDATE scenes SET status = 'generated', updated_at = ? WHERE id = ?").bind(nowIso(), j.scene_id).run();
  await audit(db, 'job_' + status, `${j.provider} ${j.kind} job ${jobId} ${status} (owner reported)`);
  return { jobId, status, assetId };
}

/* ---------------- learning progress ---------------- */
export async function learningProgress(db) {
  return (await db.prepare('SELECT * FROM learning_progress').all()).results;
}
export async function setLearning(db, moduleId, status) {
  if (typeof moduleId !== 'string' || !/^[a-z0-9_.-]{2,60}$/.test(moduleId)) throw new HttpError(400, 'Bad module id');
  if (!['not_started', 'in_progress', 'done'].includes(status)) throw new HttpError(400, 'status must be not_started, in_progress or done');
  await db.prepare('INSERT INTO learning_progress (module_id, status, updated_at) VALUES (?,?,?) ON CONFLICT(module_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at').bind(moduleId, status, nowIso()).run();
}
