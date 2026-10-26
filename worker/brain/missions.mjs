// Ganesha Brain — missions: one goal → THINK → PLAN → (owner approves) → EXECUTE step by step → VERIFY →
// result, lessons saved to memory, delivered to the connectors the owner ticked.
// One step runs per advance() call, so it fits a request or a cron tick. Steps are claimed atomically,
// so the UI and the 5-minute cron never run the same step twice.
import { REGISTRY, agentById } from '../agents.mjs';
import { HttpError, newId, nowIso } from '../util.mjs';
import { parseJsonOutput } from '../providers.mjs';
import { BRANDS, brandOf, memoryFor, saveFacts } from './memory.mjs';
import { catalog, getSkill, skillBlock, useSkill } from './skills.mjs';
import { callRouted, engineOrder } from './router.mjs';
import { TARGETS, deliverMission } from './deliver.mjs';

const MAX_STEPS = 6;
const MAX_STEP_ATTEMPTS = 2; // a step whose check fails is redone once with the reviewer's note
const MAX_ERROR_ATTEMPTS = 3; // engine errors
const STEP_OUT = 12_000;
const CONTEXT = 12_000;
const STALE_MS = 10 * 60_000;
const FINALIZING = '__finalizing__';

const RULES = `Studio rules: original work only (no copied lyrics, scripts, characters or art); never invent numbers, results or sources — mark guesses as hypotheses; never include the owner's personal identity in brand output; LittleLoop content is for children 2–8 and must be safe and kind; you prepare work only — nothing is published, sent, spent or deployed without the owner's approval.`;

const clip = (s, n) => (String(s ?? '').length > n ? `${String(s).slice(0, n)}\n…[truncated]` : String(s ?? ''));
const roster = () => REGISTRY.agents.map((a) => `${a.id} — ${a.name}: ${a.role} [${REGISTRY.teams?.[a.team]?.brand ?? a.team}]`).join('\n');

function rowOut(m) {
  if (!m) return m;
  const { criteria_json, deliver_json, ...r } = m;
  return { ...r, result: r.result === FINALIZING ? null : r.result, criteria: JSON.parse(criteria_json || '[]'), deliver: JSON.parse(deliver_json || '[]') };
}

export async function getMission(db, id) {
  const m = await db.prepare('SELECT * FROM missions WHERE id = ?').bind(id).first();
  if (!m) throw new HttpError(404, 'Mission not found');
  const steps = (await db.prepare('SELECT * FROM mission_steps WHERE mission_id = ? ORDER BY idx').bind(id).all()).results.map(({ check_json, ...s }) => ({ ...s, check: check_json ? JSON.parse(check_json) : null, agent_name: agentById(s.agent_id)?.name ?? s.agent_id }));
  const deliveries = (await db.prepare('SELECT target, status, url, message, created_at FROM mission_deliveries WHERE mission_id = ? ORDER BY created_at').bind(id).all()).results;
  return { ...rowOut(m), steps, deliveries };
}

export async function listMissions(db, limit = 30) {
  const rows = (await db.prepare('SELECT * FROM missions ORDER BY created_at DESC LIMIT ?').bind(limit).all()).results;
  const counts = (await db.prepare('SELECT mission_id, COUNT(*) AS n, SUM(CASE WHEN status = \'done\' THEN 1 ELSE 0 END) AS done FROM mission_steps GROUP BY mission_id').all()).results;
  const by = new Map(counts.map((c) => [c.mission_id, c]));
  return rows.map((m) => ({ ...rowOut(m), stepsTotal: by.get(m.id)?.n ?? 0, stepsDone: by.get(m.id)?.done ?? 0 }));
}

/* ---------------- THINK + PLAN ---------------- */
export async function createMission(env, db, { goal, brand = 'studio', deliver = [] }, deps = {}) {
  const g = String(goal ?? '').trim();
  if (g.length < 8) throw new HttpError(400, 'Describe the goal in a sentence or two');
  if (g.length > 2000) throw new HttpError(400, 'goal max 2000 chars');
  if (brand !== 'studio' && !BRANDS.includes(brand)) throw new HttpError(400, 'brand must be littleloop, sunverse, foliocraft or studio');
  const targets = validTargets(deliver);
  const id = newId('msn');
  const now = nowIso();
  await db.prepare("INSERT INTO missions (id, goal, brand, status, deliver_json, created_at, updated_at) VALUES (?,?,?, 'planning', ?, ?, ?)").bind(id, g, brand, JSON.stringify(targets), now, now).run();

  const remembered = await memoryFor(db, { brand });
  const system = `You are GANESHA, master orchestrator of Ganesha AI Studio (brands: LittleLoop — kids' animated Instagram Reels; Sunverse — YouTube music channel; Foliocraft — portfolio builder). You THINK about a goal, then PLAN it as a short chain of steps, each done by the best agent of the team.

THE TEAM (use these exact ids):
${roster()}

SKILLS any step may use (optional, by id):
${await catalog(db, brand)}

${remembered ? `WHAT THE STUDIO REMEMBERS:\n${remembered}\n` : ''}
${RULES}

Return JSON only:
{"thinking":"<3-6 sentences: what success looks like, key risks, why this order>","criteria":["<2-4 checkable success criteria>"],"steps":[{"agent":"<agent id>","title":"<short>","instruction":"<what exactly to produce, using earlier steps' output>","skill":"<skill id or null>"}]}
Rules: 2–${MAX_STEPS} steps; each step produces a concrete written deliverable; research before creation; end with a review step (chitragupta_quality_audit, or ops_dharma_safety for children's content) when the output will be used publicly; only agents of this brand, the master team or ops.`;
  try {
    const r = await callRouted(env, db, await engineOrder(env, db, { kind: 'plan' }), { system, prompt: `GOAL (${brand}): ${g}`, json: true, maxTokens: 3000, purpose: 'brain_plan' }, deps);
    const plan = r.json ?? parseJsonOutput(r.text);
    const steps = await validSteps(db, plan.steps, brand);
    if (!steps.length) throw new Error('The plan had no usable steps');
    await db.batch([
      ...steps.map((s, i) =>
        db.prepare("INSERT INTO mission_steps (id, mission_id, idx, agent_id, title, instruction, skill_id, status) VALUES (?,?,?,?,?,?,?, 'pending')").bind(newId('mst'), id, i, s.agent, s.title, s.instruction, s.skill),
      ),
      db
        .prepare("UPDATE missions SET status = 'awaiting_approval', thinking = ?, criteria_json = ?, engine = ?, updated_at = ? WHERE id = ?")
        .bind(clip(plan.thinking, 2000), JSON.stringify((Array.isArray(plan.criteria) ? plan.criteria : []).slice(0, 6).map((c) => String(c).slice(0, 200))), `${r.provider} · ${r.model}`, nowIso(), id),
    ]);
  } catch (e) {
    await db.prepare("UPDATE missions SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").bind(`Planning failed: ${String(e.message).slice(0, 400)}`, nowIso(), id).run();
  }
  return getMission(db, id);
}

function validTargets(deliver) {
  if (!Array.isArray(deliver)) throw new HttpError(400, 'deliver must be a list');
  const bad = deliver.filter((t) => !TARGETS[t]);
  if (bad.length) throw new HttpError(400, `Unknown destination: ${bad.join(', ')}`);
  return [...new Set(deliver)];
}

async function validSteps(db, steps, brand) {
  if (!Array.isArray(steps)) return [];
  const out = [];
  for (const s of steps.slice(0, MAX_STEPS)) {
    const a = agentById(String(s?.agent ?? '').trim());
    if (!a) continue;
    const b = REGISTRY.teams?.[a.team]?.brand;
    if (brand !== 'studio' && b !== 'studio' && b !== brand) continue; // keep brands isolated
    const title = String(s.title ?? '').trim().slice(0, 120);
    const instruction = String(s.instruction ?? '').trim().slice(0, 2000);
    if (!title || !instruction) continue;
    const skill = s.skill && (await getSkill(db, String(s.skill))) ? String(s.skill) : null;
    out.push({ agent: a.id, title, instruction, skill });
  }
  return out;
}

/* ---------------- approval ---------------- */
export async function decideMission(db, id, { decision, deliver }) {
  const m = await db.prepare('SELECT status FROM missions WHERE id = ?').bind(id).first();
  if (!m) throw new HttpError(404, 'Mission not found');
  if (decision === 'cancel') {
    if (!['awaiting_approval', 'running', 'planning'].includes(m.status)) throw new HttpError(409, `Mission is ${m.status}`);
    await db.prepare("UPDATE missions SET status = 'cancelled', updated_at = ?, finished_at = ? WHERE id = ?").bind(nowIso(), nowIso(), id).run();
    return { status: 'cancelled' };
  }
  if (m.status !== 'awaiting_approval') throw new HttpError(409, `Mission is ${m.status}, not waiting for approval`);
  if (decision === 'reject') {
    await db.prepare("UPDATE missions SET status = 'rejected', updated_at = ?, finished_at = ? WHERE id = ?").bind(nowIso(), nowIso(), id).run();
    return { status: 'rejected' };
  }
  if (decision !== 'approve') throw new HttpError(400, 'decision must be approve, reject or cancel');
  const sets = deliver === undefined ? [] : [JSON.stringify(validTargets(deliver))];
  await db
    .prepare(`UPDATE missions SET status = 'running', ${sets.length ? 'deliver_json = ?, ' : ''}updated_at = ? WHERE id = ? AND status = 'awaiting_approval'`)
    .bind(...sets, nowIso(), id)
    .run();
  return { status: 'running' };
}

/* ---------------- EXECUTE + VERIFY ---------------- */
function stepSystem(agent, mission, memory, skill) {
  return [
    `You are ${agent.name} (${agent.id}), ${agent.role} at Ganesha AI Studio, working on one step of a mission led by GANESHA.`,
    `Your craft: ${agent.mission}`,
    agent.limits ? `Limits: ${agent.limits}` : '',
    RULES,
    memory ? `WHAT THE STUDIO REMEMBERS (follow it):\n${memory}` : '',
    skill ? skillBlock(skill) : '',
    'Produce the finished deliverable for your step in Markdown — complete and usable, not a description of what you would do. If something essential is missing, make a sensible, clearly-labelled assumption and continue.',
    'If you learn something the studio should remember next time, end with up to 2 lines: LESSON: <one short lesson>.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

async function verify(env, db, mission, step, output, deps) {
  const engines = await engineOrder(env, db, { kind: 'check' });
  if (!engines.length) return { pass: true, note: 'No engine for checking — not verified', skipped: true };
  try {
    const r = await callRouted(
      env,
      db,
      engines,
      {
        system: `You are CHITRAGUPTA, the strict quality checker of Ganesha AI Studio. Judge whether a step's output does what was asked, is complete and usable, follows the studio rules, and invents no facts. ${RULES}\nReturn JSON only: {"pass":true|false,"score":1-10,"note":"<one or two sentences: what is missing or wrong, or why it passes>"}`,
        prompt: `MISSION GOAL: ${mission.goal}\nSUCCESS CRITERIA: ${(JSON.parse(mission.criteria_json || '[]')).join('; ') || '—'}\n\nSTEP: ${step.title}\nINSTRUCTION: ${step.instruction}\n\nOUTPUT:\n${clip(output, 8000)}`,
        json: true,
        maxTokens: 400,
        purpose: 'brain_check',
      },
      deps,
    );
    const v = r.json ?? parseJsonOutput(r.text);
    return { pass: v.pass === true, score: Number(v.score) || null, note: String(v.note ?? '').slice(0, 400), engine: r.provider };
  } catch (e) {
    return { pass: true, note: `Check could not run (${String(e.message).slice(0, 120)}) — not verified`, skipped: true };
  }
}

/** Runs ONE thing: the next pending step, or the final synthesis + deliveries. Returns the mission. */
export async function advance(env, db, id, deps = {}) {
  const m = await db.prepare('SELECT * FROM missions WHERE id = ?').bind(id).first();
  if (!m) throw new HttpError(404, 'Mission not found');
  if (m.status !== 'running') return getMission(db, id);
  const steps = (await db.prepare('SELECT * FROM mission_steps WHERE mission_id = ? ORDER BY idx').bind(id).all()).results;
  if (steps.some((s) => s.status === 'failed')) return getMission(db, id);
  const next = steps.find((s) => s.status === 'pending');
  if (!next) {
    if (steps.some((s) => s.status === 'running')) return getMission(db, id); // another run is on it
    await finalize(env, db, m, steps, deps);
    return getMission(db, id);
  }
  // Claim the step (no double runs).
  const claim = await db.prepare("UPDATE mission_steps SET status = 'running', attempts = attempts + 1, started_at = ? WHERE id = ? AND status = 'pending'").bind(nowIso(), next.id).run();
  if (!claim.meta?.changes) return getMission(db, id);
  const attempts = next.attempts + 1;
  const agent = agentById(next.agent_id);
  const skill = next.skill_id ? await getSkill(db, next.skill_id) : null;
  if (skill) await useSkill(db, skill.id);
  const memory = await memoryFor(db, { agentId: agent.id, brand: m.brand === 'studio' ? brandOf(agent) : m.brand });
  const prior = steps.filter((s) => s.idx < next.idx && s.status === 'done');
  let context = '';
  for (const s of prior.slice().reverse()) {
    const piece = `### Step ${s.idx + 1} — ${s.title} (${agentById(s.agent_id)?.name ?? s.agent_id})\n${s.output ?? ''}\n\n`;
    if (context.length + piece.length > CONTEXT) {
      context = `${clip(piece, Math.max(800, CONTEXT - context.length))}\n\n${context}`;
      break;
    }
    context = piece + context;
  }
  const lastCheck = next.check_json ? JSON.parse(next.check_json) : null;
  const prompt = [
    `MISSION GOAL (${m.brand}): ${m.goal}`,
    `SUCCESS CRITERIA: ${JSON.parse(m.criteria_json || '[]').join('; ') || '—'}`,
    `THE PLAN: ${steps.map((s) => `${s.idx + 1}. ${s.title} (${agentById(s.agent_id)?.name ?? s.agent_id})`).join(' → ')}`,
    context ? `EARLIER STEPS' OUTPUT:\n${context}` : '',
    `YOUR STEP (${next.idx + 1}): ${next.title}\n${next.instruction}`,
    lastCheck && lastCheck.pass === false ? `THE CHECKER REJECTED YOUR LAST ATTEMPT: ${lastCheck.note}\nFix exactly that.` : '',
    lastCheck?.error ? `The last attempt failed with an engine error; try again.` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  let r;
  try {
    r = await callRouted(env, db, await engineOrder(env, db, { agent, kind: 'write' }), { system: stepSystem(agent, m, memory, skill), prompt, maxTokens: 4096, purpose: `brain_step:${agent.id}` }, deps);
  } catch (e) {
    const failed = attempts >= MAX_ERROR_ATTEMPTS;
    await db
      .prepare('UPDATE mission_steps SET status = ?, check_json = ?, finished_at = ? WHERE id = ?')
      .bind(failed ? 'failed' : 'pending', JSON.stringify({ error: String(e.message).slice(0, 400) }), failed ? nowIso() : null, next.id)
      .run();
    if (failed) await db.prepare("UPDATE missions SET status = 'failed', error = ?, updated_at = ?, finished_at = ? WHERE id = ?").bind(`Step ${next.idx + 1} (${agent.name}) failed: ${String(e.message).slice(0, 300)}`, nowIso(), nowIso(), id).run();
    else await db.prepare('UPDATE missions SET updated_at = ? WHERE id = ?').bind(nowIso(), id).run();
    return getMission(db, id);
  }
  const output = clip(String(r.text ?? '').trim(), STEP_OUT);
  const check = await verify(env, db, m, next, output, deps);
  const redo = check.pass === false && attempts < MAX_STEP_ATTEMPTS;
  await db
    .prepare('UPDATE mission_steps SET status = ?, output = ?, check_json = ?, engine = ?, model = ?, finished_at = ? WHERE id = ?')
    .bind(redo ? 'pending' : 'done', output, JSON.stringify({ ...check, attempt: attempts }), r.provider, r.model, redo ? null : nowIso(), next.id)
    .run();
  await db.prepare('UPDATE missions SET updated_at = ? WHERE id = ?').bind(nowIso(), id).run();
  return getMission(db, id);
}

async function finalize(env, db, m, steps, deps) {
  const claim = await db.prepare("UPDATE missions SET result = ?, updated_at = ? WHERE id = ? AND status = 'running' AND result IS NULL").bind(FINALIZING, nowIso(), m.id).run();
  if (!claim.meta?.changes) return;
  try {
    const body = steps.map((s) => `### ${s.idx + 1}. ${s.title} (${agentById(s.agent_id)?.name ?? s.agent_id})${s.check_json && JSON.parse(s.check_json).pass === false ? ' — ⚠ checker not satisfied' : ''}\n${clip(s.output, 4000)}`).join('\n\n');
    let result;
    try {
      const r = await callRouted(
        env,
        db,
        await engineOrder(env, db, { kind: 'write' }),
        {
          system: `You are GANESHA. Close a finished mission for the owner. ${RULES}\nWrite Markdown: "**Outcome**" (2–3 lines: what was achieved against the success criteria, honestly), "**Ready to use**" (the key deliverables, pulled together and cleaned up — the actual content, not a summary of it), "**Needs you**" (anything that waits for the owner's approval or action), "**Next**" (1–3 suggested follow-ups). Then up to 3 lines "LESSON: <short lesson for next time>".`,
          prompt: `GOAL: ${m.goal}\nSUCCESS CRITERIA: ${JSON.parse(m.criteria_json || '[]').join('; ') || '—'}\n\n${body}`,
          maxTokens: 4096,
          purpose: 'brain_final',
        },
        deps,
      );
      result = String(r.text ?? '').trim();
    } catch (e) {
      // The steps' work is still useful: keep it, say the summary failed.
      result = `**Outcome**\nAll steps finished, but the final summary could not be written (${String(e.message).slice(0, 160)}). Each step's output is below.`;
    }
    // Lessons → memory (scope: the mission's brand).
    const lessons = [];
    const kept = [];
    for (const line of [result, ...steps.map((s) => s.output ?? '')].join('\n').split('\n')) {
      const x = /^\s*[-*]?\s*LESSON:\s*(.+)$/.exec(line);
      if (x) lessons.push(x[1].trim());
    }
    for (const line of result.split('\n')) if (!/^\s*[-*]?\s*LESSON:/.test(line)) kept.push(line);
    const uniq = [...new Set(lessons)].slice(0, 4);
    const saved = await saveFacts(db, uniq.map((f) => ({ scope: m.brand, fact: f })), { source: 'mission', agentId: 'ganesha_orchestrator' });
    const finalText = `${kept.join('\n').trim()}${saved.length ? `\n\n_Brain saved ${saved.length} lesson${saved.length > 1 ? 's' : ''} to memory._` : ''}`;
    const done = nowIso();
    await db.prepare("UPDATE missions SET status = 'done', result = ?, updated_at = ?, finished_at = ? WHERE id = ?").bind(clip(finalText, 30_000), done, done, m.id).run();
    const targets = JSON.parse(m.deliver_json || '[]');
    if (targets.length) {
      const full = { ...m, result: finalText, finished_at: done };
      const doneSteps = (await db.prepare('SELECT * FROM mission_steps WHERE mission_id = ? ORDER BY idx').bind(m.id).all()).results;
      await deliverMission(env, db, full, doneSteps, targets, deps);
    }
  } catch (e) {
    await db.prepare('UPDATE missions SET result = NULL, error = ?, updated_at = ? WHERE id = ?').bind(`Finishing failed: ${String(e.message).slice(0, 300)}`, nowIso(), m.id).run();
    throw e;
  }
}

/** Cron: free stuck steps, then move up to 2 running missions forward by up to 2 steps each. */
export async function scheduledMissions(env, db, deps = {}) {
  const cutoff = new Date(Date.now() - STALE_MS).toISOString().replace(/\.\d{3}Z$/, 'Z');
  await db.prepare("UPDATE mission_steps SET status = 'pending' WHERE status = 'running' AND started_at < ?").bind(cutoff).run();
  await db.prepare("UPDATE missions SET result = NULL WHERE status = 'running' AND result = ? AND updated_at < ?").bind(FINALIZING, cutoff).run();
  const running = (await db.prepare("SELECT id FROM missions WHERE status = 'running' ORDER BY updated_at LIMIT 2").all()).results;
  const out = [];
  for (const { id } of running) {
    for (let i = 0; i < 2; i++) {
      const m = await advance(env, db, id, deps);
      if (m.status !== 'running') break;
    }
    out.push(id);
  }
  return out;
}

/* ---------------- missions proposed from chat (SAARTHI, GANESHA) ---------------- */
export const MISSION_PROMPT = `MISSIONS (Ganesha Brain): when the owner wants a multi-step piece of work done by several agents (research → create → review, a launch pack, a week's content), start a mission by adding ONE line at the very end:
MISSION: {"goal":"<clear goal with the deliverables wanted>","brand":"littleloop|sunverse|foliocraft|studio"}
GANESHA then thinks and plans it; the owner sees the plan right here in chat and approves or rejects it with one tap. Nothing runs before that. Use it only when work is wanted, at most one per reply.`;

/** Pulls a MISSION: {...} line out of a reply. Returns { text, request } (request null if none/invalid). */
export function extractMission(text) {
  const m = /^[ \t]*MISSION:[ \t]*(\{.*\})[ \t]*$/m.exec(String(text ?? ''));
  if (!m) return { text: String(text ?? '').trim(), request: null };
  const rest = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).replace(/\n{3,}/g, '\n\n').trim();
  try {
    const r = JSON.parse(m[1]);
    const goal = String(r.goal ?? '').trim();
    const brand = BRANDS.includes(r.brand) ? r.brand : 'studio';
    return { text: rest, request: goal.length >= 8 ? { goal: goal.slice(0, 2000), brand } : null };
  } catch {
    return { text: rest, request: null };
  }
}

/** Plans a mission from a chat line; never throws (the chat answer must still arrive). */
export async function proposeMission(env, db, request, deps = {}) {
  try {
    const m = await createMission(env, db, { goal: request.goal, brand: request.brand, deliver: [] }, deps);
    return { type: 'mission', id: m.id, goal: m.goal, brand: m.brand, status: m.status, steps: m.steps.length, error: m.error ?? null };
  } catch (e) {
    return { type: 'mission', id: null, goal: request.goal, brand: request.brand, status: 'failed', steps: 0, error: String(e.message ?? e).slice(0, 300) };
  }
}
