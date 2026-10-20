// GANESHA CBO chat: a ChatGPT/Gemini-style conversation with the studio's Chief Business Officer.
// Every reply is grounded in a live snapshot of the studio (tasks, approvals, reels, spend).
// Gemini (free key) runs through the Interactions API with two owner switches:
//   • Think   — deeper reasoning (thinking_level high) with a short thought summary shown in the UI
//   • Research — Google Search grounding with cited sources
// The CBO can PROPOSE work ("start a goal" for the agents); nothing starts until the owner confirms.
// ChatGPT runs on the OpenAI Responses API (worker/openai.mjs): Think = reasoning effort high,
// Research = OpenAI web search with citations, image questions, live streaming, and goal proposals
// via a start_goal function tool (a proposal only — the owner still confirms with a button).
// It needs an OpenAI API key (ChatGPT app plans include no API access).
import { callProvider, ProviderError } from './providers.mjs';
import * as openai from './openai.mjs';
import { cboReport } from './cbo.mjs';
import { TEMPLATES } from './orchestrator.mjs';
import * as reels from './reels.mjs';
import { HttpError, newId, nowIso } from './util.mjs';

const MAX_MSG = 4000;
const HISTORY = 16;
const GEMINI_TIMEOUT = 120_000; // research / think
const GEMINI_QUICK_TIMEOUT = 60_000; // plain chat: leave time for the fallback before the phone gives up
const API = 'https://generativelanguage.googleapis.com/v1beta';

export function engines(env) {
  return [
    { id: 'gemini', name: 'Gemini', available: Boolean(env.GEMINI_API_KEY), note: env.GEMINI_API_KEY ? `Free key · ${geminiModel(env)}` : 'Set GEMINI_API_KEY', think: true, research: true, images: false, stream: false },
    { id: 'openai', name: 'ChatGPT', available: Boolean(env.OPENAI_API_KEY), note: env.OPENAI_API_KEY ? `OpenAI API · ${openai.openaiConfig(env).model} (paid per message)` : 'Needs an OpenAI API key — ChatGPT Go/Plus app plans have no API access', think: true, research: true, images: true, stream: true },
  ];
}
const geminiModel = (env) => (env.GEMINI_MODEL || 'gemini-3.8-flash').trim();

export async function history(db, limit = 60) {
  const rows = (
    await db
      .prepare(`SELECT c.id, c.role, c.content, c.engine, c.model, c.created_at, m.thoughts, m.sources_json, m.action_json, m.mode_json
                FROM cbo_chat c LEFT JOIN cbo_chat_meta m ON m.msg_id = c.id ORDER BY c.created_at DESC, c.id DESC LIMIT ?`)
      .bind(limit)
      .all()
  ).results;
  return rows.reverse().map(({ sources_json, action_json, mode_json, ...r }) => ({
    ...r,
    sources: sources_json ? JSON.parse(sources_json) : [],
    action: action_json ? JSON.parse(action_json) : null,
    mode: mode_json ? JSON.parse(mode_json) : null,
  }));
}

export async function clear(db) {
  await db.batch([db.prepare('DELETE FROM cbo_chat_meta'), db.prepare('DELETE FROM cbo_chat')]);
}

/** Compact, factual snapshot the model must answer from. */
async function snapshot(env, db, providers) {
  const rep = await cboReport(env, db, providers);
  const rf = await reels.overview(env, db);
  const lines = [];
  const s = rep.tasks.byState;
  lines.push(`Generated: ${rep.generatedAt} (UTC). Owner timezone: India (IST).`);
  lines.push(`Tasks by state: ${Object.entries(s).map(([k, v]) => `${k} ${v}`).join(', ')}.`);
  lines.push(`Agents: ${rep.agents.total} total, ${rep.agents.working} working, ${rep.agents.available} free.`);
  lines.push(`Pending approvals (${rep.approvals.length}): ${rep.approvals.slice(0, 10).map((a) => `"${a.workflow_title}" → ${a.action} (agent ${a.agent_id ?? '?'})`).join('; ') || 'none'}.`);
  lines.push(`Blocked/failed: ${rep.blockers.slice(0, 8).map((t) => `${t.workflowTitle}/${t.stepKey} ${t.state}${t.error ? `: ${String(t.error).slice(0, 120)}` : ''}`).join('; ') || 'none'}.`);
  lines.push(`Overdue: ${rep.deadlines.overdue.length}; due in 7 days: ${rep.deadlines.upcoming7d.length}.`);
  const m = rep.money;
  lines.push(`Money: API spend this month ₹${m.actualMonthInr ?? '?'}${m.unknownCostRows ? ` (+${m.unknownCostRows} rows with unknown cost)` : ''}; reserved ₹${m.reservedInr ?? 0}; subscriptions ~₹${m.subscriptionsMonthlyInr ?? '?'}/month.`);
  if (rep.subscriptions && !rep.subscriptions.error)
    lines.push(`Subscriptions: ${rep.subscriptions.services.map((x) => `${x.name} ${x.plan ?? 'plan unknown'}${x.daysUntilRenewal != null ? `, renews in ${x.daysUntilRenewal}d` : ''}`).join('; ')}.`);
  lines.push(`Providers: ${rep.health.providers.map((p) => `${p.provider} ${p.state}`).join(', ')}. Dispatch paused: ${rep.health.dispatchPaused}.`);
  const c = rf.config;
  lines.push(`LittleLoop Reel Factory: ${c.enabled ? 'ON' : 'OFF'}, ${c.perDay}/day, mode ${c.renderMode}${c.renderMode === 'flow' ? ` (${c.flowModel})` : ''}; character sheets ${rf.sheets.length} (${rf.sheets.map((x) => x.name).join(', ') || 'none'}); waiting for Flow clips ${rf.waitingForFlow}; waiting for owner approval ${rf.pendingApproval}; Instagram ${rf.connections.instagram ? 'connected' : 'not connected'}.`);
  lines.push(`Recent reels: ${rf.reels.slice(0, 6).map((r) => `${r.day}#${r.slot} ${r.status}${r.script?.title ? ` "${r.script.title}"` : ''}`).join('; ') || 'none'}.`);
  lines.push(`Recommended actions: ${rep.recommendedActions.slice(0, 8).join(' | ') || 'none'}.`);
  return lines.join('\n');
}

const TEMPLATE_LIST = () => Object.entries(TEMPLATES).map(([k, v]) => `${k} (${v.name})`).join(', ');

const SYSTEM = () => `You are SAARTHI (technical id GANESHA_CBO), the Chief Business Officer of Ganesha AI Studio — the owner's internal command center for three brands: LittleLoop (kids' animated Instagram Reels), Sunverse (YouTube music channel) and Foliocraft (portfolio builder).
VOICE (the owner asked for this): speak as the calm, wise divine charioteer who guides the owner's journey; the owner's message is a prayer ("prarthana") offered to you. Open with at most one short line of blessing in the owner's language (Hinglish is welcome, e.g. "Tathastu, Parth —"), then give real, practical substance like a sharp business partner. Keep the divine tone light; never preach, never claim supernatural powers or that a prayer guarantees results. Answer directly; keep it short unless asked for depth; use short lists when they help.
Use the LIVE STUDIO SNAPSHOT for anything about the studio's own state, numbers, tasks, approvals, reels or spend. Never invent studio figures; if something is not in the snapshot, say so.
For general questions (strategy, ideas, scripts, captions, growth, research) answer from your knowledge — and from web search results when they are provided, citing them.
You can hand work to the 31-agent team. When the owner asks the studio to DO something that a goal template covers, propose it by ending your reply with ONE line exactly like:
ACTION: {"type":"start_goal","template":"<template id>","title":"<short title>","goal":"<clear goal for the agents>"}
Template ids: ${TEMPLATE_LIST()}. Only propose when the owner wants work done; the owner confirms with a button. Never claim you already started, posted, published, spent or deployed anything.
You lead MUSHAK, the Growth Manager (finds partners/customers with NARADA, scores with SOMA, drafts outreach with SAMVADA; never sends without the owner). When the owner wants growth work (leads, partners, sponsors, collaborations, outreach, audience growth through partnerships), DELEGATE to Mushak instead of a goal by ending your reply with ONE line exactly like:
MUSHAK: <one clear command for Mushak, naming the brand and what to find/do>
Mushak turns it into a blueprint and runs it right away; its drafts still wait for the owner's approval.
WHEN THE OWNER ASKS FOR A PLAN OR BLUEPRINT (e.g. a revenue target, a launch, "next 30 days"):
- Give a concrete BLUEPRINT, not generic advice: the goal and a realistic read on it (say plainly if a target is unlikely and what is achievable), week-by-week milestones, which agent or brand owns each part, the numbers to track, and what the owner must do himself (approvals, uploads, payments). Use LIVE STUDIO SNAPSHOT facts; never promise results.
- Then put the first moves in motion in the same reply: a MUSHAK line for the growth/outreach part (it runs immediately) and, if content or product work should start, an ACTION line (the owner confirms with a button). Both lines may be used, MUSHAK first, ACTION last.
- Ask at most one question, only if a missing fact truly blocks the plan.
For approvals, uploads, settings or connections, point to the exact panel place. Panel map (use only these):
- Top bar: Command Center, Overview, CBO (this chat), Agents (decisions by agent + finished work), LittleLoop (Reel Factory: switch, Flow clips, approvals), Sunverse, Foliocraft, Analytics (range dropdown, Instagram/YouTube stats).
- Gear icon / sidebar → Settings: API keys (Gemini, OpenAI/ChatGPT, Claude, YouTube, Instagram app ID/secret) saved encrypted from the app, Connect Instagram, chat defaults, updates.
- Sidebar: Pipelines, Task Manager, CFO & Costs, Subscriptions (Quick setup for plan/price/renewal), Video & Film Studio, Voice Library, Characters (upload character sheet: name + image), AI Connection (test providers).
ChatGPT app plans (Go/Plus) have no API; ChatGPT here needs an OpenAI API key in Settings. Consumer plans (Google AI Pro, ChatGPT, Claude, Canva) expose no usage API — their plan details go in Subscriptions → Quick setup.`;

/** Pulls a trailing ACTION: {...} line out of the reply and validates it. */
export function extractAction(text) {
  const m = /\n?\s*ACTION:\s*(\{[\s\S]*\})\s*$/.exec(text);
  if (!m) return { text: text.trim(), action: null };
  let action = null;
  try {
    action = validAction(JSON.parse(m[1]));
  } catch {
    action = null;
  }
  return { text: text.slice(0, m.index).trim(), action };
}

/** A goal proposal is accepted only for a known template with a non-empty title and goal. */
export function validAction(a) {
  if (a?.type !== undefined && a.type !== 'start_goal') return null;
  if (!(typeof a?.template === 'string' && Object.hasOwn(TEMPLATES, a.template) && typeof a.title === 'string' && typeof a.goal === 'string' && a.title.trim() && a.goal.trim())) return null;
  return { type: 'start_goal', template: a.template, title: a.title.trim().slice(0, 140), goal: a.goal.trim().slice(0, 2000) };
}

/** Function tool for the OpenAI engine. It only PROPOSES; the owner's button click starts the goal. */
const START_GOAL_TOOL = () => ({
  name: 'start_goal',
  description: 'Propose a goal for the agent team when the owner wants work done. This only shows a proposal; the owner must confirm before anything starts.',
  parameters: {
    type: 'object',
    properties: {
      template: { type: 'string', enum: Object.keys(TEMPLATES), description: 'Goal template id' },
      title: { type: 'string', description: 'Short title (max 140 chars)' },
      goal: { type: 'string', description: 'Clear goal for the agents' },
    },
    required: ['template', 'title', 'goal'],
    additionalProperties: false,
  },
});

const MAX_IMAGE = 7_000_000;
const httpForProvider = (e) => {
  const code = { not_configured: 409, budget: 429, rate_limited: 429, quota: 402, bad_request: 400, unsupported: 400 }[e.kind] ?? 502;
  return new HttpError(code, `ChatGPT: ${String(e.message).slice(0, 400)}`);
};

async function logCall(db, provider, model, status, http, inTok, outTok, started, error, purpose = 'cbo_chat') {
  try {
    await db.prepare(`INSERT INTO provider_calls (id, provider, model, purpose, task_id, status, http_status, input_tokens, output_tokens, cost_usd, latency_ms, error, created_at) VALUES (?,?,?,?,NULL,?,?,?,?,NULL,?,?,?)`)
      .bind(newId('pc'), provider, model, purpose, status, http, inTok ?? null, outTok ?? null, Date.now() - started, error, nowIso()).run();
  } catch {
    /* logging never breaks the chat */
  }
}

/** Gemini Interactions API: conversation memory server-side, thinking level, Google Search tool. */
export async function callGeminiInteraction(env, db, { system, message, previous, think, research }, deps = {}) {
  const fetchImpl = deps.fetch ?? fetch;
  const model = geminiModel(env);
  const body = {
    model,
    input: message,
    system_instruction: system,
    store: true,
    generation_config: { thinking_level: think ? 'high' : 'low', thinking_summaries: think ? 'auto' : 'none' },
  };
  if (research) body.tools = [{ type: 'google_search' }];
  if (previous) body.previous_interaction_id = previous;
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), research || think ? GEMINI_TIMEOUT : GEMINI_QUICK_TIMEOUT);
  let status = null;
  try {
    const res = await fetchImpl(`${API}/interactions`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY }, body: JSON.stringify(body), signal: ctrl.signal });
    status = res.status;
    const raw = await res.text();
    if (!res.ok) throw Object.assign(new Error(`Gemini HTTP ${res.status}: ${raw.split(env.GEMINI_API_KEY).join('[redacted]').slice(0, 300)}`), { status });
    const r = JSON.parse(raw);
    const steps = r.steps ?? r.outputs ?? [];
    const texts = [];
    const thoughts = [];
    const sources = [];
    const queries = [];
    for (const st of steps) {
      if (st.type === 'thought') for (const s of st.summary ?? []) if (s.type === 'text' && s.text) thoughts.push(s.text);
      if (st.type === 'google_search_call') queries.push(...(st.queries ?? st.arguments?.queries ?? []));
      if (st.type === 'model_output' || st.type === 'text')
        for (const c of st.content ?? [st])
          if (c.type === 'text' && c.text) {
            texts.push(c.text);
            for (const a of c.annotations ?? []) if (a.url && !sources.some((x) => x.url === a.url)) sources.push({ url: a.url, title: a.title ?? a.url });
          }
    }
    const text = texts.join('').trim();
    if (!text) throw new Error(`Gemini returned no text (status ${r.status ?? 'unknown'})`);
    await logCall(db, 'gemini', model, 'success', status, r.usage?.total_input_tokens, (r.usage?.total_output_tokens ?? 0) + (r.usage?.total_thought_tokens ?? 0), started, null);
    return { text, model, interactionId: r.id ?? null, thoughts: thoughts.join('\n\n').trim() || null, sources: sources.slice(0, 12), queries, usage: { input: r.usage?.total_input_tokens ?? null, output: r.usage ? (r.usage.total_output_tokens ?? 0) + (r.usage.total_thought_tokens ?? 0) : null } };
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'Gemini timed out' : String(e.message);
    await logCall(db, 'gemini', model, 'error', status, null, null, started, msg);
    throw Object.assign(new Error(msg), { status });
  } finally {
    clearTimeout(timer);
  }
}

export async function send(env, db, providers, { message, engine = 'gemini', think = false, research = false, image = null }, deps = {}, { onDelta } = {}) {
  if (typeof message !== 'string' || !message.trim()) throw new HttpError(400, 'message is required');
  if (message.length > MAX_MSG) throw new HttpError(400, `message max ${MAX_MSG} chars`);
  if (!['gemini', 'openai'].includes(engine)) throw new HttpError(400, 'engine must be gemini or openai');
  const eng = engines(env).find((e) => e.id === engine);
  if (!eng.available) throw new HttpError(409, `${eng.name} is not available: ${eng.note}`);
  if (image !== null && image !== undefined) {
    if (!eng.images) throw new HttpError(400, `${eng.name} chat does not take images here — switch to ChatGPT`);
    if (typeof image !== 'string' || image.length > MAX_IMAGE || !/^data:image\/(png|jpeg|webp|gif);base64,/.test(image)) throw new HttpError(400, 'image must be a PNG/JPEG/WebP/GIF under ~5 MB');
  }

  const past = await history(db, HISTORY);
  await db.prepare("INSERT INTO cbo_chat (id, role, content, created_at) VALUES (?, 'user', ?, ?)").bind(newId('msg'), image ? `${message.trim()}\n\n_(image attached)_` : message.trim(), nowIso()).run();
  const system = `${SYSTEM()}\n\nLIVE STUDIO SNAPSHOT (read just now):\n${await snapshot(env, db, providers)}`;

  let out;
  let toolAction = null;
  if (engine === 'openai') {
    try {
      const r = await openai.generate(
        env,
        db,
        {
          system,
          prompt: message.trim(),
          messages: past.map((m) => ({ role: m.role, content: m.content })),
          images: image ? [image] : [],
          reasoning: think ? 'high' : 'low',
          webSearch: Boolean(research),
          tools: [START_GOAL_TOOL()],
          purpose: 'cbo_chat',
          stream: Boolean(onDelta),
          onDelta,
        },
        deps,
      );
      const call = r.toolCalls.find((c) => c.name === 'start_goal');
      toolAction = call ? validAction(call.arguments) : null;
      out = { text: r.text || (toolAction ? `Proposed goal: **${toolAction.title}**` : ''), model: r.model, thoughts: r.thoughts, sources: r.sources, requestId: r.requestId, incomplete: r.incomplete };
    } catch (e) {
      if (e instanceof ProviderError) throw httpForProvider(e);
      throw e;
    }
  } else {
    const lastGemini = [...past].reverse().find((m) => m.role === 'assistant' && m.engine === 'gemini');
    const previous = lastGemini ? (await db.prepare('SELECT interaction_id FROM cbo_chat_meta WHERE msg_id = ?').bind(lastGemini.id).first())?.interaction_id : null;
    try {
      out = await callGeminiInteraction(env, db, { system, message: message.trim(), previous, think, research }, deps);
    } catch (e) {
      // Fallback: plain generateContent with the transcript (no research/thinking extras).
      const transcript = [...past.map((m) => `${m.role === 'user' ? 'Owner' : 'CBO'}: ${m.content}`), `Owner: ${message.trim()}`].join('\n\n');
      try {
        const r = await callProvider(env, db, 'gemini', { system, prompt: `${transcript}\n\nCBO:`, maxTokens: 2048, purpose: 'cbo_chat' }, deps);
        out = { text: r.text.trim().replace(/^CBO:\s*/, ''), model: r.model, interactionId: null, thoughts: null, sources: [], fallback: String(e.message).slice(0, 200) };
      } catch (e2) {
        throw new HttpError(502, `Gemini: ${String(e2.message).slice(0, 300)}`);
      }
    }
  }
  // Delegation to Mushak: a trailing "MUSHAK: <command>" line is sent to Mushak, who plans and runs it.
  let delegation = null;
  const dm = /^[ \t]*MUSHAK:[ \t]*(.+)$/m.exec(out.text);
  if (dm) {
    out.text = (out.text.slice(0, dm.index) + out.text.slice(dm.index + dm[0].length)).replace(/\n{3,}/g, '\n\n').trim();
    const command = dm[1].trim().slice(0, 1000);
    try {
      const { send: askAgent } = await import('./agentchat.mjs');
      const m = await askAgent(env, db, 'mushak_growth', { message: `[Command from SAARTHI, CBO] ${command}` }, deps);
      delegation = { type: 'mushak', command, reply: m.content.slice(0, 1500), blueprint: m.blueprint ?? null };
    } catch (e) {
      delegation = { type: 'mushak', command, error: String(e.message ?? e).slice(0, 300) };
    }
  }
  const extracted = extractAction(out.text);
  const text = extracted.text;
  // A goal proposal keeps the button; a Mushak delegation is shown alongside it.
  const action = toolAction ?? extracted.action ?? delegation;
  if (action && delegation && action !== delegation) action.delegation = delegation;
  const reply = { id: newId('msg'), role: 'assistant', content: (text || '…').slice(0, 20000), engine, model: out.model, created_at: nowIso() };
  const mode = { think: Boolean(think), research: Boolean(research), image: Boolean(image), fallback: out.fallback ?? null, requestId: out.requestId ?? null, incomplete: out.incomplete ?? null };
  await db.batch([
    db.prepare('INSERT INTO cbo_chat (id, role, content, engine, model, created_at) VALUES (?,?,?,?,?,?)').bind(reply.id, reply.role, reply.content, reply.engine, reply.model, reply.created_at),
    db.prepare('INSERT INTO cbo_chat_meta (msg_id, interaction_id, thoughts, sources_json, action_json, mode_json) VALUES (?,?,?,?,?,?)').bind(reply.id, out.interactionId ?? null, out.thoughts ?? null, JSON.stringify(out.sources ?? []), action ? JSON.stringify(action) : null, JSON.stringify(mode)),
  ]);
  return { ...reply, thoughts: out.thoughts ?? null, sources: out.sources ?? [], action, delegation, mode };
}
