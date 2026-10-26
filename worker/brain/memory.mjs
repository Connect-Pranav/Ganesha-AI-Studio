// Ganesha Brain — long-term memory shared by the agents.
// Scopes: 'studio' (every agent), a brand ('littleloop' | 'sunverse' | 'foliocraft'), or one agent id.
// Facts come from the owner (Brain → Memory), from chat (an agent's REMEMBER line) or from a finished
// mission (its LESSON lines). Secrets are refused, duplicates are skipped, the owner can pin or delete.
import { REGISTRY, agentById } from '../agents.mjs';
import { HttpError, newId, nowIso } from '../util.mjs';

export const BRANDS = ['littleloop', 'sunverse', 'foliocraft'];
const MAX_FACT = 400;
const MAX_IN_PROMPT = 25;
const PROMPT_CHARS = 3500;
// Keys, tokens, passwords and card-like numbers never become memory.
const SECRETISH = /(sk-[A-Za-z0-9_-]{10,}|gsk_[A-Za-z0-9]{10,}|github_pat_|ghp_[A-Za-z0-9]{10,}|ntn_[A-Za-z0-9]{10,}|AIza[0-9A-Za-z_-]{20,}|hooks\.slack\.com\/services|password\s*[:=]|\b(?:\d[ -]?){13,19}\b)/i;

export const brandOf = (agent) => {
  const b = REGISTRY.teams?.[agent?.team]?.brand;
  return BRANDS.includes(b) ? b : 'studio';
};

function validScope(scope) {
  if (scope === 'studio' || BRANDS.includes(scope) || agentById(scope) || scope === 'mushak_growth') return scope;
  throw new HttpError(400, 'scope must be studio, a brand or an agent id');
}
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9ऀ-ॿ]+/g, ' ').trim();

export async function addMemory(db, { scope = 'studio', fact, source = 'owner', agentId = null, pinned = false }) {
  validScope(scope);
  const f = String(fact ?? '').replace(/\s+/g, ' ').trim();
  if (f.length < 4) throw new HttpError(400, 'fact is too short');
  if (f.length > MAX_FACT) throw new HttpError(400, `fact max ${MAX_FACT} chars`);
  if (SECRETISH.test(f)) throw new HttpError(400, 'That looks like a key, password or card number — memory never stores those.');
  const existing = (await db.prepare('SELECT id, fact FROM brain_memory WHERE scope = ?').bind(scope).all()).results;
  const dup = existing.find((r) => norm(r.fact) === norm(f));
  const now = nowIso();
  if (dup) {
    await db.prepare('UPDATE brain_memory SET updated_at = ? WHERE id = ?').bind(now, dup.id).run();
    return { id: dup.id, duplicate: true };
  }
  const id = newId('mem');
  await db
    .prepare('INSERT INTO brain_memory (id, scope, agent_id, fact, source, pinned, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .bind(id, scope, agentId, f, source, pinned ? 1 : 0, now, now)
    .run();
  return { id, duplicate: false };
}

export async function listMemory(db, { scope = null } = {}) {
  const q = scope ? db.prepare('SELECT * FROM brain_memory WHERE scope = ? ORDER BY pinned DESC, updated_at DESC LIMIT 500').bind(scope) : db.prepare('SELECT * FROM brain_memory ORDER BY pinned DESC, updated_at DESC LIMIT 500');
  return (await q.all()).results.map((r) => ({ ...r, pinned: Boolean(r.pinned) }));
}

export async function updateMemory(db, id, { fact, pinned }) {
  const row = await db.prepare('SELECT * FROM brain_memory WHERE id = ?').bind(id).first();
  if (!row) throw new HttpError(404, 'Memory not found');
  if (fact !== undefined) {
    const f = String(fact).replace(/\s+/g, ' ').trim();
    if (f.length < 4 || f.length > MAX_FACT) throw new HttpError(400, `fact must be 4–${MAX_FACT} chars`);
    if (SECRETISH.test(f)) throw new HttpError(400, 'That looks like a key, password or card number — memory never stores those.');
    await db.prepare('UPDATE brain_memory SET fact = ?, updated_at = ? WHERE id = ?').bind(f, nowIso(), id).run();
  }
  if (pinned !== undefined) await db.prepare('UPDATE brain_memory SET pinned = ? WHERE id = ?').bind(pinned ? 1 : 0, id).run();
  return { ok: true };
}

export async function deleteMemory(db, id) {
  const r = await db.prepare('DELETE FROM brain_memory WHERE id = ?').bind(id).run();
  if (!r.meta?.changes) throw new HttpError(404, 'Memory not found');
  return { ok: true };
}

/** The facts an agent should know: studio-wide + its brand (or a mission's brand) + its own. Pinned first. */
export async function memoryFor(db, { agentId = null, brand = null } = {}) {
  const agent = agentId ? agentById(agentId) : null;
  const scopes = ['studio'];
  const b = brand && BRANDS.includes(brand) ? brand : agent ? brandOf(agent) : null;
  if (b && b !== 'studio') scopes.push(b);
  if (agentId) scopes.push(agentId);
  const rows = (
    await db
      .prepare(`SELECT id, scope, fact FROM brain_memory WHERE scope IN (${scopes.map(() => '?').join(',')}) ORDER BY pinned DESC, updated_at DESC LIMIT ?`)
      .bind(...scopes, MAX_IN_PROMPT)
      .all()
      .catch(() => ({ results: [] }))
  ).results;
  const out = [];
  let size = 0;
  for (const r of rows) {
    const line = `- [${r.scope}] ${r.fact}`;
    if (size + line.length > PROMPT_CHARS) break;
    out.push(line);
    size += line.length;
  }
  if (rows.length) await db.prepare(`UPDATE brain_memory SET uses = uses + 1 WHERE id IN (${rows.map(() => '?').join(',')})`).bind(...rows.map((r) => r.id)).run().catch(() => {});
  return out.join('\n');
}

/** Prompt block that tells an agent what it remembers and how to save something new. */
export function memoryBlock(facts, { defaultScope }) {
  return `LONG-TERM MEMORY (owner-approved studio facts; trust them over guesses):
${facts || '- (nothing saved yet)'}

To save a durable fact for the future (owner's lasting preference, a brand decision, a lesson that will matter next time), add a line at the very end: REMEMBER: <one short fact>  — or REMEMBER[studio]: / REMEMBER[littleloop|sunverse|foliocraft]: to choose who else should know. Default scope: ${defaultScope}. At most 3 lines, only when the owner says to remember something or a decision was clearly made. Never save keys, passwords, money amounts owed, or personal details about people.`;
}

/** Pulls REMEMBER lines out of a reply. Returns { text, facts: [{scope, fact}] }. */
export function extractRemember(text, defaultScope) {
  const facts = [];
  const kept = [];
  for (const line of String(text ?? '').split('\n')) {
    const m = /^\s*[-*]?\s*REMEMBER(?:\[([a-z_]+)\])?\s*:\s*(.+)$/.exec(line);
    if (m && facts.length < 3) {
      const scope = m[1] && (m[1] === 'studio' || BRANDS.includes(m[1])) ? m[1] : defaultScope;
      facts.push({ scope, fact: m[2].trim().slice(0, MAX_FACT) });
    } else if (!m) kept.push(line);
  }
  return { text: kept.join('\n').trim(), facts };
}

/** Saves extracted facts; a bad one (e.g. secret-looking) is skipped, never fatal. */
export async function saveFacts(db, facts, { source, agentId }) {
  const saved = [];
  for (const f of facts) {
    try {
      const r = await addMemory(db, { scope: f.scope, fact: f.fact, source, agentId });
      if (!r.duplicate) saved.push({ id: r.id, scope: f.scope, fact: f.fact });
    } catch {
      /* refused fact: ignore */
    }
  }
  return saved;
}
