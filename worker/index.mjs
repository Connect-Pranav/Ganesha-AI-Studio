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
import { BRAND_SOURCES, getReport, scheduledAnalytics } from './analytics.mjs';
import { HttpError, json, nowIso, safeEqual } from './util.mjs';
import { ensureSchema } from './schema.mjs';
import { brandArtifacts, studioSummary } from './summary.mjs';
import { audit, cboReport, financeSummary, listTasks, planGoal, reassignTask, setDispatchPause, setTaskMeta, setWorkflowMeta, LIFECYCLE } from './cbo.mjs';
import { maybeRefreshFx, addPricing, addSubscription, deleteBudget, deleteSubscription, getSettings, listBudgets, listPricing, listSubscriptions, saveSettings, upsertBudget } from './finance.mjs';
import { runCommand } from './commands.mjs';
import { listConnections, testOpenAI } from './connections.mjs';
import { assignVoice, listAssignments, listVoices, recommendVoices, synthesize, updateVoiceSetting } from './voices.mjs';
import * as prod from './production.mjs';
import * as subintel from './subintel.mjs';
import { decideProposal, listProposals, runAutopilot, scheduledAutopilot } from './autopilot.mjs';
import * as reels from './reels.mjs';

const VERSION = '0.6.0-subintel';
// The GitHub Pages mirror reads the public analytics report from this Worker.
const ALLOWED_ORIGINS = ['https://connect-pranav.github.io'];
function corsHeaders(request) {
  const origin = request.headers.get('origin');
  return ALLOWED_ORIGINS.includes(origin) ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET', vary: 'origin' } : {};
}
const MAX_BODY = 64 * 1024;

function requireAdmin(request, env) {
  if (!env.ADMIN_TOKEN) throw new HttpError(503, 'Backend locked: secret ADMIN_TOKEN is not set on the Worker.');
  const h = request.headers.get('authorization') ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token || !safeEqual(token, env.ADMIN_TOKEN)) throw new HttpError(401, 'Missing or invalid admin token.');
}

async function requireDb(env) {
  if (!env.DB) throw new HttpError(503, 'D1 binding DB is not configured.');
  await ensureSchema(env.DB);
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
    // Booleans only — never key values.
    return json({ ok: true, version: VERSION, time: nowIso(), db: Boolean(env.DB), adminTokenSet: Boolean(env.ADMIN_TOKEN), geminiKeySet: Boolean(env.GEMINI_API_KEY), claudeKeySet: Boolean(env.ANTHROPIC_API_KEY), youtubeKeySet: Boolean(env.YOUTUBE_API_KEY), primaryEngine: env.PRIMARY_ENGINE || null, agents: REGISTRY.agents.length }, 200, corsHeaders(request));
  }

  // Public read: the report holds only public channel statistics, cached so a page view
  // triggers at most one YouTube fetch per hour and never a paid/AI call.
  if (seg[1] === 'analytics' && seg[2] && !seg[3] && method === 'GET') {
    if (!(seg[2] in BRAND_SOURCES)) throw new HttpError(404, 'Unknown brand');
    let report;
    try {
      report = await getReport(env, await requireDb(env), seg[2]);
    } catch (e) {
      console.error('analytics report failed', e?.stack ?? e);
      report = { brand: seg[2], connected: false, reason: `Analytics error: ${String(e?.message ?? e).slice(0, 300)}` };
    }
    return json(report, 200, corsHeaders(request));
  }
  if (seg[1] === 'analytics' && method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });

  requireAdmin(request, env);
  const db = await requireDb(env);
  // Keep a current USD→INR rate so every estimate can be shown in ₹ (owner-set rate always wins).
  await maybeRefreshFx(db);

  // Owner-triggered refresh + SOMA analysis (uses the AI provider).
  if (seg[1] === 'analytics' && seg[3] === 'refresh' && method === 'POST') {
    if (!(seg[2] in BRAND_SOURCES)) throw new HttpError(404, 'Unknown brand');
    return json(await getReport(env, db, seg[2], { force: true, withInsights: true, forceInsights: true }));
  }
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

  // Read-only dashboard aggregates (counted from D1, never estimated)
  if (path === '/api/summary' && method === 'GET') return json(await studioSummary(env, db, await providersStatus(env, db)));
  if (path === '/api/artifacts' && method === 'GET') {
    const brand = url.searchParams.get('brand');
    if (!['littleloop', 'sunverse', 'foliocraft', 'studio'].includes(brand)) throw new HttpError(400, 'brand must be littleloop, sunverse, foliocraft or studio');
    return json({ brand, artifacts: await brandArtifacts(db, brand, url.searchParams.get('limit')) });
  }

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

  // Notifications: everything that needs the owner, in one call.
  if (path === '/api/notifications' && method === 'GET') {
    const since = new Date(Date.now() - 7 * 86400_000).toISOString();
    const approvals = (
      await db
        .prepare(`SELECT a.id, a.action, a.summary, a.created_at, a.workflow_id, a.task_id,
                  w.title AS workflow_title, w.brand, t.agent_id, t.deliverable, t.output_artifact
                  FROM approvals a JOIN workflows w ON w.id = a.workflow_id JOIN tasks t ON t.id = a.task_id
                  WHERE a.status = 'pending' ORDER BY a.created_at DESC LIMIT 50`)
        .all()
    ).results;
    const external = (
      await db
        .prepare(`SELECT t.id AS task_id, t.step_key, t.deliverable, t.agent_id, t.updated_at, w.id AS workflow_id, w.title AS workflow_title, w.brand
                  FROM tasks t JOIN workflows w ON w.id = t.workflow_id WHERE t.status = 'waiting_for_external_action' ORDER BY t.updated_at DESC LIMIT 50`)
        .all()
    ).results;
    const failures = (
      await db
        .prepare(`SELECT t.id AS task_id, t.step_key, t.agent_id, t.error, t.updated_at, w.id AS workflow_id, w.title AS workflow_title, w.brand
                  FROM tasks t JOIN workflows w ON w.id = t.workflow_id WHERE t.status = 'failed' AND t.updated_at >= ? ORDER BY t.updated_at DESC LIMIT 50`)
        .bind(since)
        .all()
    ).results;
    const events = (await db.prepare('SELECT id, workflow_id, task_id, kind, message, created_at FROM events WHERE created_at >= ? ORDER BY id DESC LIMIT 40').bind(since).all()).results;
    const reelsWaiting = (await reels.overview(env, db)).reels.filter((r) => r.status === 'review').map((r) => ({ id: r.id, day: r.day, slot: r.slot, title: r.script?.title ?? 'LittleLoop reel', caption: r.caption, videoUrl: r.videoUrl, costUsd: r.costUsd }));
    return json({ approvals, external, failures, events, reels: reelsWaiting, counts: { approvals: approvals.length + reelsWaiting.length, external: external.length, failures: failures.length } });
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

  /* ---------- GANESHA_CBO: executive, operations, CFO ---------- */
  if (path === '/api/cbo/report' && method === 'GET') return json(await cboReport(env, db, await providersStatus(env, db)));
  if (path === '/api/cbo/plan' && method === 'POST') {
    const b = await readBody(request);
    return json(await planGoal(env, db, { template: b.template, title: typeof b.title === 'string' ? b.title.slice(0, 120) : '', count: b.count }));
  }
  if (path === '/api/cbo/command' && method === 'POST') {
    const { text } = await readBody(request);
    return json(await runCommand(env, db, await providersStatus(env, db), text));
  }
  if (path === '/api/cbo/tasks' && method === 'GET') {
    const state = url.searchParams.get('state');
    if (state && !LIFECYCLE.includes(state)) throw new HttpError(400, `state must be one of ${LIFECYCLE.join(', ')}`);
    return json({ lifecycle: LIFECYCLE, tasks: await listTasks(db, { brand: url.searchParams.get('brand'), state }) });
  }
  if (seg[1] === 'tasks' && seg[3] === 'meta' && method === 'PUT') return json(await setTaskMeta(db, seg[2], await readBody(request)));
  if (seg[1] === 'tasks' && seg[3] === 'agent' && method === 'PUT') {
    const { agentId } = await readBody(request);
    return json(await reassignTask(db, seg[2], agentId));
  }
  if (seg[1] === 'tasks' && seg[3] === 'estimates' && method === 'GET') {
    const rows = (await db.prepare('SELECT * FROM cost_estimates WHERE task_id = ? ORDER BY created_at DESC LIMIT 20').bind(seg[2]).all()).results;
    return json({ estimates: rows.map((r) => ({ ...r, assumptions: JSON.parse(r.assumptions_json), pricing: r.pricing_json ? JSON.parse(r.pricing_json) : null, assumptions_json: undefined, pricing_json: undefined })) });
  }
  if (seg[1] === 'workflows' && seg[3] === 'meta' && method === 'PUT') return json(await setWorkflowMeta(db, seg[2], await readBody(request)));

  if (path === '/api/finance' && method === 'GET') return json(await financeSummary(env, db));
  if (path === '/api/settings' && method === 'GET') return json(await getSettings(db));
  if (path === '/api/settings' && method === 'PUT') {
    const body = await readBody(request);
    const { dispatchPaused, ...rest } = body;
    const changed = [];
    if (typeof dispatchPaused === 'boolean') (await setDispatchPause(db, dispatchPaused), changed.push('dispatch_paused'));
    else if ('dispatchPaused' in body) throw new HttpError(400, 'dispatchPaused must be true or false');
    if (Object.keys(rest).length) {
      const keys = await saveSettings(db, rest);
      changed.push(...keys);
      await audit(db, 'config_change', `Settings changed: ${keys.join(', ')}`, { keys });
    }
    if (!changed.length) throw new HttpError(400, 'No known settings in body');
    if (dispatchPaused === false) kick();
    return json({ changed, settings: await getSettings(db) });
  }
  if (path === '/api/finance/budgets' && method === 'GET') return json({ budgets: await listBudgets(db) });
  if (path === '/api/finance/budgets' && method === 'POST') {
    const b = await upsertBudget(db, await readBody(request));
    await audit(db, 'config_change', `Budget ${b.scope}${b.scope_ref ? ` ${b.scope_ref}` : ''} = ₹${b.limit_inr}`);
    kick();
    return json({ budget: b });
  }
  if (seg[1] === 'finance' && seg[2] === 'budgets' && seg[3] && method === 'DELETE') {
    await deleteBudget(db, seg[3]);
    await audit(db, 'config_change', `Budget ${seg[3]} removed`);
    return json({ deleted: seg[3] });
  }
  if (path === '/api/finance/pricing' && method === 'GET') return json(await listPricing(db));
  if (path === '/api/finance/pricing' && method === 'POST') {
    const id = await addPricing(db, await readBody(request));
    await audit(db, 'config_change', `Pricing row ${id} added`);
    return json({ id }, 201);
  }
  if (path === '/api/finance/subscriptions' && method === 'GET') return json({ subscriptions: await listSubscriptions(db) });
  if (path === '/api/finance/subscriptions' && method === 'POST') {
    const id = await addSubscription(db, await readBody(request), (await getSettings(db)).fx_usd_inr);
    await audit(db, 'config_change', `Subscription ${id} added`);
    return json({ id }, 201);
  }
  if (seg[1] === 'finance' && seg[2] === 'subscriptions' && seg[3] && method === 'DELETE') {
    await deleteSubscription(db, seg[3]);
    await audit(db, 'config_change', `Subscription ${seg[3]} removed`);
    return json({ deleted: seg[3] });
  }

  /* ---------- CBO Autopilot ---------- */
  if (path === '/api/autopilot' && method === 'GET') {
    const s = await getSettings(db);
    return json({ mode: s.autopilot_mode, dailyInr: s.autopilot_daily_inr, maxGoals: s.autopilot_max_goals, proposals: await listProposals(db) });
  }
  if (path === '/api/autopilot/run' && method === 'POST') {
    const r = await runAutopilot(env, db, { force: true });
    if (r.actions.some((a) => a.status === 'started')) kick();
    return json(r);
  }
  if (seg[1] === 'autopilot' && seg[2] && ['approve', 'reject'].includes(seg[3]) && method === 'POST') {
    const r = await decideProposal(db, seg[2], seg[3]);
    if (r.status === 'started') kick();
    return json(r);
  }

  /* ---------- Subscription Intelligence ---------- */
  if (path === '/api/subintel' && method === 'GET') return json(await subintel.overview(env, db, await providersStatus(env, db)));
  if (path === '/api/subintel/daily' && method === 'GET') return json(await subintel.dailyLedger(db, Math.min(90, Math.max(1, Number(url.searchParams.get('days')) || 31))));
  if (path === '/api/subintel/sync' && method === 'POST') return json({ runs: await subintel.syncAll(env, db) });
  if (seg[1] === 'subintel' && seg[2] && !seg[3] && method === 'GET') return json(await subintel.serviceView(env, db, seg[2], await providersStatus(env, db)));
  if (seg[1] === 'subintel' && seg[3] === 'profile' && method === 'PUT') {
    const fields = await subintel.saveProfile(db, seg[2], await readBody(request));
    await audit(db, 'config_change', `Subscription profile ${seg[2]} updated: ${fields.join(', ')}`);
    return json({ updated: fields, view: await subintel.serviceView(env, db, seg[2], await providersStatus(env, db)) });
  }
  if (seg[1] === 'subintel' && seg[3] === 'import' && method === 'POST') {
    // Imports can be larger than other bodies (CSV exports): allow up to 1 MB here.
    const len = Number(request.headers.get('content-length') ?? 0);
    if (len > 1024 * 1024) throw new HttpError(413, 'Import too large (max 1 MB)');
    let b;
    try {
      b = JSON.parse(await request.text());
    } catch {
      throw new HttpError(400, 'Body must be JSON');
    }
    return json(await subintel.importRecords(db, seg[2], b));
  }
  if (path === '/api/cbo/decisions' && method === 'GET') {
    const task = url.searchParams.get('task');
    const stmt = task ? db.prepare('SELECT * FROM dispatch_decisions WHERE task_id = ? ORDER BY created_at DESC LIMIT 20').bind(task) : db.prepare('SELECT d.*, t.step_key, t.agent_id, w.title AS workflow_title FROM dispatch_decisions d LEFT JOIN tasks t ON t.id = d.task_id LEFT JOIN workflows w ON w.id = t.workflow_id ORDER BY d.created_at DESC LIMIT 50');
    return json({ decisions: (await stmt.all()).results.map((d) => ({ ...d, candidates: JSON.parse(d.candidates_json), candidates_json: undefined })) });
  }

  /* ---------- Provider & subscription manager ---------- */
  if (path === '/api/connections' && method === 'GET') return json({ connections: await listConnections(env, db, await providersStatus(env, db)), subscriptions: await listSubscriptions(db) });
  if (path === '/api/connections/openai/test' && method === 'POST') return json(await testOpenAI(env, db));

  /* ---------- Voice library + Smart Voice Director ---------- */
  if (path === '/api/voices' && method === 'GET') return json({ profiles: await listVoices(env, db) });
  if (path === '/api/voices/recommend' && method === 'POST') return json(await recommendVoices(env, db, await readBody(request)));
  if (path === '/api/voices/assign' && method === 'POST') return json({ assignment: await assignVoice(db, await readBody(request)) });
  if (path === '/api/voices/assignments' && method === 'GET') return json({ assignments: await listAssignments(db, url.searchParams.get('scope') ?? 'project', url.searchParams.get('ref') ?? '') });
  if (seg[1] === 'voices' && seg[2] && seg[3] === 'synthesize' && method === 'POST') {
    const { text } = await readBody(request);
    return json(await synthesize(env, db, seg[2], text));
  }
  if (seg[1] === 'voices' && seg[2] && !seg[3] && method === 'PUT') {
    await updateVoiceSetting(db, seg[2], await readBody(request));
    await audit(db, 'config_change', `Voice profile ${seg[2]} settings changed`);
    return json({ profiles: await listVoices(env, db) });
  }

  /* ---------- Characters, productions, scenes, assets ---------- */
  if (path === '/api/characters' && method === 'GET') return json({ characters: await prod.listCharacters(db, url.searchParams.get('brand')) });
  if (path === '/api/characters' && method === 'POST') return json({ id: await prod.saveCharacter(db, await readBody(request)) }, 201);
  if (seg[1] === 'characters' && seg[2] && !seg[3] && method === 'PUT') return json({ id: await prod.saveCharacter(db, await readBody(request), seg[2]) });
  if (path === '/api/productions' && method === 'GET') return json({ productions: await prod.listProductions(db, url.searchParams.get('brand')), pillars: prod.PILLARS });
  if (path === '/api/productions' && method === 'POST') return json({ id: await prod.createProduction(db, await readBody(request)) }, 201);
  if (seg[1] === 'productions' && seg[2] && !seg[3] && method === 'GET') return json(await prod.getProduction(db, seg[2]));
  if (seg[1] === 'productions' && seg[3] === 'scenes' && method === 'POST') return json({ id: await prod.addScene(db, seg[2], await readBody(request)) }, 201);
  if (seg[1] === 'scenes' && seg[3] === 'regenerate' && method === 'POST') return json(await prod.regenerateScene(db, seg[2], await readBody(request)));
  if (seg[1] === 'scenes' && seg[3] === 'versions' && method === 'GET') return json({ versions: await prod.sceneVersions(db, seg[2]) });
  if (seg[1] === 'scenes' && seg[3] === 'status' && method === 'PUT') {
    await prod.setSceneStatus(db, seg[2], await readBody(request));
    return json({ ok: true });
  }
  if (seg[1] === 'scenes' && seg[3] === 'flow-handoff' && method === 'POST') return json(await prod.prepareFlowHandoff(db, seg[2]));
  if (seg[1] === 'jobs' && seg[3] === 'complete' && method === 'POST') return json(await prod.completeJob(db, seg[2], await readBody(request)));
  if (path === '/api/assets' && method === 'POST') return json({ id: await prod.registerAsset(db, await readBody(request)) }, 201);
  if (seg[1] === 'assets' && seg[3] === 'status' && method === 'PUT') {
    const { status } = await readBody(request);
    await prod.setAssetStatus(db, seg[2], status);
    return json({ ok: true });
  }
  if (path === '/api/studio/prompt' && method === 'POST') {
    const b = await readBody(request);
    const ids = Array.isArray(b.characters) ? b.characters.slice(0, 10) : [];
    const chars = [];
    for (const id of ids) {
      const c = await db.prepare('SELECT * FROM characters WHERE id = ?').bind(id).first();
      if (c) chars.push(c);
    }
    return json({ prompt: prod.buildVideoPrompt(b.fields ?? {}, chars), fields: prod.PROMPT_FIELDS });
  }
  if (path === '/api/studio/learning' && method === 'GET') return json({ progress: await prod.learningProgress(db) });
  if (path === '/api/studio/learning' && method === 'PUT') {
    const { moduleId, status } = await readBody(request);
    await prod.setLearning(db, moduleId, status);
    return json({ ok: true });
  }

  /* ---------- LittleLoop Reel Factory ---------- */
  if (path === '/api/reels' && method === 'GET') return json(await reels.overview(env, db));
  if (path === '/api/reels/config' && method === 'PUT') return json({ config: await reels.saveConfig(db, await readBody(request)) });
  if (path === '/api/reels/sheets' && method === 'POST') {
    const id = await reels.addSheet(env, db, { name: url.searchParams.get('name'), notes: url.searchParams.get('notes') ?? '', mime: request.headers.get('content-type'), body: request.arrayBuffer() });
    return json({ id }, 201);
  }
  if (seg[1] === 'reels' && seg[2] === 'sheets' && seg[3] && !seg[4] && method === 'PUT') return json({ sheet: await reels.updateSheet(db, seg[3], await readBody(request)) });
  if (seg[1] === 'reels' && seg[2] === 'sheets' && seg[3] && seg[4] === 'image' && method === 'GET') return reels.sheetImage(env, db, seg[3]);
  if (seg[1] === 'reels' && seg[2] === 'runner') {
    await reels.runnerSeen(db);
    if (seg[3] === 'claim' && method === 'POST') return json(await reels.claim(env, db));
    if (seg[3] === 'usage' && method === 'POST') return json(await reels.recordUsage(db, await readBody(request)));
    if (seg[3] === 'sheets' && seg[4] && seg[5] === 'details' && method === 'PUT') {
      await reels.setSheetDetails(db, seg[4], await readBody(request));
      return json({ ok: true });
    }
    if (seg[3] && seg[4] === 'script' && method === 'PUT') {
      return json(await reels.saveScript(db, seg[3], (await readBody(request)).script));
    }
    if (seg[3] && seg[4] === 'video' && method === 'PUT') {
      let meta = {};
      try { meta = JSON.parse(url.searchParams.get('meta') ?? '{}'); } catch { throw new HttpError(400, 'meta must be JSON'); }
      await reels.saveVideo(env, db, seg[3], { body: request.body, length: Number(request.headers.get('content-length') ?? 0), meta });
      return json({ ok: true });
    }
    if (seg[3] && seg[4] === 'fail' && method === 'POST') return json(await reels.failJob(db, seg[3], (await readBody(request)).error, env));
    if (seg[3] && seg[4] === 'clips' && seg[5] && method === 'GET') return reels.clipFile(env, db, seg[3], seg[5]);
  }
  if (seg[1] === 'reels' && seg[2] && ['approve', 'reject', 'redo'].includes(seg[3]) && method === 'POST') {
    const b = await readBody(request);
    const reel = await reels.decide(db, seg[2], seg[3], b.reason ?? '', env);
    if (seg[3] === 'approve') ctx.waitUntil(reels.publishPass(env, db).catch((e) => console.error('reel publish failed', e.message)));
    return json({ reel });
  }

  // Manual orchestration pass (the cron does this automatically)
  if (path === '/api/orchestrator/tick' && method === 'POST') return json(await tick(env, db));

  throw new HttpError(404, 'Not found');
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    // Public, unguessable media links for approved reels (Instagram downloads the video from here).
    if (pathname.startsWith('/m/')) {
      if (!env.DB) return new Response('Not found', { status: 404 });
      await ensureSchema(env.DB);
      return reels.serveMedia(env, env.DB, pathname.slice(3));
    }
    // Google Flow clip upload links (the per-reel ticket is the credential; CORS-open so the
    // Flow tab can send clips straight here). GET → what to make, PUT /t/<ticket>/<n> → clip n.
    if (pathname.startsWith('/t/')) {
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, PUT, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' };
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      try {
        if (!env.DB) throw new HttpError(503, 'Database not configured');
        await ensureSchema(env.DB);
        const [, , ticket, n] = pathname.split('/');
        if (request.method === 'GET' && !n) return json(await reels.flowTicketInfo(env.DB, ticket), 200, cors);
        if (request.method === 'PUT' && n) return json(await reels.uploadClip(env, env.DB, ticket, n, { body: request.body, length: Number(request.headers.get('content-length') ?? 0), mime: request.headers.get('content-type') }), 200, cors);
        throw new HttpError(405, 'Use GET /t/<ticket> or PUT /t/<ticket>/<clip number>');
      } catch (e) {
        return json({ error: e instanceof HttpError ? e.message : `Internal error: ${String(e?.message ?? e).slice(0, 200)}` }, e instanceof HttpError ? e.status : 500, cors);
      }
    }
    if (!pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await route(request, env, ctx);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error('api error', e?.stack ?? e);
      // Message only (no stack): enough to diagnose without exposing internals.
      return json({ error: `Internal error: ${String(e?.message ?? e).slice(0, 300)}` }, 500);
    }
  },
  async scheduled(_event, env, ctx) {
    if (!env.DB) return;
    await ensureSchema(env.DB);
    await maybeRefreshFx(env.DB).catch(() => {});
    // Autopilot first (once a day), then the orchestration pass picks up anything it started.
    ctx.waitUntil(
      scheduledAutopilot(env, env.DB)
        .catch((e) => console.error('autopilot failed', e.message))
        .then(() => tick(env, env.DB))
        .then((r) => console.log('tick', JSON.stringify(r))),
    );
    // Account usage/cost sync (Admin APIs) at most every 6 hours, only when an Admin key is set.
    if (env.ANTHROPIC_ADMIN_KEY || env.OPENAI_ADMIN_KEY)
      ctx.waitUntil(
        env.DB.prepare("SELECT MAX(started_at) AS t FROM sync_runs").first()
          .then((r) => (!r?.t || Date.now() - Date.parse(r.t) > 6 * 3600_000 ? subintel.syncAll(env, env.DB) : null))
          .catch((e) => console.error('subintel sync failed', e.message)),
      );
    // Reel factory: queue today's reels (rotation, daily cap) and move approved reels to Instagram.
    ctx.waitUntil(
      reels.planToday(env.DB)
        .then(() => reels.publishPass(env, env.DB))
        .then((r) => r.length && console.log('reels', JSON.stringify(r)))
        .catch((e) => console.error('reels failed', e.message)),
    );
    ctx.waitUntil(scheduledAnalytics(env, env.DB).then((r) => r.length && console.log('analytics', JSON.stringify(r))).catch((e) => console.error('analytics failed', e.message)));
  },
};
