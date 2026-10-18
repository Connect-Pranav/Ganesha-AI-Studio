// Character Sheet Agent (technical id: littleloop_chitra_sheet_agent) — the owner's
// "Character Sheet Generator & Library Manager" skill:
//   1. read the story → character inventory
//   2. search the uploaded character-sheet library FIRST (exact saved names)
//   3. reuse existing sheets; for missing ones write the full Gemini model-sheet prompt
// Image generation is NOT done here: Gemini API image models have no free tier, so the prompt is
// handed to the owner for the Gemini app (Google AI Pro) and the result is uploaded back by name.
// Nothing is claimed as generated or saved unless it really was.
import { callProvider } from './providers.mjs';
import { HttpError, newId, nowIso } from './util.mjs';

const STYLES = {
  '3d': 'High-quality stylized 3D CGI for a premium children\'s animated feature. Soft rounded geometry, appealing proportions, tactile yet polished materials, subtle surface detail, beautiful soft studio lighting, gentle ambient occlusion, clean silhouettes, expressive eyes, and consistent rendering. Bright, harmonious colors. Suitable for children aged 2–8.',
  '2d': 'Clean, premium 2D children\'s animation style: crisp consistent line work, flat cel shading with soft secondary shading, appealing rounded shapes, expressive eyes, bright harmonious colors. Suitable for children aged 2–8.',
  clay: 'Premium stop-motion clay (plasticine) style: soft hand-made clay surfaces with subtle fingerprints, rounded forms, warm soft studio lighting, gentle shadows, bright harmonious colors. Suitable for children aged 2–8.',
};
export const SHEET_STYLES = Object.keys(STYLES);

/** The owner's standard Gemini model-sheet prompt, filled with one character's approved spec. */
export function sheetPrompt({ project, style, c }) {
  const list = (a) => (Array.isArray(a) && a.length ? a.map(String) : []);
  const expressions = list(c.expressions);
  const poses = list(c.poses);
  const palette = Array.isArray(c.palette) ? c.palette.filter((p) => p && p.name) : [];
  return [
    `Generate a premium professional ${style === '2d' ? '2D' : style === 'clay' ? 'clay-style' : '3D'} character model sheet for a children's animated film. This is a CHARACTER REFERENCE BOARD, not a cinematic scene.`,
    `PROJECT: ${project}`,
    `CHARACTER NAME: ${c.name}`,
    `CHARACTER DESCRIPTION:\n${c.description}`,
    `VISUAL STYLE:\n${STYLES[style] ?? STYLES['3d']}`,
    'LAYOUT — INCLUDE ALL SECTIONS:',
    '1. MAIN CHARACTER PORTRAIT\n   One large, attractive hero pose with the full silhouette visible and a signature expression.',
    '2. TURNAROUND VIEWS\n   Show the exact same character from the front, side, and back. Maintain identical anatomy, body proportions, markings, colors, materials, clothing, and accessories.',
    `3. SIZE AND PROPORTION GUIDE\n   ${c.proportions || "Show the character's intended scale and relative proportions with a simple, clear proportion reference."}`,
    `4. FACIAL EXPRESSION SHEET\n   Show these distinct expressions: ${expressions.length >= 6 ? expressions.join(', ') : 'happy, excited, curious, sad or concerned, hesitant or thoughtful, empathetic, and joyful'}. Keep the underlying face and identity unchanged.`,
    `5. ACTION POSES\n   Show these full-body poses: ${poses.length >= 6 ? poses.join('; ') : "its signature movement, walking or moving, looking up, interacting with another character, an emotional pose, and a final celebratory pose"}. Keep the anatomy consistent.`,
    `6. COLOR PALETTE\n   Display clean swatches with HEX labels: ${palette.length ? palette.map((p) => `${p.name}${p.hex ? ` ${p.hex}` : ''}`).join(', ') : 'main body, shadows, outlines, eyes, accents, clothing/accessories'}.`,
    `7. SUPPORTING DETAILS\n   ${c.details || 'Include any distinctive accessories, markings or special features needed to reproduce the character accurately.'}`,
    'COMPOSITION:\nProfessional animation-studio model sheet, white or very light neutral background, clearly separated rounded panels, balanced spacing, straight-on model views, consistent scale, readable view labels, minimal typography, no unnecessary decoration. The character must be large enough to inspect in every panel.',
    'IDENTITY LOCK:\nEvery panel must depict the same character. Do not invent alternate costumes, different faces, additional limbs, new markings, changing colors, or unexplained proportions. The turnaround views, expressions, and action poses must be faithful variations of one approved design.',
    'IMPORTANT:\nThis is a reusable production reference for generating multiple video clips. Visual continuity is more important than adding decorative detail. Prioritize correct character anatomy, clear silhouettes, readable expressions, and consistent colors.',
    'OUTPUT:\nOne complete, high-resolution character sheet image suitable for use as a visual reference in Google Flow and other AI video-generation tools. Do not generate a poster, story scene, collage of unrelated characters, or a collection of different character designs. Generate a structured character model sheet only.',
  ].join('\n\n');
}

export async function sheetLibrary(db) {
  return (await db.prepare("SELECT id, name, details, details_status, active, updated_at FROM reel_sheets WHERE brand = 'littleloop' ORDER BY name").all()).results;
}

/** Library section for agent prompts (CHITRA in pipelines). */
export function libraryText(sheets) {
  if (!sheets.length) return 'No character sheets uploaded yet — every character is missing.';
  return sheets
    .map((s) => `- "${s.name}"${s.active ? '' : ' (paused)'}${s.details_status === 'ready' && s.details ? ` — ${String(s.details).replace(/\s+/g, ' ').slice(0, 400)}` : ' — (not read yet; judge by name)'}`)
    .join('\n');
}

export async function listPlans(db, limit = 10) {
  return (await db.prepare('SELECT * FROM sheet_plans ORDER BY created_at DESC LIMIT ?').bind(limit).all()).results.map((r) => ({ id: r.id, project: r.project, createdAt: r.created_at, model: r.model, ...JSON.parse(r.plan_json) }));
}

export async function planSheets(env, db, { story, project, style = '3d' } = {}, deps = {}) {
  story = String(story ?? '').trim();
  project = String(project ?? '').trim().slice(0, 120) || 'LittleLoop';
  if (story.length < 20) throw new HttpError(400, 'Paste the story, script or scene list (at least a few lines).');
  if (story.length > 30_000) throw new HttpError(400, 'Story is too long (max 30,000 characters).');
  if (!SHEET_STYLES.includes(style)) throw new HttpError(400, `style must be one of ${SHEET_STYLES.join(', ')}`);
  const sheets = await sheetLibrary(db);
  const system =
    'You are CHITRA, the Character Design and Continuity Agent for LittleLoop (kids 2–8). Search the provided character-sheet library FIRST and reuse existing designs; never redesign an existing character. Original characters only — never copy known franchise characters. Output strict JSON only.';
  const prompt = [
    `PROJECT: ${project}\nREQUESTED STYLE: ${style}`,
    `# Story / script\n${story}`,
    `# Character-sheet library (uploaded, approved — use EXACT names)\n${libraryText(sheets)}`,
    '# Task',
    '1. Inventory every main character and every recurring supporting character (animals, creatures, people, personified objects).',
    '2. For each, decide: "existing" if a library sheet clearly is this character (give its exact name), "uncertain" if a sheet might match but you cannot tell, else "missing".',
    '3. For missing/uncertain characters write a full design spec taken from the story (do not invent conflicting details): description (body shape, size/age, colors, face, materials, clothing, accessories, personality, distinctive features), proportions guide, at least 6 expressions, at least 6 action poses suited to the anatomy, palette with HEX values, supporting details.',
    '4. Continuity rules that must hold across all clips.',
    'Return JSON: {"characters":[{"name":string,"role":"main"|"supporting","status":"existing"|"missing"|"uncertain","librarySheet":string|null,"reason":string,"description":string,"proportions":string,"expressions":[string],"poses":[string],"palette":[{"name":string,"hex":string}],"details":string}],"continuity":[string],"notes":[string]}',
  ].join('\n\n');
  const r = await callProvider(env, db, 'gemini', { system, prompt, json: true, maxTokens: 10000, purpose: 'sheet_agent' }, deps);
  const o = r.json;
  if (!o || !Array.isArray(o.characters) || !o.characters.length) throw new HttpError(502, 'Gemini returned no characters — try again.');
  const byName = new Map(sheets.map((s) => [s.name.toLowerCase(), s]));
  const HEX = /^#[0-9a-f]{6}$/i;
  const characters = o.characters.slice(0, 12).map((c) => {
    const name = String(c.name ?? '').trim().slice(0, 60) || 'Unnamed';
    const wanted = c.librarySheet ? String(c.librarySheet).trim() : '';
    const sheet = wanted ? byName.get(wanted.toLowerCase()) : null;
    // A claimed match that is not really in the library is downgraded — never trust an invented name.
    let status = ['existing', 'missing', 'uncertain'].includes(c.status) ? c.status : 'uncertain';
    let reason = String(c.reason ?? '').slice(0, 400);
    if (status === 'existing' && !sheet) {
      status = 'missing';
      reason = `${reason} (the named sheet "${wanted}" is not in the library)`.trim();
    }
    const spec = {
      name,
      role: c.role === 'supporting' ? 'supporting' : 'main',
      status,
      librarySheet: sheet ? { id: sheet.id, name: sheet.name } : null,
      reason,
      description: String(c.description ?? '').slice(0, 3000),
      proportions: String(c.proportions ?? '').slice(0, 600),
      expressions: Array.isArray(c.expressions) ? c.expressions.map(String).slice(0, 10) : [],
      poses: Array.isArray(c.poses) ? c.poses.map(String).slice(0, 10) : [],
      palette: Array.isArray(c.palette) ? c.palette.filter((p) => p && p.name).map((p) => ({ name: String(p.name).slice(0, 40), hex: HEX.test(String(p.hex ?? '')) ? String(p.hex).toUpperCase() : null })).slice(0, 12) : [],
      details: String(c.details ?? '').slice(0, 1000),
    };
    // Reuse means no new prompt; missing/uncertain get the owner's standard Gemini sheet prompt.
    return { ...spec, geminiPrompt: status === 'existing' ? null : sheetPrompt({ project, style, c: spec }) };
  });
  const plan = { style, characters, continuity: Array.isArray(o.continuity) ? o.continuity.map(String).slice(0, 15) : [], notes: Array.isArray(o.notes) ? o.notes.map(String).slice(0, 8) : [], librarySize: sheets.length };
  const id = newId('sheetplan');
  const at = nowIso();
  await db.prepare('INSERT INTO sheet_plans (id, brand, project, plan_json, provider, model, created_at) VALUES (?,?,?,?,?,?,?)').bind(id, 'littleloop', project, JSON.stringify(plan), r.provider, r.model, at).run();
  return { id, project, createdAt: at, model: r.model, ...plan };
}
