// GANESHA CBO chat: a ChatGPT-style conversation with the studio's Chief Business Officer.
// Every reply is grounded in a live snapshot of the studio (tasks, approvals, reels, spend) read
// from D1 at question time. Engines: Gemini (free key, default) or OpenAI (only when the owner adds
// OPENAI_API_KEY — ChatGPT app plans do not include API access). The chat never changes anything
// by itself; it points the owner to the panel button that does.
import { callProvider } from './providers.mjs';
import { cboReport } from './cbo.mjs';
import * as reels from './reels.mjs';
import { HttpError, newId, nowIso } from './util.mjs';

const MAX_MSG = 4000;
const HISTORY = 16;
const OPENAI_TIMEOUT = 60_000;

export function engines(env) {
  return [
    { id: 'gemini', name: 'Gemini', available: Boolean(env.GEMINI_API_KEY), note: env.GEMINI_API_KEY ? 'Free key' : 'Set GEMINI_API_KEY' },
    { id: 'openai', name: 'ChatGPT', available: Boolean(env.OPENAI_API_KEY), note: env.OPENAI_API_KEY ? `OpenAI API · ${openaiModel(env)} (paid per message)` : 'Needs an OpenAI API key (ChatGPT app plans have no API access)' },
  ];
}
const openaiModel = (env) => (env.OPENAI_MODEL || 'gpt-5-mini').trim();

export async function history(db, limit = 60) {
  const rows = (await db.prepare('SELECT id, role, content, engine, model, created_at FROM cbo_chat ORDER BY created_at DESC, id DESC LIMIT ?').bind(limit).all()).results;
  return rows.reverse();
}

export async function clear(db) {
  await db.prepare('DELETE FROM cbo_chat').run();
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
  lines.push(`Money: API spend this month ₹${m.actualMonthInr ?? '?'}${m.unknownCostRows ? ` (+${m.unknownCostRows} rows with unknown cost)` : ''}; reserved ₹${m.reservedInr ?? 0}; subscriptions ~₹${m.subscriptionsMonthlyInr ?? '?'}/month; FX set: ${m.fxSet}.`);
  lines.push(`Providers: ${rep.health.providers.map((p) => `${p.provider} ${p.state}`).join(', ')}. Dispatch paused: ${rep.health.dispatchPaused}.`);
  const c = rf.config;
  lines.push(`LittleLoop Reel Factory: ${c.enabled ? 'ON' : 'OFF'}, ${c.perDay}/day, mode ${c.renderMode}${c.renderMode === 'flow' ? ` (${c.flowModel}, ~${c.flowCreditsPerReel} Flow credits/reel)` : ''}; character sheets ${rf.sheets.length} (${rf.sheets.filter((x) => x.active).map((x) => x.name).join(', ') || 'none'}); waiting for Flow clips ${rf.waitingForFlow}; waiting for owner approval ${rf.pendingApproval}; Instagram ${rf.connections.instagram ? 'connected' : 'not connected'}.`);
  lines.push(`Recent reels: ${rf.reels.slice(0, 6).map((r) => `${r.day}#${r.slot} ${r.status}${r.script?.title ? ` "${r.script.title}"` : ''}`).join('; ') || 'none'}.`);
  lines.push(`Recommended actions: ${rep.recommendedActions.slice(0, 8).join(' | ') || 'none'}.`);
  return lines.join('\n');
}

const SYSTEM = `You are GANESHA_CBO, the Chief Business Officer of Ganesha AI Studio — the owner's internal command center for three brands: LittleLoop (kids' animated Instagram Reels), Sunverse (YouTube music channel) and Foliocraft (portfolio builder).
Talk like a sharp, friendly business partner in a chat app. Reply in the owner's language (Hinglish is welcome). Keep answers short and direct unless asked for detail; use short lists when they help.
Use the LIVE STUDIO SNAPSHOT for anything about the studio's state, numbers, tasks, approvals, reels or spend. Never invent figures, tasks or results that are not in the snapshot; if something is not there, say you don't have it.
You cannot press buttons or change anything yourself. When the owner wants an action (approve, reject, start a goal, upload a character sheet, switch the reel factory on), tell them exactly which panel section does it (e.g. CBO → Decisions, Agents → agent card, LittleLoop → Reel Factory).
For general questions (strategy, content ideas, scripts, captions, growth) answer from your own knowledge like a normal assistant. Never claim to have posted, published, spent or deployed anything.`;

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
    await logOpenAI(db, model, 'success', status, body.usage, started, null);
    return { text, model };
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'OpenAI timed out' : String(e.message);
    await logOpenAI(db, model, 'error', status, null, started, msg);
    throw new HttpError(502, msg);
  } finally {
    clearTimeout(timer);
  }
}
async function logOpenAI(db, model, status, http, usage, started, error) {
  try {
    await db.prepare(`INSERT INTO provider_calls (id, provider, model, purpose, task_id, status, http_status, input_tokens, output_tokens, cost_usd, latency_ms, error, created_at) VALUES (?,?,?,?,NULL,?,?,?,?,NULL,?,?,?)`)
      .bind(newId('pc'), 'openai', model, 'cbo_chat', status, http, usage?.prompt_tokens ?? null, usage?.completion_tokens ?? null, Date.now() - started, error, nowIso()).run();
  } catch {
    /* logging never breaks the chat */
  }
}

export async function send(env, db, providers, { message, engine = 'gemini' }, deps = {}) {
  if (typeof message !== 'string' || !message.trim()) throw new HttpError(400, 'message is required');
  if (message.length > MAX_MSG) throw new HttpError(400, `message max ${MAX_MSG} chars`);
  if (!['gemini', 'openai'].includes(engine)) throw new HttpError(400, 'engine must be gemini or openai');
  const eng = engines(env).find((e) => e.id === engine);
  if (!eng.available) throw new HttpError(409, `${eng.name} is not available: ${eng.note}`);

  const past = await history(db, HISTORY);
  await db.prepare("INSERT INTO cbo_chat (id, role, content, created_at) VALUES (?, 'user', ?, ?)").bind(newId('msg'), message.trim(), nowIso()).run();
  const snap = await snapshot(env, db, providers);
  const system = `${SYSTEM}\n\nLIVE STUDIO SNAPSHOT (read just now):\n${snap}`;

  let text;
  let model;
  if (engine === 'openai') {
    const msgs = [{ role: 'system', content: system }, ...past.map((m) => ({ role: m.role, content: m.content })), { role: 'user', content: message.trim() }];
    ({ text, model } = await callOpenAI(env, db, msgs, deps));
  } else {
    const transcript = [...past.map((m) => `${m.role === 'user' ? 'Owner' : 'CBO'}: ${m.content}`), `Owner: ${message.trim()}`].join('\n\n');
    try {
      const out = await callProvider(env, db, 'gemini', { system, prompt: `${transcript}\n\nCBO:`, maxTokens: 2048, purpose: 'cbo_chat' }, deps);
      text = out.text.trim().replace(/^CBO:\s*/, '');
      model = out.model;
    } catch (e) {
      throw new HttpError(502, `Gemini: ${String(e.message).slice(0, 300)}`);
    }
  }
  const reply = { id: newId('msg'), role: 'assistant', content: text.slice(0, 20000), engine, model, created_at: nowIso() };
  await db.prepare('INSERT INTO cbo_chat (id, role, content, engine, model, created_at) VALUES (?,?,?,?,?,?)').bind(reply.id, reply.role, reply.content, reply.engine, reply.model, reply.created_at).run();
  return reply;
}
