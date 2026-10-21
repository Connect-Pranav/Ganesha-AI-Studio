// Gemini engine for Ganesha AI Studio agents. Runs in GitHub Actions (Node 20+, no deps).
//
//   node scripts/agent-runner.mjs --agent narada|ganesha|all
//
// Env: GEMINI_API_KEY (GitHub Secret, required), GEMINI_MODEL (optional repo variable).
// Without a key it exits cleanly and writes nothing — the dashboard then shows
// the Gemini engine as "Not configured". It never fabricates output.
import {
  readJson,
  writeJson,
  readRegistry,
  nowIso,
  stamp,
  validateFinding,
  validateTask,
  prependTrim,
  LIMITS,
} from './lib.mjs';

const ENGINE = 'gemini';
const MODEL = (process.env.GEMINI_MODEL || 'gemini-3.8-flash').trim();
const KEY = (process.env.GEMINI_API_KEY || '').trim();
const MOCK = process.env.AGENT_MOCK === '1'; // local pipeline test only — never committed
const registry = readRegistry();
const brandIds = Object.keys(registry.brands);

function log(msg) {
  console.log(`[${ENGINE}] ${msg}`);
}
function annotateError(msg) {
  console.log(`::error::${msg.replace(/\n/g, ' ')}`);
}

/* ---------------- Injectable side effects (tests replace these) ---------------- */
export const deps = {
  fetch: (...args) => globalThis.fetch(...args),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  random: () => Math.random(),
};

/* ---------------- Retry policy ---------------- */
// Backoff schedule per retry (5 s → 20 s → 60 s) with ±20% jitter. A Retry-After header,
// when present, replaces the schedule for that wait. Each wait is capped at 60 s and the
// total wait per call at 120 s, which keeps a full run inside the 15-minute job timeout.
export const RETRY = { scheduleMs: [5_000, 20_000, 60_000], maxWaitMs: 60_000, budgetMs: 120_000, jitter: 0.2 };

export function parseRetryAfter(value, now = Date.now()) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * 1000);
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : Math.max(0, t - now);
}

export function retryDelayMs(retryIndex, retryAfterMs = null, random = deps.random) {
  if (retryAfterMs != null) return Math.min(Math.max(retryAfterMs, 0), RETRY.maxWaitMs);
  const base = RETRY.scheduleMs[Math.min(retryIndex, RETRY.scheduleMs.length - 1)];
  const jittered = base * (1 + (random() * 2 - 1) * RETRY.jitter);
  return Math.min(Math.round(jittered), RETRY.maxWaitMs);
}

// Gemini returns 429 both for short rate limits (retryable) and for an exhausted quota
// (not retryable until the quota resets — retrying only burns the job's time).
export function isQuotaExhausted(status, text) {
  return status === 429 && /exceeded your current quota|quota exceeded/i.test(text);
}

/* ---------------- Gemini call with bounded retries ---------------- */
export async function callGemini(prompt, schema, maxRetries) {
  if (MOCK) return globalThis.__mockGemini(prompt);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, responseMimeType: 'application/json', responseSchema: schema },
  };
  let lastErr;
  let nextWaitMs = 0;
  let waitedMs = 0;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      if (waitedMs + nextWaitMs > RETRY.budgetMs) {
        log(`retry budget (${RETRY.budgetMs / 1000}s) exhausted — giving up`);
        break;
      }
      log(`waiting ${Math.round(nextWaitMs / 1000)}s before retry ${attempt}/${maxRetries}`);
      await deps.sleep(nextWaitMs);
      waitedMs += nextWaitMs;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90_000);
    let retryAfterMs = null;
    try {
      const res = await deps.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        const short = text.slice(0, 300);
        if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404) {
          // Not retryable: bad key, bad model id, or request problem.
          throw Object.assign(new Error(`Gemini HTTP ${res.status} (model "${MODEL}"): ${short}`), { fatal: true });
        }
        if (isQuotaExhausted(res.status, text)) {
          throw Object.assign(
            new Error(`Gemini quota exhausted for model "${MODEL}" (HTTP 429) — not retrying; wait for the quota reset or change GEMINI_MODEL: ${short}`),
            { fatal: true },
          );
        }
        retryAfterMs = parseRetryAfter(res.headers?.get?.('retry-after'));
        throw new Error(`Gemini HTTP ${res.status}: ${short}`);
      }
      const json = JSON.parse(text);
      const out = json?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      if (!out) throw new Error(`Gemini returned no content (finishReason: ${json?.candidates?.[0]?.finishReason ?? 'unknown'})`);
      return JSON.parse(out);
    } catch (err) {
      lastErr = err;
      if (err.fatal) throw err;
      log(`attempt ${attempt + 1}/${maxRetries + 1} failed: ${err.message}`);
      nextWaitMs = retryDelayMs(attempt, retryAfterMs);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

/* ---------------- Evidence: Google News RSS (free, real URLs) ---------------- */
function decode(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}
export function parseRss(xml) {
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const pick = (tag) => {
      const r = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      return r ? decode(r[1]) : '';
    };
    const title = pick('title');
    const link = pick('link');
    if (!title || !/^https?:\/\//.test(link)) continue;
    items.push({ title, url: link, source: pick('source') || 'Google News', pubDate: pick('pubDate') });
  }
  return items;
}

async function gatherEvidence(brandId) {
  if (MOCK) return globalThis.__mockEvidence(brandId);
  const brand = registry.brands[brandId];
  const seen = new Set();
  const out = [];
  const cutoff = Date.now() - 30 * 86400_000;
  for (const q of brand.queries) {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:30d')}&hl=en-IN&gl=IN&ceid=IN:en`;
    try {
      const res = await deps.fetch(url, { headers: { 'User-Agent': 'GaneshaAIStudio-NARADA/1.0' } });
      if (!res.ok) {
        log(`RSS ${res.status} for "${q}"`);
        continue;
      }
      const retrievedAt = nowIso();
      for (const it of parseRss(await res.text()).slice(0, 8)) {
        const t = Date.parse(it.pubDate);
        if (!Number.isNaN(t) && t < cutoff) continue;
        const key = it.title.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ ...it, retrievedAt });
      }
    } catch (err) {
      log(`RSS fetch failed for "${q}": ${err.message}`);
    }
  }
  return out.slice(0, 18);
}

/* ---------------- Store helpers ---------------- */
// Number of `failed` runs recorded by this invocation. main() turns it into exit code 2
// so the workflow can commit the failure record first and then go red.
let failedRuns = 0;
export const EXIT_AGENT_FAILED = 2;

function recordRun(agent, startedAt, status, summary, error) {
  const store = readJson('runs.json');
  const run = {
    id: `run_${stamp()}_${agent.split('_')[0]}_${ENGINE}`,
    agent,
    engine: ENGINE,
    startedAt,
    finishedAt: nowIso(),
    status,
    summary: summary.slice(0, 300),
    ...(status !== 'success' ? { error: (error || 'Unknown error').slice(0, 1000) } : {}),
  };
  store.runs = prependTrim(store.runs, [run], LIMITS.runs);
  writeJson('runs.json', store);
  if (status === 'failed') failedRuns++;
  log(`run recorded: ${status} — ${run.summary}`);
}
function addEvents(events) {
  const store = readJson('activity.json');
  store.events = prependTrim(store.events, events, LIMITS.events);
  writeJson('activity.json', store);
}
let evSeq = 0;
const event = (brand, agent, kind, text) => ({
  id: `e_${stamp()}_${++evSeq}_${ENGINE}`,
  at: nowIso(),
  brand,
  agent,
  engine: ENGINE,
  kind,
  text: text.slice(0, 200),
});
const agentDef = (id) => registry.agents.find((a) => a.id === id);

/* ---------------- NARADA ---------------- */
const findingSchema = {
  type: 'OBJECT',
  properties: {
    findings: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          insight: { type: 'STRING' },
          confidence: { type: 'STRING', format: 'enum', enum: ['high', 'medium', 'low'] },
          evidenceIndexes: { type: 'ARRAY', items: { type: 'INTEGER' } },
        },
        required: ['title', 'insight', 'confidence', 'evidenceIndexes'],
      },
    },
  },
  required: ['findings'],
};

async function runNarada() {
  const id = 'narada_market_intelligence';
  const startedAt = nowIso();
  const def = agentDef(id);
  const research = readJson('research.json');
  const recentTitles = research.findings
    .filter((f) => Date.now() - Date.parse(f.createdAt) < 7 * 86400_000)
    .map((f) => `${f.brand}: ${f.title}`);

  const newFindings = [];
  const events = [];
  const problems = [];
  let seq = 0;

  for (const brandId of brandIds) {
    const brand = registry.brands[brandId];
    const evidence = await gatherEvidence(brandId);
    if (evidence.length === 0) {
      problems.push(`${brand.name}: no sources retrieved`);
      continue;
    }
    const list = evidence.map((e, i) => `[${i}] ${e.title} — ${e.source} (${e.pubDate || 'date n/a'})`).join('\n');
    const prompt = `You are NARADA, market-intelligence agent for "${brand.name}" (${brand.focus}).
Below are headlines retrieved just now. Use ONLY these as evidence.

${list}

Already reported this week (do not repeat):
${recentTitles.filter((t) => t.startsWith(brandId)).join('\n') || '(none)'}

Write 1-3 findings useful for ${brand.name}. Each: a headline (<= 90 chars), an actionable insight
for this brand (<= 350 chars), confidence (high only if 2+ independent headlines support it),
and evidenceIndexes pointing to the headlines above. Never invent numbers, quotes or facts not in
the headlines. If nothing is relevant, return an empty findings array.`;

    try {
      const out = await callGemini(prompt, findingSchema, def.maxRetries);
      for (const f of (out.findings ?? []).slice(0, 3)) {
        const ev = [...new Set(f.evidenceIndexes ?? [])]
          .filter((i) => Number.isInteger(i) && evidence[i])
          .slice(0, 4)
          .map((i) => ({ title: evidence[i].title, url: evidence[i].url, source: evidence[i].source, retrievedAt: evidence[i].retrievedAt }));
        const finding = {
          id: `f_${stamp()}_${brandId}_${++seq}`,
          brand: brandId,
          title: String(f.title ?? '').slice(0, 120),
          insight: String(f.insight ?? '').slice(0, 600),
          confidence: f.confidence,
          evidence: ev,
          agent: id,
          engine: ENGINE,
          createdAt: nowIso(),
        };
        const errs = validateFinding(finding);
        if (errs.length) {
          log(`dropped invalid finding for ${brand.name}: ${errs.join(', ')}`);
          continue;
        }
        newFindings.push(finding);
      }
      const n = newFindings.filter((f) => f.brand === brandId).length;
      events.push(event(brandId, id, 'research', `${n} new finding${n === 1 ? '' : 's'} for ${brand.name} from ${evidence.length} sources`));
    } catch (err) {
      problems.push(`${brand.name}: ${err.message}`);
      if (err.fatal) break;
    }
  }

  if (newFindings.length) {
    research.findings = prependTrim(research.findings, newFindings, LIMITS.findings);
    research.updatedAt = nowIso();
    writeJson('research.json', research);
  }
  if (events.length) addEvents(events);

  const status = problems.length === 0 ? 'success' : newFindings.length ? 'partial' : 'failed';
  recordRun(id, startedAt, status, `${newFindings.length} findings across ${brandIds.length} brands`, problems.join(' | '));
  if (status !== 'success') annotateError(`NARADA ${status}: ${problems.join(' | ')}`);
}

/* ---------------- GANESHA ---------------- */
const taskSchema = {
  type: 'OBJECT',
  properties: {
    tasks: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          brand: { type: 'STRING', format: 'enum', enum: brandIds },
          title: { type: 'STRING' },
          agent: { type: 'STRING', format: 'enum', enum: ['ganesha_orchestrator', 'narada_market_intelligence', 'code_shakti'] },
          priority: { type: 'STRING', format: 'enum', enum: ['high', 'medium', 'low'] },
          reason: { type: 'STRING' },
          sourceFindings: { type: 'ARRAY', items: { type: 'STRING' } },
          requiresApproval: { type: 'BOOLEAN' },
        },
        required: ['brand', 'title', 'agent', 'priority', 'reason', 'sourceFindings', 'requiresApproval'],
      },
    },
  },
  required: ['tasks'],
};

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

async function runGanesha() {
  const id = 'ganesha_orchestrator';
  const startedAt = nowIso();
  const def = agentDef(id);
  const research = readJson('research.json');
  const tasksStore = readJson('tasks.json');
  const recent = research.findings.filter((f) => Date.now() - Date.parse(f.createdAt) < 7 * 86400_000);

  if (recent.length === 0) {
    recordRun(id, startedAt, 'success', 'No findings from the last 7 days — nothing to plan');
    return;
  }
  const open = tasksStore.tasks.filter((t) => t.status !== 'done');
  const findingIds = new Set(recent.map((f) => f.id));
  const prompt = `You are GANESHA, orchestrator of an internal studio running three separate brands:
${brandIds.map((b) => `- ${b}: ${registry.brands[b].name} — ${registry.brands[b].focus}`).join('\n')}

Recent NARADA findings (id | brand | confidence | title | insight):
${recent.map((f) => `${f.id} | ${f.brand} | ${f.confidence} | ${f.title} | ${f.insight}`).join('\n')}

Open tasks (do not duplicate their intent):
${open.map((t) => `- [${t.brand}] ${t.title}`).join('\n') || '(none)'}

Create at most 3 new tasks per brand, each grounded in 1+ finding ids above (sourceFindings).
Route: content/production → ganesha_orchestrator; more research → narada_market_intelligence;
software/feature work → code_shakti. Title imperative, <= 90 chars. reason <= 300 chars.
priority high only if the finding is high-confidence and time-sensitive.
requiresApproval true if the task would publish content, spend money or deploy anything.
Never invent metrics or deadlines. Return an empty array if nothing is worth doing.`;

  try {
    const out = await callGemini(prompt, taskSchema, def.maxRetries);
    const existing = new Set(open.map((t) => norm(t.title)));
    const perBrand = {};
    const created = [];
    let seq = 0;
    for (const t of out.tasks ?? []) {
      const key = norm(String(t.title ?? ''));
      if (!key || existing.has(key)) continue;
      perBrand[t.brand] = (perBrand[t.brand] ?? 0) + 1;
      if (perBrand[t.brand] > 3) continue;
      const task = {
        id: `t_${stamp()}_${t.brand}_${++seq}`,
        title: String(t.title).slice(0, 120),
        brand: t.brand,
        agent: t.agent,
        status: 'queued',
        priority: t.priority,
        reason: String(t.reason ?? '').slice(0, 600),
        sourceFindings: (t.sourceFindings ?? []).filter((fid) => findingIds.has(fid)),
        requiresApproval: Boolean(t.requiresApproval),
        createdAt: nowIso(),
        createdBy: id,
        engine: ENGINE,
      };
      if (task.sourceFindings.length === 0) {
        log(`dropped task without valid source finding: ${task.title}`);
        continue;
      }
      const errs = validateTask(task);
      if (errs.length) {
        log(`dropped invalid task: ${errs.join(', ')}`);
        continue;
      }
      existing.add(key);
      created.push(task);
    }
    if (created.length) {
      tasksStore.tasks = prependTrim(tasksStore.tasks, created, LIMITS.tasks);
      tasksStore.updatedAt = nowIso();
      writeJson('tasks.json', tasksStore);
      addEvents(
        brandIds
          .filter((b) => perBrand[b])
          .map((b) => event(b, id, 'task', `Planned ${created.filter((c) => c.brand === b).length} task(s) for ${registry.brands[b].name}`)),
      );
    }
    recordRun(id, startedAt, 'success', `${created.length} new tasks planned`);
  } catch (err) {
    recordRun(id, startedAt, 'failed', 'Planning failed', err.message);
    annotateError(`GANESHA failed: ${err.message}`);
  }
}

/* ---------------- main ---------------- */
// Returns the process exit code: 0 = ok (or not configured), 1 = usage error,
// 2 = at least one agent run was recorded as `failed` (data already written).
export async function main(argv = process.argv.slice(2)) {
  const i = argv.indexOf('--agent');
  const which = i >= 0 ? argv[i + 1] : 'all';
  if (!['narada', 'ganesha', 'all'].includes(which)) {
    console.error('Usage: node scripts/agent-runner.mjs --agent narada|ganesha|all');
    return 1;
  }
  if (!KEY && !MOCK) {
    log('GEMINI_API_KEY is not configured — skipping. No data written.');
    return 0;
  }
  failedRuns = 0;
  log(`model ${MOCK ? '(mock)' : MODEL}`);
  if (which === 'narada' || which === 'all') await runNarada();
  if (which === 'ganesha' || which === 'all') await runGanesha();
  if (failedRuns > 0) {
    log(`${failedRuns} agent run(s) failed — exiting ${EXIT_AGENT_FAILED} after writing the records`);
    return EXIT_AGENT_FAILED;
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
