// /api/brain/* — Ganesha Brain (owner-only; index.mjs checks the admin token first).
import { HttpError, json } from '../util.mjs';
import * as memory from './memory.mjs';
import * as skills from './skills.mjs';
import * as missions from './missions.mjs';
import { connectorStatus, testConnector, TARGETS } from './deliver.mjs';
import { routerStatus } from './router.mjs';

/** Returns a Response, or null when the path is not a Brain route. `sse` streams long work with keepalives. */
export async function brainRoute({ path, method, seg, env, db, ctx, readBody, sse }) {
  if (seg[1] !== 'brain') return null;

  if (path === '/api/brain' && method === 'GET') {
    const [m, s, mi] = await Promise.all([
      db.prepare('SELECT COUNT(*) AS n FROM brain_memory').first(),
      skills.listSkills(db),
      db.prepare("SELECT status, COUNT(*) AS n FROM missions GROUP BY status").all(),
    ]);
    return json({
      memoryCount: m?.n ?? 0,
      skillCount: s.length,
      missions: Object.fromEntries(mi.results.map((r) => [r.status, r.n])),
      engines: routerStatus(env),
      connectors: connectorStatus(env),
      targets: Object.entries(TARGETS).map(([id, t]) => ({ id, name: t.name })),
    });
  }

  /* memory */
  if (path === '/api/brain/memory' && method === 'GET') return json({ memory: await memory.listMemory(db) });
  if (path === '/api/brain/memory' && method === 'POST') {
    const b = await readBody();
    return json(await memory.addMemory(db, { scope: b.scope ?? 'studio', fact: b.fact, source: 'owner', pinned: b.pinned === true }), 201);
  }
  if (seg[2] === 'memory' && seg[3] && method === 'PATCH') return json(await memory.updateMemory(db, seg[3], await readBody()));
  if (seg[2] === 'memory' && seg[3] && method === 'DELETE') return json(await memory.deleteMemory(db, seg[3]));

  /* skills */
  if (path === '/api/brain/skills' && method === 'GET') return json({ skills: await skills.listSkills(db) });
  if (path === '/api/brain/skills' && method === 'PUT') return json(await skills.saveSkill(db, await readBody()));
  if (seg[2] === 'skills' && seg[3] && method === 'DELETE') return json(await skills.deleteSkill(db, seg[3]));

  /* connectors */
  if (seg[2] === 'connectors' && seg[3] && seg[4] === 'test' && method === 'POST') return json(await testConnector(env, seg[3]));

  /* missions */
  if (path === '/api/brain/missions' && method === 'GET') return json({ missions: await missions.listMissions(db) });
  if (path === '/api/brain/missions' && method === 'POST') {
    const b = await readBody();
    const work = () => missions.createMission(env, db, { goal: b.goal, brand: b.brand, deliver: b.deliver ?? [] });
    return b.stream === true ? sse(ctx, work) : json({ mission: await work() }, 201);
  }
  if (seg[2] === 'missions' && seg[3] && !seg[4] && method === 'GET') return json({ mission: await missions.getMission(db, seg[3]) });
  if (seg[2] === 'missions' && seg[3] && seg[4] === 'decide' && method === 'POST') {
    const b = await readBody();
    const r = await missions.decideMission(db, seg[3], { decision: b.decision, deliver: b.deliver });
    return json({ ...r, mission: await missions.getMission(db, seg[3]) });
  }
  // One step per call; streamed so a slow engine is never cut by Cloudflare's idle limit.
  if (seg[2] === 'missions' && seg[3] && seg[4] === 'advance' && method === 'POST') {
    const b = await readBody();
    const work = () => missions.advance(env, db, seg[3]);
    return b.stream === true ? sse(ctx, work) : json({ mission: await work() });
  }
  throw new HttpError(404, 'Not found');
}
