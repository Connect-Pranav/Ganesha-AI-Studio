// GANESHA GROWTH AI — HTTP routes under /api/growth/*. Mounted after the owner (admin) check in
// worker/index.mjs, so every route here is owner-only. Brand scoping is enforced in each service.
import { HttpError } from '../util.mjs';
import { assertBrand, listBrandConfigs, saveBrandConfig, SCORE_COMPONENTS } from './brands.mjs';
import * as core from './core.mjs';
import * as out from './outreach.mjs';
import * as agents from './agents.mjs';
import * as stats from './analytics.mjs';

export async function growthRoute({ env, db, method, seg, url, body }) {
  const [, , r1, r2, r3] = seg; // seg = ['api','growth', r1, r2, r3]
  const q = (k) => url.searchParams.get(k);
  const b = () => body();

  if (r1 === 'brands' && !r2 && method === 'GET') return { brands: await listBrandConfigs(db), scoreComponents: SCORE_COMPONENTS, channels: out.channels(env) };
  if (r1 === 'brands' && r2 && method === 'PUT') return { brand: await saveBrandConfig(db, r2, await b()) };

  if (r1 === 'overview' && method === 'GET') return stats.overview(db, q('brand') || null);

  if (r1 === 'campaigns' && !r2 && method === 'GET') return { campaigns: await core.listCampaigns(db, q('brand') || null) };
  if (r1 === 'campaigns' && !r2 && method === 'POST') return { campaign: await core.createCampaign(db, await b()) };
  if (r1 === 'campaigns' && r2 && !r3 && method === 'PUT') return { campaign: await core.updateCampaign(db, r2, await b()) };
  if (r1 === 'campaigns' && r2 && r3 === 'spend' && method === 'GET') return agents.campaignSpend(db, r2);
  if (r1 === 'campaigns' && r2 && r3 === 'discover' && method === 'POST') return agents.discover(env, db, r2, await b());
  if (r1 === 'campaigns' && r2 && ['activate', 'pause', 'resume', 'cancel', 'complete'].includes(r3) && method === 'POST') return { campaign: await core.setCampaignStatus(db, r2, r3) };

  if (r1 === 'leads' && !r2 && method === 'GET')
    return { leads: await core.listLeads(db, { brand: q('brand'), campaignId: q('campaign'), stage: q('stage'), minScore: q('minScore'), q: q('q'), includeDemo: q('demo') !== '0' }) };
  if (r1 === 'leads' && !r2 && method === 'POST') {
    const res = await core.createLead(db, await b());
    if (res.duplicate) throw new HttpError(409, `Duplicate: "${res.duplicate.name}" is already in this brand's CRM`);
    return res;
  }
  if (r1 === 'leads' && r2 === 'import' && method === 'POST') return core.importLeads(db, await b());
  if (r1 === 'leads' && r2 && !r3 && method === 'GET') return core.leadDetail(db, r2);
  if (r1 === 'leads' && r2 && !r3 && method === 'PUT') return { lead: await core.updateLead(db, r2, await b()) };
  if (r1 === 'leads' && r2 && r3 === 'stage' && method === 'POST') return { lead: await core.moveStage(db, r2, await b()) };
  if (r1 === 'leads' && r2 && r3 === 'research' && method === 'POST') return agents.research(env, db, r2);
  if (r1 === 'leads' && r2 && r3 === 'qualify' && method === 'POST') return agents.qualify(env, db, r2);
  if (r1 === 'leads' && r2 && r3 === 'draft' && method === 'POST') return agents.draftOutreach(env, db, r2, await b());
  if (r1 === 'leads' && r2 && r3 === 'manual-draft' && method === 'POST') return { draft: await out.createDraft(env, db, { ...(await b()), leadId: r2 }) };
  if (r1 === 'leads' && r2 && r3 === 'reply' && method === 'POST') return agents.classifyReply(env, db, r2, await b());

  if (r1 === 'drafts' && !r2 && method === 'GET') return { drafts: await out.listDrafts(db, { brand: q('brand') ? assertBrand(q('brand')) : null, status: q('status') }) };
  if (r1 === 'drafts' && r2 && !r3 && method === 'PUT') return { draft: await out.editDraft(db, r2, await b()) };
  if (r1 === 'drafts' && r2 && r3 === 'approve' && method === 'POST') return { draft: await out.approveDraft(db, r2) };
  if (r1 === 'drafts' && r2 && r3 === 'reject' && method === 'POST') return { draft: await out.rejectDraft(db, r2, (await b()).reason) };
  if (r1 === 'drafts' && r2 && r3 === 'send' && method === 'POST') return { draft: await out.sendDraft(env, db, r2, { confirmSent: (await b()).confirmSent === true }) };

  if (r1 === 'suppressions' && !r2 && method === 'GET') return { suppressions: await core.listSuppressions(db, q('brand') || null) };
  if (r1 === 'suppressions' && !r2 && method === 'POST') return core.addSuppression(db, await b());
  if (r1 === 'suppressions' && r2 && method === 'DELETE') return core.removeSuppression(db, r2);

  if (r1 === 'tasks' && !r2 && method === 'GET') return { tasks: await core.listTasks(db, q('brand')) };
  if (r1 === 'tasks' && !r2 && method === 'POST') return { task: await core.createTask(db, await b()) };
  if (r1 === 'tasks' && r2 && method === 'PUT') return { task: await core.updateTask(db, r2, await b()) };

  if (r1 === 'replies' && method === 'GET') return { replies: (await db.prepare('SELECT r.*, l.name AS lead_name FROM growth_replies r JOIN growth_leads l ON l.id = r.lead_id WHERE r.brand = ? ORDER BY r.received_at DESC LIMIT 100').bind(assertBrand(q('brand'))).all()).results };
  if (r1 === 'jobs' && method === 'GET') return { jobs: await agents.listJobs(db, assertBrand(q('brand'))) };
  if (r1 === 'demo' && method === 'POST') return stats.loadDemo(db);
  if (r1 === 'demo' && method === 'DELETE') return stats.clearDemo(db);
  throw new HttpError(404, 'Unknown Growth AI route');
}
