// Pipeline status CLI — the only way runners change public pipeline status.
// Public data holds status only; deliverable content lives in the private vault.
//
//   node scripts/pipeline.mjs route  --title "New monsoon song" [--labels sunverse,goal]
//   node scripts/pipeline.mjs create --template sunverse_song_release --title "..." --goal vault#12 --engine claude
//   node scripts/pipeline.mjs next   --id <pipelineId>                 # steps ready to run now
//   node scripts/pipeline.mjs step   --id <pipelineId> --key lyrics --status running|completed|failed|approval_required|skipped [--qa pass|fail]
//   node scripts/pipeline.mjs show   --id <pipelineId>
//
// Enforced: dependencies, gate QA, bounded retries (agent maxRetries), derived pipeline status,
// schema validation of the whole store before writing.
import {
  readJson,
  writeJson,
  readRegistry,
  readPipelineTemplates,
  derivePipelineStatus,
  validateAll,
  nowIso,
  stamp,
  prependTrim,
  LIMITS,
  ENGINES,
} from './lib.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const arg = (name) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

const registry = readRegistry();
const { templates, routing } = readPipelineTemplates();
const store = readJson('pipelines.json');
const find = (id) => store.pipelines.find((p) => p.id === id) ?? fail(`unknown pipeline ${id}`);

/** Routing: label match first, then keyword score, then fallback. Exported for tests. */
export function route(title, labels = []) {
  for (const l of labels) if (routing.labels[l.toLowerCase()]) return routing.labels[l.toLowerCase()];
  const t = ` ${title.toLowerCase()} `;
  let best = null;
  let bestScore = 0;
  for (const [tpl, words] of Object.entries(routing.keywords)) {
    const score = words.filter((w) => t.includes(w)).length;
    if (score > bestScore) [best, bestScore] = [tpl, score];
  }
  return best ?? routing.fallback;
}

function save() {
  writeJson('pipelines.json', store);
  const errors = validateAll();
  if (errors.length) {
    console.error('Store invalid after change (not kept):\n - ' + errors.join('\n - '));
    process.exit(1);
  }
}

function ready(p) {
  return p.steps.filter(
    (s) =>
      (s.status === 'pending' || s.status === 'failed') &&
      s.dependsOn.every((d) => p.steps.find((x) => x.key === d).status === 'completed'),
  );
}

function print(p) {
  console.log(`${p.id}  [${p.status}]  ${p.title}  (${p.template}, ${p.goalRef ?? 'no goal ref'})`);
  for (const s of p.steps) {
    const a = registry.agents.find((x) => x.id === s.agent);
    console.log(
      `  ${s.status.padEnd(17)} ${s.key.padEnd(12)} ${a.name.padEnd(12)} ${s.deliverable}` +
        `${s.gate ? ' [gate]' : ''}${s.approval ? ' [approval]' : ''}${s.qa ? ` qa=${s.qa}` : ''}${s.attempts ? ` attempts=${s.attempts}` : ''}`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  switch (cmd) {
    case 'route': {
      const title = arg('title') ?? fail('--title required');
      const labels = (arg('labels') ?? '').split(',').filter(Boolean);
      console.log(route(title, labels));
      break;
    }
    case 'create': {
      const template = arg('template') ?? fail('--template required');
      const tpl = templates[template] ?? fail(`unknown template ${template}`);
      const title = (arg('title') ?? fail('--title required')).slice(0, 100);
      const engine = arg('engine') ?? 'claude';
      if (!ENGINES.includes(engine)) fail('bad --engine');
      const goalRef = arg('goal') ?? null;
      if (goalRef && store.pipelines.some((p) => p.goalRef === goalRef)) fail(`pipeline for ${goalRef} already exists`);
      const now = nowIso();
      const p = {
        id: `p_${stamp()}_${template.split('_')[0]}`,
        template,
        brand: tpl.brand,
        title,
        goalRef,
        status: 'pending',
        engine,
        createdAt: now,
        updatedAt: now,
        steps: tpl.steps.map((s) => ({
          key: s.key,
          agent: s.agent,
          deliverable: s.deliverable,
          dependsOn: s.dependsOn,
          ...(s.gate ? { gate: true } : {}),
          ...(s.approval ? { approval: true } : {}),
          status: 'pending',
          attempts: 0,
        })),
      };
      store.pipelines = prependTrim(store.pipelines, [p], LIMITS.pipelines);
      save();
      console.log(p.id);
      break;
    }
    case 'next': {
      const p = find(arg('id') ?? fail('--id required'));
      const r = ready(p);
      if (!r.length) console.log(p.status === 'approval_required' ? 'WAITING_FOR_APPROVAL' : p.status === 'completed' ? 'DONE' : 'NONE_READY');
      for (const s of r) console.log(`${s.key} ${s.agent}`);
      break;
    }
    case 'step': {
      const p = find(arg('id') ?? fail('--id required'));
      const key = arg('key') ?? fail('--key required');
      const status = arg('status') ?? fail('--status required');
      const s = p.steps.find((x) => x.key === key) ?? fail(`unknown step ${key}`);
      const agent = registry.agents.find((a) => a.id === s.agent);
      const unmet = s.dependsOn.filter((d) => p.steps.find((x) => x.key === d).status !== 'completed');
      if (['running', 'completed', 'approval_required'].includes(status) && unmet.length)
        fail(`${key}: dependencies not completed (${unmet.join(', ')})`);
      if (status === 'running') {
        if (s.attempts >= agent.maxRetries + 1) fail(`${key}: retry limit reached (${s.attempts} attempts) — needs HANUMAN / human review`);
        s.attempts += 1;
      }
      if (status === 'completed' && s.approval && s.status !== 'approval_required')
        fail(`${key}: approval step must go through approval_required first (human approval)`);
      if (status === 'approval_required' && !s.approval) fail(`${key}: not an approval step`);
      const qa = arg('qa');
      if (qa) {
        if (!['pass', 'fail'].includes(qa)) fail('--qa must be pass|fail');
        s.qa = qa;
      }
      if (status === 'completed' && s.gate && s.qa !== 'pass') fail(`${key}: gate cannot complete without --qa pass`);
      s.status = status;
      if (['completed', 'failed', 'skipped'].includes(status)) s.finishedAt = nowIso();
      p.status = derivePipelineStatus(p.steps);
      p.updatedAt = nowIso();
      save();
      print(p);
      break;
    }
    case 'show':
      print(find(arg('id') ?? fail('--id required')));
      break;
    default:
      console.error('Commands: route | create | next | step | show');
      process.exit(2);
  }
}
