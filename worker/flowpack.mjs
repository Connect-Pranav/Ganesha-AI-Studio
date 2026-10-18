// Flow pack (technical id: littleloop_flow_pack): turns a finished LittleLoop goal's step outputs
// (concept, character sheet, script, shot plan, per-shot prompts, sound, safety) into ONE
// self-contained Google Flow master prompt per reel, plus the names of the character sheets
// (as saved in Ganesha) to add as Flow ingredients. Written by Gemini; text only, nothing is generated
// or published. Sheet names are checked against the real uploaded sheets, never invented.
import { callProvider } from './providers.mjs';
import { HttpError, nowIso } from './util.mjs';

const STEP_KEYS = ['concept', 'characters', 'script', 'visual_plan', 'prompts', 'sound', 'safety'];
const MAX_INPUT_CHARS = 60_000;

export async function getFlowPack(db, workflowId) {
  const row = await db.prepare('SELECT * FROM flow_packs WHERE workflow_id = ?').bind(workflowId).first();
  return row ? { ...JSON.parse(row.pack_json), provider: row.provider, model: row.model, createdAt: row.created_at } : null;
}

async function gather(db, workflowId) {
  const wf = await db.prepare('SELECT id, title, brand, goal, status FROM workflows WHERE id = ?').bind(workflowId).first();
  if (!wf) throw new HttpError(404, 'Goal not found');
  if (wf.brand !== 'littleloop') throw new HttpError(400, 'Flow packs are for LittleLoop goals only');
  const tasks = (await db.prepare("SELECT id, step_key, agent_id, deliverable FROM tasks WHERE workflow_id = ? AND status = 'completed'").bind(workflowId).all()).results;
  const parts = [];
  for (const key of STEP_KEYS) {
    const t = tasks.find((x) => x.step_key === key);
    if (!t) continue;
    const art = await db.prepare('SELECT content_json FROM artifacts WHERE task_id = ? ORDER BY version DESC LIMIT 1').bind(t.id).first();
    if (!art) continue;
    let c;
    try {
      c = JSON.parse(art.content_json);
    } catch {
      continue;
    }
    const text = typeof c.deliverable === 'string' ? c.deliverable : typeof c.summary === 'string' ? `${c.summary}\n${JSON.stringify(c.issues ?? [])}` : '';
    if (text) parts.push({ key, deliverable: t.deliverable, text });
  }
  if (!parts.some((p) => p.key === 'prompts') && !parts.some((p) => p.key === 'script')) throw new HttpError(409, 'This goal has no finished script or video prompts yet.');
  const sheets = (await db.prepare("SELECT name, details, details_status FROM reel_sheets WHERE brand = 'littleloop' AND active = 1 ORDER BY name").all()).results;
  return { wf, parts, sheets };
}

function buildPrompt(wf, parts, sheets) {
  let budget = MAX_INPUT_CHARS;
  const blocks = [];
  for (const p of parts) {
    const t = p.text.slice(0, Math.max(0, Math.min(p.text.length, budget)));
    budget -= t.length;
    blocks.push(`## ${p.deliverable} (${p.key})\n${t}`);
  }
  const sheetList = sheets.length
    ? sheets.map((s) => `- "${s.name}"${s.details_status === 'ready' && s.details ? ` — ${String(s.details).replace(/\s+/g, ' ').slice(0, 300)}` : ''}`).join('\n')
    : '(none uploaded yet)';
  return [
    `Goal: ${wf.title}\n${wf.goal ?? ''}`,
    '# Agent outputs for this goal',
    blocks.join('\n\n'),
    '# Character sheets uploaded in the studio (exact names — use ONLY these names)',
    sheetList,
    '# Task',
    'Write ONE complete, self-contained Google Flow master prompt per reel planned above (Veo 3.1, vertical 9:16, 1080x1920).',
    'Each master prompt must contain, in order: format line (9:16 vertical, 1080x1920, total duration); visual style; the characters with locked look/outfit/palette taken from the character sheet output; "Character references:" naming which uploaded sheet image(s) to use; location, lighting and camera; a time-coded shot list covering the whole reel (e.g. 0-4s, 4-8s…) with action, camera move and exact dialogue/voice lines; sound/music direction; continuity rules; a deliberate final closing frame; and a "Do not include" line (no on-screen text, captions, logos, watermarks; child-safe, no unsafe actions).',
    'Apply every fix from the safety review. Keep prompts concrete and visual; no meta commentary.',
    'For "sheets": list ONLY names copied exactly from the uploaded list that match characters in that reel. If a character has no uploaded sheet, leave it out of "sheets" and say which character needs a sheet in "sheetNote".',
    'Return JSON: {"reels":[{"title":string,"durationSec":number,"sheets":[string],"sheetNote":string,"masterPrompt":string}],"notes":[string]}',
  ].join('\n\n');
}

export async function buildFlowPack(env, db, workflowId, { force = false } = {}, deps = {}) {
  if (!force) {
    const cached = await getFlowPack(db, workflowId);
    if (cached) return cached;
  }
  const { wf, parts, sheets } = await gather(db, workflowId);
  const system =
    'You are MAYA, the LittleLoop animation prompt engineer for a kids Instagram channel. You consolidate a team\'s planning into copy-paste-ready Google Flow prompts. Output strict JSON only.';
  const r = await callProvider(env, db, 'gemini', { system, prompt: buildPrompt(wf, parts, sheets), json: true, maxTokens: 12000, purpose: 'flow_pack', workflowId }, deps);
  const o = r.json;
  if (!o || !Array.isArray(o.reels) || !o.reels.length) throw new HttpError(502, 'Gemini returned no reels — try again.');
  const valid = new Map(sheets.map((s) => [s.name.toLowerCase(), s.name]));
  const reels = o.reels.slice(0, 10).map((x, i) => {
    const asked = Array.isArray(x.sheets) ? x.sheets.map(String) : [];
    const matched = [...new Set(asked.map((n) => valid.get(n.trim().toLowerCase())).filter(Boolean))];
    const unknown = asked.filter((n) => !valid.has(n.trim().toLowerCase()));
    const masterPrompt = String(x.masterPrompt ?? '').trim();
    if (masterPrompt.length < 200) throw new HttpError(502, `Reel ${i + 1} came back without a full prompt — try again.`);
    return {
      n: i + 1,
      title: String(x.title ?? `Reel ${i + 1}`).slice(0, 120),
      durationSec: Number.isFinite(Number(x.durationSec)) ? Number(x.durationSec) : null,
      sheets: matched,
      sheetNote: [String(x.sheetNote ?? '').trim(), unknown.length ? `Not found in the studio: ${unknown.join(', ')} — upload a sheet with that name.` : ''].filter(Boolean).join(' '),
      masterPrompt,
    };
  });
  const pack = { workflowId, title: wf.title, reels, notes: Array.isArray(o.notes) ? o.notes.map(String).slice(0, 8) : [], sheetsAvailable: sheets.map((s) => s.name) };
  const at = nowIso();
  await db
    .prepare('INSERT INTO flow_packs (workflow_id, pack_json, provider, model, created_at) VALUES (?,?,?,?,?) ON CONFLICT(workflow_id) DO UPDATE SET pack_json = excluded.pack_json, provider = excluded.provider, model = excluded.model, created_at = excluded.created_at')
    .bind(workflowId, JSON.stringify(pack), r.provider, r.model, at)
    .run();
  return { ...pack, provider: r.provider, model: r.model, createdAt: at };
}
