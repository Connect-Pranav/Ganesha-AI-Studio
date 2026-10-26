// Ganesha Brain — skills library. A skill is a reusable method (instructions + quality bar) that any
// agent can apply: in chat by starting a message with /<skill-id>, or in a mission step chosen by the
// planner. Built-in skills are seeded once; the owner can edit them or add his own.
import { HttpError, nowIso } from '../util.mjs';
import { BRANDS } from './memory.mjs';

export const BUILTIN_SKILLS = [
  {
    id: 'reel-script',
    name: 'LittleLoop reel script',
    brand: 'littleloop',
    description: 'A 20-second kids reel as 2 × 10 s scenes with timings, action, dialogue and a clear last frame.',
    instructions: `Write for children aged 2–8: kind, safe, simple words, one clear emotion.
Output: title; hook (first 2 s); Scene 1 (0–10 s) and Scene 2 (10–20 s), each with characters (from the character sheets named), setting, time-coded action, exact dialogue or narration, sound; final frame (a deliberate ending card with a gentle call to share).
Keep characters, outfits and setting identical across both scenes. No text, logos or captions inside the footage — typography is added in the edit. Original story only.`,
  },
  {
    id: 'flow-video-prompt',
    name: 'Google Flow master prompt',
    brand: 'studio',
    description: 'ONE complete copy-paste video prompt (all scenes, timings, continuity, ending) for Google Flow / Veo.',
    instructions: `Return exactly one self-contained prompt in a code block, then at most 3 short notes outside it.
The prompt states: vertical 9:16 1080×1920; duration per scene; which reference image/sheet to attach; locked character look (face, hair, outfit, proportions), location, props, lighting, camera, grading and audio across scenes; time-coded action; exact dialogue; prohibited elements (no on-screen text, captions, logos, extra characters); the final frame.
Do not overload short scenes. Never promise the result; say what to inspect after generating (ratio, identity, wardrobe, background, movement, audio, ending).`,
  },
  {
    id: 'yt-seo',
    name: 'Sunverse YouTube SEO pack',
    brand: 'sunverse',
    description: 'Title options, description, chapters, tags and hashtags for a Sunverse song or Short.',
    instructions: `Give: 3 title options (≤ 60 chars, mood + language + hook), a description (first 2 lines carry the hook and keywords; credits: Singer — KoBhit, Lyrics — COCO; made with Suno), chapters if longer than 1 min, 10–15 tags, 3–5 hashtags, a pinned-comment question, and a Shorts cut idea.
Keywords must be plausible for the song's genre and language; mark guesses as guesses. No clickbait that the video does not deliver.`,
  },
  {
    id: 'song-lyrics',
    name: 'Sunverse song + Suno prompt',
    brand: 'sunverse',
    description: 'Original Hinglish/Hindi lyrics with structure tags and a matching Suno style prompt.',
    instructions: `Write fully original lyrics (never reuse lines from existing songs). Structure with tags: [Intro] [Verse 1] [Pre-Chorus] [Chorus] [Verse 2] [Chorus] [Bridge] [Final Chorus] [Outro]. Keep the chorus singable and repeatable.
Then a Suno style prompt (≤ 200 chars): genre, mood, tempo/BPM, instruments, vocal type — no artist names.
Then a cover-art brief in the Sunverse style: watercolor anime scene matching the song's mood, no text in the art.`,
  },
  {
    id: 'research-brief',
    name: 'Research brief with sources',
    brand: 'studio',
    description: 'A short, decision-ready research brief where every claim has a source or is marked as a hypothesis.',
    instructions: `Structure: question; 3–6 key findings (each with a source URL from the provided evidence, or labelled "hypothesis"); what it means for the brand; 3 recommended actions ranked by impact/effort; open questions.
Never invent numbers or sources. If there is no evidence, say so plainly.`,
  },
  {
    id: 'outreach-draft',
    name: 'Honest outreach draft',
    brand: 'studio',
    description: 'A short, personal partnership/customer message that waits for owner approval before sending.',
    instructions: `≤ 120 words. One specific, verified reason you chose them; one concrete idea or offer; one easy next step; a clear opt-out line ("If this isn't relevant, just reply 'no thanks'").
No fake familiarity, no exaggerated claims, no pressure. Subject line under 50 characters. Mark it DRAFT — it is sent only after the owner approves.`,
  },
  {
    id: 'landing-copy',
    name: 'Foliocraft conversion copy',
    brand: 'foliocraft',
    description: 'Landing/pricing copy for Foliocraft portfolio themes that turns visitors into buyers.',
    instructions: `Give: hero headline + subline, 3 benefit blocks (outcome-first), social-proof placeholders clearly marked [ADD REAL TESTIMONIAL], pricing section copy with what each tier includes, an FAQ (5 questions), and primary/secondary CTA text.
Plain, confident language. No fake numbers, reviews or scarcity.`,
  },
  {
    id: 'code-review',
    name: 'CODE-SHAKTI code review',
    brand: 'studio',
    description: 'A practical review: bugs first, then security, performance and simplifications, with exact fixes.',
    instructions: `Order: correctness bugs → security (secrets, injection, auth) → data loss risks → performance → readability. For each: file/area, the problem in one line, the fix as a small code snippet.
For GitHub Pages projects keep ES5-compatible vanilla JS (no arrow functions, no const in loops) and a single index.html unless told otherwise. Say what you could not check.`,
  },
  {
    id: 'weekly-report',
    name: 'Weekly brand report',
    brand: 'studio',
    description: 'What happened this week, what worked, what did not, and next week’s 3 priorities.',
    instructions: `Sections: headline (one line), numbers (only from provided facts — never invent), wins, misses and why, lessons, next week's top 3 priorities with owner and expected outcome.
Short bullets. Add LESSON: lines for anything the studio should remember.`,
  },
];

const ID_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;

// INSERT OR IGNORE: cheap, keeps the owner's edits, and re-creates built-ins on a fresh database.
async function seed(db) {
  const now = nowIso();
  await db.batch(
    BUILTIN_SKILLS.map((s) =>
      db.prepare('INSERT OR IGNORE INTO brain_skills (id, name, description, instructions, brand, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').bind(s.id, s.name, s.description, s.instructions, s.brand, now, now),
    ),
  );
}

export async function listSkills(db) {
  await seed(db);
  const rows = (await db.prepare('SELECT * FROM brain_skills ORDER BY uses DESC, name').all()).results;
  const builtin = new Set(BUILTIN_SKILLS.map((s) => s.id));
  return rows.map((r) => ({ ...r, builtin: builtin.has(r.id) }));
}

export async function getSkill(db, id) {
  if (!id) return null;
  await seed(db);
  return db.prepare('SELECT * FROM brain_skills WHERE id = ?').bind(id).first();
}

export async function saveSkill(db, { id, name, description, instructions, brand = 'studio' }) {
  const sid = String(id ?? '').trim().toLowerCase();
  if (!ID_RE.test(sid)) throw new HttpError(400, 'id must be 2–40 lowercase letters, numbers or dashes (it becomes /id in chat)');
  for (const [k, v, max] of [['name', name, 80], ['description', description, 300], ['instructions', instructions, 4000]]) {
    if (typeof v !== 'string' || v.trim().length < 3 || v.length > max) throw new HttpError(400, `${k} must be 3–${max} chars`);
  }
  if (brand !== 'studio' && !BRANDS.includes(brand)) throw new HttpError(400, 'brand must be studio or a brand id');
  await seed(db);
  const now = nowIso();
  await db
    .prepare('INSERT INTO brain_skills (id, name, description, instructions, brand, created_at, updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, instructions = excluded.instructions, brand = excluded.brand, updated_at = excluded.updated_at')
    .bind(sid, name.trim(), description.trim(), instructions.trim(), brand, now, now)
    .run();
  return { id: sid };
}

export async function deleteSkill(db, id) {
  if (BUILTIN_SKILLS.some((s) => s.id === id)) throw new HttpError(400, 'Built-in skills can be edited but not deleted');
  const r = await db.prepare('DELETE FROM brain_skills WHERE id = ?').bind(id).run();
  if (!r.meta?.changes) throw new HttpError(404, 'Skill not found');
  return { ok: true };
}

export async function useSkill(db, id) {
  await db.prepare('UPDATE brain_skills SET uses = uses + 1 WHERE id = ?').bind(id).run().catch(() => {});
}

/** Skills that fit a brand (its own + studio-wide), as a short catalog line list. */
export async function catalog(db, brand = 'studio') {
  const all = await listSkills(db);
  return all
    .filter((s) => s.brand === 'studio' || brand === 'studio' || s.brand === brand)
    .map((s) => `/${s.id} — ${s.description}`)
    .join('\n');
}

/** "/reel-script make one about rain" → { skill, rest } when the id exists. */
export async function parseSkillCommand(db, message) {
  const m = /^\/([a-z0-9][a-z0-9-]{1,39})\b\s*([\s\S]*)$/.exec(String(message ?? '').trim());
  if (!m) return { skill: null, rest: message };
  const skill = await getSkill(db, m[1]);
  return skill ? { skill, rest: m[2].trim() || `Apply the ${skill.name} skill.` } : { skill: null, rest: message };
}

export const skillBlock = (skill) => `ACTIVE SKILL — ${skill.name} (/${skill.id}). Follow this method exactly:\n${skill.instructions}`;
