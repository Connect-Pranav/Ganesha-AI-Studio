// Ganesha AI Studio Worker: /api/* backend + the existing static dashboard (env.ASSETS).
// Every /api route except /api/health needs `Authorization: Bearer <ADMIN_TOKEN>`.
import { REGISTRY, agentById } from './agents.mjs';
import {
  TEMPLATES,
  completeExternalAction,
  createWorkflow,
  decideApproval,
  enginesFor,
  getTasks,
  getWorkflow,
  retryTask,
  setWorkflowState,
  tick,
} from './orchestrator.mjs';
import { PROVIDERS, providerConfig, testProvider } from './providers.mjs';
import { HttpError, json, nowIso, safeEqual } from './util.mjs';

const VERSION = '0.2.0-orchestrator';
const MAX_BODY = 64 * 1024;

function requireAdmin(request, env) {
  if (!env.ADMIN_TOKEN) throw new HttpError(503, 'Backend locked: secret ADMIN_TOKEN is not set on the Worker.');
  const h = request.headers.get('authorization') ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token || !safeEqual(token, env.ADMIN_TOKEN)) throw new HttpError(401, 'Missing or invalid admin token.');
}

function requireDb(env) {
  if (!env.DB) throw new HttpError(503, 'D1 binding DB is not configured.');
  return env.DB;
}

async function readBody(request) {
  const len = Number(request.headers.get('content-length') ?? 0);
  if (len > MAX_BODY) throw new HttpError(413, 'Request body too large');
  const text = await request.text();
  if (text.length > MAX_BODY) throw new HttpError(413, 'Request body too large');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Body must be JSON');
  }
}

async function providersStatus(env, db) {
  const out = [];
  for (const p of PROVIDERS) {
    const cfg = providerConfig(env, p);
    const lastOk = await db.prepare("SELECT model, created_at FROM provider_calls WHERE provider = ? AND status = 'success' ORDER BY created_at DESC LIMIT 1").bind(p).first();
    const lastErr = await db.prepare("SELECT model, error, http_status, created_at FROM provider_calls WHERE provider = ? AND status = 'error' ORDER BY created_at DESC LIMIT 1").bind(p).first();
    out.push({
      provider: p,
      model: cfg.model,
      // "key_set" is not "connected": only a successful live request proves a connection.
      state: !cfg.configured ? 'not_configured' : lastOk && (!lastErr || lastOk.created_at > lastErr.created_at) ? 'last_request_ok' : lastErr ? 'last_request_failed' : 'key_set_untested',
      lastSuccessAt: lastOk?.created_at ?? null,
      lastError: lastErr ? { at: lastErr.created_at, httpStatus: lastErr.http_status, message: lastErr.error } : null,
      costTracking: cfg.price ? 'configured' : 'tokens_only',
    });
  }
  return out;
}

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;
  const seg = path.split('/').filter(Boolean); // ['api', ...]

  if (path === '/api/health' && method === 'GET') {
    return json({ ok: true, version: VERSION, time: nowIso(), db: Boolean(env.DB), adminTokenSet: Boolean(env.ADMIN_TOKEN), agents: REGISTRY.agents.length });
  }

  requireAdmin(request, env);
  const db = requireDb(env);
  const kick = () => ctx.waitUntil(tick(env, db).catch((e) => console.error('tick failed', e.message)));

  // Providers
  if (path === '/api/providers' && method === 'GET') return json({ providers: await providersStatus(env, db) });
  if (seg[1] === 'providers' && seg[3] === 'test' && method === 'POST') {
    if (!PROVIDERS.includes(seg[2])) throw new HttpError(404, 'Unknown provider');
    return json(await testProvider(env, db, seg[2]));
  }
  if (path === '/api/usage' && method === 'GET') {
    const { results } = await db
      .prepare(`SELECT provider, model, purpose, COUNT(*) AS calls, SUM(status = 'error') AS errors,
                SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, SUM(cost_usd) AS cost_usd
                FROM provider_calls WHERE created_at >= ? GROUP BY provider, model, purpose ORDER BY provider, model`)
      .bind(new Date(Date.now() - 30 * 86400_000).toISOString())
      .all();
    return json({ windowDays: 30, rows: results, note: 'cost_usd is null unless a per-token price is configured.' });
  }

  // Agents and templates
  if (path === '/api/agents' && method === 'GET') {
    const agents = [];
    for (const a of REGISTRY.agents) agents.push({ id: a.id, name: a.name, team: a.team, role: a.role, mission: a.mission, inputs: a.inputs, outputs: a.outputs, acceptance: a.acceptance, approvalRequired: a.approvalRequired, maxRetries: a.maxRetries, engines: await enginesFor(db, env, a) });
    return json({ count: agents.length, agents });
  }
  if (seg[1] === 'agents' && seg[3] === 'engines' && method === 'PUT') {
    const agent = agentById(seg[2]);
    if (!agent) throw new HttpError(404, 'Unknown agent');
    const { engines } = await readBody(request);
    if (!Array.isArray(engines) || !engines.length || !engines.every((e) => PROVIDERS.includes(e))) throw new HttpError(400, `engines must be a non-empty list of ${PROVIDERS.join('/')}`);
    await db.prepare('INSERT INTO agent_settings (agent_id, engines, updated_at) VALUES (?,?,?) ON CONFLICT(agent_id) DO UPDATE SET engines = excluded.engines, updated_at = excluded.updated_at').bind(agent.id, JSON.stringify([...new Set(engines)]), nowIso()).run();
    return json({ agent: agent.id, engines: await enginesFor(db, env, agent) });
  }
  if (path === '/api/templates' && method === 'GET') return json({ templates: TEMPLATES });

  // Workflows
  if (path === '/api/workflows' && method === 'POST') {
    const body = await readBody(request);
    const res = await createWorkflow(db, { ...body, idempotencyKey: request.headers.get('idempotency-key') || body.idempotencyKey || null });
    if (!res.duplicate) kick();
    return json(res, res.duplicate ? 200 : 201);
  }
  if (path === '/api/workflows' && method === 'GET') {
    const status = url.searchParams.get('status');
    const stmt = status
      ? db.prepare('SELECT id, template, brand, title, status, created_at, updated_at FROM workflows WHERE status = ? ORDER BY updated_at DESC LIMIT 100').bind(status)
      : db.prepare('SELECT id, template, brand, title, status, created_at, updated_at FROM workflows ORDER BY updated_at DESC LIMIT 100');
    return json({ workflows: (await stmt.all()).results });
  }
  if (seg[1] === 'workflows' && seg[2] && !seg[3] && method === 'GET') {
    const wf = await getWorkflow(db, seg[2]);
    const tasks = await getTasks(db, wf.id);
    const approvals = (await db.prepare('SELECT * FROM approvals WHERE workflow_id = ? ORDER BY created_at').bind(wf.id).all()).results;
    const events = (await db.prepare('SELECT * FROM events WHERE workflow_id = ? ORDER BY id DESC LIMIT 100').bind(wf.id).all()).results;
    return json({ workflow: wf, tasks, approvals, events });
  }
  if (seg[1] === 'workflows' && ['pause', 'resume', 'cancel'].includes(seg[3]) && method === 'POST') {
    const status = await setWorkflowState(db, seg[2], seg[3]);
    if (seg[3] === 'resume') kick();
    return json({ id: seg[2], status });
  }

  // Tasks and artifacts
  if (seg[1] === 'tasks' && seg[2] && !seg[3] && method === 'GET') {
    const t = await db.prepare('SELECT * FROM tasks WHERE id = ?').bind(seg[2]).first();
    if (!t) throw new HttpError(404, 'Task not found');
    const artifacts = (await db.prepare('SELECT id, kind, version, created_at FROM artifacts WHERE task_id = ? ORDER BY version DESC').bind(t.id).all()).results;
    return json({ task: { ...t, depends_on: JSON.parse(t.depends_on) }, artifacts });
  }
  if (seg[1] === 'tasks' && seg[3] === 'retry' && method === 'POST') {
    const status = await retryTask(db, seg[2]);
    kick();
    return json({ task: seg[2], workflowStatus: status });
  }
  if (seg[1] === 'tasks' && seg[3] === 'complete-external' && method === 'POST') {
    const { reference } = await readBody(request);
    const status = await completeExternalAction(db, seg[2], { reference: typeof reference === 'string' ? reference.slice(0, 500) : null });
    kick();
    return json({ task: seg[2], workflowStatus: status });
  }
  if (seg[1] === 'artifacts' && seg[2] && method === 'GET') {
    const a = await db.prepare('SELECT * FROM artifacts WHERE id = ?').bind(seg[2]).first();
    if (!a) throw new HttpError(404, 'Artifact not found');
    return json({ ...a, content: JSON.parse(a.content_json), content_json: undefined });
  }

  // Approvals
  if (path === '/api/approvals' && method === 'GET') {
    const status = url.searchParams.get('status') ?? 'pending';
    return json({ approvals: (await db.prepare('SELECT * FROM approvals WHERE status = ? ORDER BY created_at DESC LIMIT 100').bind(status).all()).results });
  }
  if (seg[1] === 'approvals' && seg[2] && method === 'POST') {
    const { decision, note } = await readBody(request);
    const status = await decideApproval(db, seg[2], decision, { note: typeof note === 'string' ? note.slice(0, 500) : null });
    kick();
    return json({ approval: seg[2], decision, workflowStatus: status });
  }

  // Manual orchestration pass (the cron does this automatically)
  if (path === '/api/orchestrator/tick' && method === 'POST') return json(await tick(env, db));

  throw new HttpError(404, 'Not found');
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await route(request, env, ctx);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error('api error', e?.stack ?? e);
      return json({ error: 'Internal error' }, 500);
    }
  },
  async scheduled(_event, env, ctx) {
    if (!env.DB) return;
    ctx.waitUntil(tick(env, env.DB).then((r) => console.log('tick', JSON.stringify(r))));
  },
};
