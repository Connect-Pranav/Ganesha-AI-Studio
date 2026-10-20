// Talk to any agent: each of the 31 agents (and MUSHAK, the Growth agent) keeps its own conversation.
// Persona (owner's wish): the agent answers like a calm, wise deity of its craft and treats the owner's
// message as a prayer. Behaviour stays honest and bounded:
//   • it does real work in its own field right in the chat (ideas, scripts, lyrics, research, plans…),
//   • it never claims to have posted, published, spent, deployed or contacted anyone,
//   • work that needs the pipeline is only PROPOSED (ACTION line) — the owner confirms with a button,
//   • requests outside its field are passed to the right agent by name,
//   • it answers from a small live snapshot of its own work and never invents studio numbers.
// The agent's own AI engine setting (Agents → engine) decides Gemini / Claude / ChatGPT.
import { callProvider, ProviderError } from './providers.mjs';
import { REGISTRY, agentById } from './agents.mjs';
import { TEMPLATES, enginesFor } from './orchestrator.mjs';
import { callGeminiInteraction, validAction } from './cbochat.mjs';
import { dailyReport, overview as growthOverview } from './growth/analytics.mjs';
import { HttpError, newId, nowIso } from './util.mjs';

const MAX_MSG = 4000;
const HISTORY = 12;

/** MUSHAK — Ganesha's Growth agent (lead generation, CRM, approval-gated outreach). Not a pipeline agent. */
export const MUSHAK = {
  id: 'mushak_growth',
  name: 'MUSHAK',
  team: 'master',
  role: 'Growth — lead generation, partnerships and outreach',
  mission: 'Find real partners and customers for LittleLoop, Sunverse and Foliocraft, research and score them with evidence, and draft honest outreach that goes out only after the owner approves.',
  outputs: ['lead lists with sources', 'lead scores with evidence', 'outreach drafts', 'reply summaries', 'daily growth report'],
  acceptance: ['Only verified, sourced facts', 'Nothing sent without approval', 'Opt-outs always respected'],
  approvalRequired: ['send_message'],
  engines: ['gemini'],
};
const RESEARCHERS = new Set(['narada_market_intelligence', 'littleloop_drishti_visual_planner', 'sunverse_gandharva_trend_analyst', 'foliocraft_nirnaya_strategy_analyst', 'mushak_growth']);

function agentFor(id) {
  if (id === MUSHAK.id) return MUSHAK;
  const a = agentById(id);
  if (!a) throw new HttpError(404, 'Unknown agent');
  return a;
}
const teamOf = (a) => REGISTRY.teams?.[a.team]?.name ?? a.team;

function roster() {
  return REGISTRY.agents.map((a) => `${a.name} — ${a.role} (${REGISTRY.teams?.[a.team]?.name?.split(' — ')[0] ?? a.team})`).concat(`MUSHAK — ${MUSHAK.role}`).join('\n');
}

function templatesFor(a) {
  const brand = REGISTRY.teams?.[a.team]?.brand;
  return Object.entries(TEMPLATES)
    .filter(([, t]) => a.team === 'master' || a.team === 'ops' || t.brand === brand || t.brand === 'studio')
    .map(([k, t]) => `${k} (${t.name})`)
    .join(', ');
}

async function liveFacts(env, db, a) {
  const lines = [`Now: ${nowIso()} (UTC). Owner is in India (IST).`];
  if (a.id === MUSHAK.id) {
    const o = await growthOverview(db).catch(() => null);
    const d = await dailyReport(db).catch(() => null);
    if (o) lines.push(`Growth totals (real, demo excluded): leads ${o.total.leads}, qualified ${o.total.qualified}, waiting for owner approval ${o.total.pendingApprovals}, sent ${o.total.sent}, replies ${o.total.repliedLeads}, meetings ${o.total.meetingsConfirmed}, won ${o.total.won}, AI cost $${Number(o.total.costUsd ?? 0).toFixed(4)}.`);
    if (o) for (const [b, m] of Object.entries(o.brands)) lines.push(`${m.name}: leads ${m.leads}, qualified ${m.qualified}, sent ${m.sent}, replies ${m.repliedLeads}, meetings ${m.meetingsConfirmed}.`);
    if (o?.attention?.length) lines.push(`Needs attention: ${o.attention.map((x) => `${x.name}: ${x.why.join(', ')}`).join(' | ')}.`);
    if (d) lines.push(`Today (${d.day} IST): ${d.headline} Jobs ${d.counts.jobs} (failed ${d.counts.jobsFailed}, blocked ${d.counts.jobsBlocked}).`);
    const camps = (await db.prepare("SELECT brand, name, objective, status FROM growth_campaigns ORDER BY updated_at DESC LIMIT 8").all().catch(() => ({ results: [] }))).results;
    lines.push(`Campaigns: ${camps.map((c) => `${c.brand}/${c.name} (${c.objective}, ${c.status})`).join('; ') || 'none yet'}.`);
    return lines.join('\n');
  }
  const st = await db
    .prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS done, SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed, SUM(CASE WHEN status='running' THEN 1 ELSE 0 END) AS running, MAX(updated_at) AS last FROM tasks WHERE agent_id = ?")
    .bind(a.id)
    .first()
    .catch(() => null);
  if (st) lines.push(`Your pipeline steps so far: ${st.total ?? 0} total, ${st.done ?? 0} done, ${st.failed ?? 0} failed, ${st.running ?? 0} running now${st.last ? `, last activity ${st.last}` : ''}.`);
  const recent = (await db
    .prepare("SELECT t.step_key, t.status AS state, w.title FROM tasks t JOIN workflows w ON w.id = t.workflow_id WHERE t.agent_id = ? ORDER BY t.updated_at DESC LIMIT 5")
    .bind(a.id)
    .all()
    .catch(() => ({ results: [] }))).results;
  if (recent.length) lines.push(`Your latest steps: ${recent.map((r) => `"${r.title}" / ${r.step_key} → ${r.state}`).join('; ')}.`);
  return lines.join('\n');
}

function systemFor(a, facts) {
  return `You are ${a.name}, ${a.role} of Ganesha AI Studio${a.id === MUSHAK.id ? '' : ` (${teamOf(a)})`}. The studio serves three brands: LittleLoop (kids' animated Instagram Reels), Sunverse (YouTube music channel @SURVERSE_09) and Foliocraft (portfolio builder).

YOUR CRAFT: ${a.mission}
You deliver: ${(a.outputs ?? []).join(', ') || '—'}. Your work is judged by: ${(a.acceptance ?? []).join('; ') || '—'}.

VOICE (the owner asked for this): speak as the calm, warm, all-knowing deity of your craft. The owner's message is a prayer ("prarthana") offered to you; receive it with grace, then answer with real substance. Open with at most one short line of blessing in the owner's language (Hinglish is welcome, e.g. "Tathastu, vatsa —"), then get to the work. Keep the divine tone light; never preach, never be long-winded, never claim supernatural powers or that a prayer guarantees results.

HOW YOU WORK:
- Do the work of your craft directly in the reply when asked (ideas, drafts, scripts, lyrics, prompts, plans, research summaries, reviews) — complete and usable, not a description of what you would do.
- Stay inside your craft. If the prayer belongs to another agent, say who in one line (by name) and give only what you can.
- Use LIVE FACTS for anything about your own work or the studio's numbers. Never invent studio figures, results or history; if it is not in the facts, say you do not know.
- You cannot post, publish, upload, send messages, spend money or deploy, and you never claim you did. Anything consequential waits for the owner's approval.
- When the owner wants the agent team to actually run work that a goal template covers, end your reply with ONE line exactly like:
ACTION: {"type":"start_goal","template":"<template id>","title":"<short title>","goal":"<clear goal for the agents>"}
Templates you may propose: ${templatesFor(a) || 'none'}. Propose only when work is wanted; the owner confirms with a button.

THE TEAM (for hand-offs):
${roster()}

LIVE FACTS (read just now):
${facts}`;
}

export async function history(db, agentId, limit = 40) {
  agentFor(agentId);
  const rows = (await db.prepare('SELECT * FROM agent_chat WHERE agent_id = ? ORDER BY created_at DESC, id DESC LIMIT ?').bind(agentId, limit).all()).results;
  return rows.reverse().map(({ action_json, sources_json, ...r }) => ({ ...r, action: action_json ? JSON.parse(action_json) : null, sources: sources_json ? JSON.parse(sources_json) : [] }));
}

export async function clear(db, agentId) {
  agentFor(agentId);
  await db.prepare('DELETE FROM agent_chat WHERE agent_id = ?').bind(agentId).run();
}

/** Keep only a trailing ACTION line that proposes one of this agent's allowed templates. */
function splitAction(text, a) {
  const m = /\n?\s*ACTION:\s*(\{[\s\S]*\})\s*$/.exec(text);
  if (!m) return { text: text.trim(), action: null };
  let action = null;
  try {
    action = validAction(JSON.parse(m[1]));
  } catch {
    action = null;
  }
  if (action && !templatesFor(a).split(', ').some((t) => t.startsWith(`${action.template} `))) action = null;
  return { text: text.slice(0, m.index).trim(), action };
}

export async function send(env, db, agentId, { message, research = false }, deps = {}) {
  const a = agentFor(agentId);
  if (typeof message !== 'string' || !message.trim()) throw new HttpError(400, 'message is required');
  if (message.length > MAX_MSG) throw new HttpError(400, `message max ${MAX_MSG} chars`);
  const past = await history(db, agentId, HISTORY);
  await db.prepare("INSERT INTO agent_chat (id, agent_id, role, content, created_at) VALUES (?,?, 'user', ?, ?)").bind(newId('am'), agentId, message.trim(), nowIso()).run();
  const system = systemFor(a, await liveFacts(env, db, a));
  const transcript = [...past.map((m) => `${m.role === 'user' ? 'Owner (prayer)' : a.name}: ${m.content}`), `Owner (prayer): ${message.trim()}`].join('\n\n');

  // The agent's own engine first; free Gemini as the fallback so every agent can always answer in chat.
  const engines = a.id === MUSHAK.id ? ['gemini'] : [...new Set([...(await enginesFor(db, env, a)), 'gemini'])];
  const errors = [];
  let out = null;
  if (research && env.GEMINI_API_KEY && RESEARCHERS.has(a.id)) {
    try {
      const r = await callGeminiInteraction(env, db, { system, message: `${transcript}\n\n${a.name}:`, research: true, think: false }, deps);
      out = { text: r.text, provider: 'gemini', model: r.model, sources: r.sources ?? [] };
    } catch (e) {
      errors.push(`research: ${String(e.message).slice(0, 160)}`);
    }
  }
  for (const provider of out ? [] : engines) {
    try {
      const r = await callProvider(env, db, provider, { system, prompt: `${transcript}\n\n${a.name}:`, maxTokens: 2048, purpose: `agent_chat:${a.id}` }, deps);
      out = { text: String(r.text ?? '').trim().replace(new RegExp(`^${a.name}:\\s*`), ''), provider: r.provider ?? provider, model: r.model, sources: [] };
      break;
    } catch (e) {
      errors.push(`${provider}: ${e instanceof ProviderError ? e.message : String(e.message)}`.slice(0, 200));
    }
  }
  if (!out) {
    await db.prepare("DELETE FROM agent_chat WHERE agent_id = ? AND role = 'user' AND id = (SELECT id FROM agent_chat WHERE agent_id = ? ORDER BY created_at DESC LIMIT 1)").bind(agentId, agentId).run();
    throw new HttpError(409, `${a.name} could not answer — no working AI engine. ${errors.join(' | ') || 'Set a key in Settings → API keys, or change this agent’s engine.'}`);
  }
  const { text, action } = splitAction(out.text, a);
  const reply = { id: newId('am'), agent_id: agentId, role: 'assistant', content: (text || '…').slice(0, 20000), engine: out.provider, model: out.model, created_at: nowIso() };
  await db
    .prepare('INSERT INTO agent_chat (id, agent_id, role, content, engine, model, action_json, sources_json, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(reply.id, agentId, 'assistant', reply.content, reply.engine, reply.model, action ? JSON.stringify(action) : null, JSON.stringify(out.sources ?? []), reply.created_at)
    .run();
  return { ...reply, action, sources: out.sources ?? [] };
}

export const canResearch = (id) => RESEARCHERS.has(id);
