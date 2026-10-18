// GANESHA CBO chat: a ChatGPT/Gemini-style conversation with the studio's Chief Business Officer.
// Every reply is grounded in a live snapshot of the studio (tasks, approvals, reels, spend).
// Gemini (free key) runs through the Interactions API with two owner switches:
//   • Think   — deeper reasoning (thinking_level high) with a short thought summary shown in the UI
//   • Research — Google Search grounding with cited sources
// The CBO can PROPOSE work ("start a goal" for the agents); nothing starts until the owner confirms.
// ChatGPT needs an OpenAI API key (ChatGPT app plans include no API access).
import { callProvider } from './providers.mjs';
import { cboReport } from './cbo.mjs';
import { TEMPLATES } from './orchestrator.mjs';
import * as reels from './reels.mjs';
import { HttpError, newId, nowIso } from './util.mjs';

const MAX_MSG = 4000;
const HISTORY = 16;
const OPENAI_TIMEOUT = 60_000;
const GEMINI_TIMEOUT = 120_000;
const API = 'https://generativelanguage.googleapis.com/v1beta';

export function engines(env) {
  return [
    { id: 'gemini', name: 'Gemini', available: Boolean(env.GEMINI_API_KEY), note: env.GEMINI_API_KEY ? `Free key · ${geminiModel(env)}` : 'Set GEMINI_API_KEY', think: true, research: true },
    { id: 'openai', name: 'ChatGPT', available: Boolean(env.OPENAI_API_KEY), note: env.OPENAI_API_KEY ? `OpenAI API · ${openaiModel(env)} (paid per message)` : 'Needs an OpenAI API key — ChatGPT Go/Plus app plans have no API access', think: false, research: false },
  ];
}
const openaiModel = (env) => (env.OPENAI_MODEL || 'gpt-5-mini').trim();
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

const SYSTEM = () => `You are GANESHA_CBO, the Chief Business Officer of Ganesha AI Studio — the owner's internal command center for three brands: LittleLoop (kids' animated Instagram Reels), Sunverse (YouTube music channel) and Foliocraft (portfolio builder).
Talk like a sharp, friendly business partner in a chat app (like ChatGPT/Gemini). Reply in the owner's language (Hinglish is welcome). Answer directly; keep it short unless asked for depth; use short lists when they help.
Use the LIVE STUDIO SNAPSHOT for anything about the studio's own state, numbers, tasks, approvals, reels or spend. Never invent studio figures; if something is not in the snapshot, say so.
For general questions (strategy, ideas, scripts, captions, growth, research) answer from your knowledge — and from web search results when they are provided, citing them.
You can hand work to the 31-agent team. When the owner asks the studio to DO something that a goal template covers, propose it by ending your reply with ONE line exactly like:
ACTION: {"type":"start_goal","template":"<template id>","title":"<short title>","goal":"<clear goal for the agents>"}
Template ids: ${TEMPLATE_LIST()}. Only propose when the owner wants work done; the owner confirms with a button. Never claim you already started, posted, published, spent or deployed anything.
For approvals, uploads, settings or connections, point to the panel place (e.g. Agents → decisions, LittleLoop → Reel Factory, Characters → upload sheet, AI Connection).`;

/** Pulls a trailing ACTION: {...} line out of the reply and validates it. */
export function extractAction(text) {
  const m = /\n?\s*ACTION:\s*(\{[\s\S]*\})\s*$/.exec(text);
  if (!m) return { text: text.trim(), action: null };
  let action = null;
  try {
    const a = JSON.parse(m[1]);
    if (a?.type === 'start_goal' && a.template in TEMPLATES && typeof a.title === 'string' && typeof a.goal === 'string' && a.title.trim() && a.goal.trim())
      action = { type: 'start_goal', template: a.template, title: a.title.trim().slice(0, 140), goal: a.goal.trim().slice(0, 2000) };
  } catch {
    action = null;
  }
  return { text: text.slice(0, m.index).trim(), action };
}

async function callOpenAI(env, db, messages, deps = {}) {
  const fetchImpl = deps.fetch ?? fetch;
  const model = openaiModel(env);
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OPENAI_TIMEOUT);
  let status = null;
  try {
    const res = await fetchImpl('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model, messages }),
      signal: ctrl.signal,
    });
    status = res.status;
    const raw = await res.text();
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${raw.split(env.OPENAI_API_KEY).join('[redacted]').slice(0, 300)}`);
    const body = JSON.parse(raw);
    const text = body.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('OpenAI returned no text');
    await logCall(db, 'openai', model, 'success', status, body.usage?.prompt_tokens, body.usage?.completion_tokens, started, null);
    return { text, model };
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'OpenAI timed out' : String(e.message);
    await logCall(db, 'openai', model, 'error', status, null, null, started, msg);
    throw new HttpError(502, msg);
  } finally {
    clearTimeout(timer);
  }
}

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
  const timer = setTimeout(() => ctrl.abort(), GEMINI_TIMEOUT);
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
    return { text, model, interactionId: r.id ?? null, thoughts: thoughts.join('\n\n').trim() || null, sources: sources.slice(0, 12), queries };
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'Gemini timed out' : String(e.message);
    await logCall(db, 'gemini', model, 'error', status, null, null, started, msg);
    throw Object.assign(new Error(msg), { status });
  } finally {
    clearTimeout(timer);
  }
}

export async function send(env, db, providers, { message, engine = 'gemini', think = false, research = false }, deps = {}) {
  if (typeof message !== 'string' || !message.trim()) throw new HttpError(400, 'message is required');
  if (message.length > MAX_MSG) throw new HttpError(400, `message max ${MAX_MSG} chars`);
  if (!['gemini', 'openai'].includes(engine)) throw new HttpError(400, 'engine must be gemini or openai');
  const eng = engines(env).find((e) => e.id === engine);
  if (!eng.available) throw new HttpError(409, `${eng.name} is not available: ${eng.note}`);

  const past = await history(db, HISTORY);
  await db.prepare("INSERT INTO cbo_chat (id, role, content, created_at) VALUES (?, 'user', ?, ?)").bind(newId('msg'), message.trim(), nowIso()).run();
  const system = `${SYSTEM()}\n\nLIVE STUDIO SNAPSHOT (read just now):\n${await snapshot(env, db, providers)}`;

  let out;
  if (engine === 'openai') {
    const msgs = [{ role: 'system', content: system }, ...past.map((m) => ({ role: m.role, content: m.content })), { role: 'user', content: message.trim() }];
    out = await callOpenAI(env, db, msgs, deps);
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
  const { text, action } = extractAction(out.text);
  const reply = { id: newId('msg'), role: 'assistant', content: (text || '…').slice(0, 20000), engine, model: out.model, created_at: nowIso() };
  const mode = { think: Boolean(think && engine === 'gemini'), research: Boolean(research && engine === 'gemini'), fallback: out.fallback ?? null };
  await db.batch([
    db.prepare('INSERT INTO cbo_chat (id, role, content, engine, model, created_at) VALUES (?,?,?,?,?,?)').bind(reply.id, reply.role, reply.content, reply.engine, reply.model, reply.created_at),
    db.prepare('INSERT INTO cbo_chat_meta (msg_id, interaction_id, thoughts, sources_json, action_json, mode_json) VALUES (?,?,?,?,?,?)').bind(reply.id, out.interactionId ?? null, out.thoughts ?? null, JSON.stringify(out.sources ?? []), action ? JSON.stringify(action) : null, JSON.stringify(mode)),
  ]);
  return { ...reply, thoughts: out.thoughts ?? null, sources: out.sources ?? [], action, mode };
}
