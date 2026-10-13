// Agent execution contract: builds the prompt from the registry entry and validates the structured output.
import registry from '../agents/registry.json' with { type: 'json' };

export const REGISTRY = registry;
export const agentById = (id) => registry.agents.find((a) => a.id === id);

const MAX_UPSTREAM_CHARS = 12_000;
const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}\n…[truncated ${s.length - n} chars]` : s);

const STUDIO_RULES = [
  'Original work only: never reproduce existing lyrics, melodies, scripts, characters, artwork or a living artist\'s distinctive style.',
  'Never invent numbers, metrics, sources, chart positions or results. You have no web access in this step: do not cite URLs; mark market claims as hypotheses unless they come from the provided upstream evidence.',
  'Never include the studio owner\'s personal name, photo or identity in brand output.',
  'You prepare work only. You never publish, spend money or deploy; those need human approval.',
  'LittleLoop content is for children aged 2-8: it must be safe, kind and age-appropriate.',
];

/** Returns { system, prompt } for one task. `upstream` = [{ step_key, agent_id, deliverable, content }]. */
export function buildAgentPrompt({ agent, task, workflow, upstream }) {
  const brand = registry.brands[workflow.brand];
  const system = [
    `You are ${agent.name} (${agent.id}), ${agent.role} at Ganesha AI Studio.`,
    `Mission: ${agent.mission}`,
    agent.limits ? `Limits: ${agent.limits}` : '',
    'Studio rules:',
    ...STUDIO_RULES.map((r) => `- ${r}`),
  ]
    .filter(Boolean)
    .join('\n');

  const input = (() => {
    try {
      return JSON.parse(workflow.input_json || '{}');
    } catch {
      return {};
    }
  })();

  const parts = [
    `# Workflow: ${workflow.title}`,
    `Brand: ${brand ? `${brand.name} — ${brand.focus}` : workflow.brand}`,
    workflow.goal ? `Goal from the owner:\n${workflow.goal}` : '',
    Object.keys(input).length ? `Owner input:\n${JSON.stringify(input, null, 2)}` : '',
    `# Your step: ${task.step_key} → deliverable "${task.deliverable}"`,
    `Expected inputs: ${agent.inputs.join('; ')}`,
    `Expected outputs: ${agent.outputs.join('; ')}`,
  ];
  for (const u of upstream) {
    parts.push(`## Upstream: ${u.step_key} by ${u.agent_id} (${u.deliverable})\n${clip(u.content, MAX_UPSTREAM_CHARS)}`);
  }
  if (task.feedback) parts.push(`# Corrections required from the previous review\n${task.feedback}`);

  if (task.is_gate) {
    const keys = upstream.map((u) => u.step_key).join(', ');
    parts.push(
      '# Your job: review the upstream deliverables',
      `Acceptance criteria for this review:\n${agent.acceptance.map((c) => `- ${c}`).join('\n')}`,
      `Return JSON: {"verdict":"pass"|"fail","summary":string,"issues":[string],"fixes":[{"step_key":string,"instruction":string}]}`,
      `"fixes[].step_key" must be one of the upstream step keys you can see (${keys}) or an earlier step named in them. Use "fail" only for concrete, fixable problems.`,
    );
  } else {
    parts.push(
      '# Acceptance criteria (you must meet every one)',
      agent.acceptance.map((c) => `- ${c}`).join('\n'),
      'Return JSON: {"summary":string (<=300 chars),"deliverable":string (complete Markdown deliverable),"acceptance":[{"criterion":string,"met":boolean,"note":string}],"open_questions":[string]}',
      'List every acceptance criterion above in "acceptance", word for word, and be honest about "met".',
    );
  }
  return { system, prompt: parts.filter(Boolean).join('\n\n') };
}

/** Validates the model's JSON. Returns { ok, errors, value }. Unmet criteria count as a failed output. */
export function validateAgentOutput(agent, isGate, out) {
  const errors = [];
  if (!out || typeof out !== 'object') return { ok: false, errors: ['output is not a JSON object'] };
  if (isGate) {
    if (!['pass', 'fail'].includes(out.verdict)) errors.push('verdict must be "pass" or "fail"');
    if (typeof out.summary !== 'string' || !out.summary.trim()) errors.push('summary missing');
    if (!Array.isArray(out.issues)) errors.push('issues must be an array');
    if (!Array.isArray(out.fixes)) errors.push('fixes must be an array');
    else for (const f of out.fixes) if (!f || typeof f.step_key !== 'string' || typeof f.instruction !== 'string') errors.push('each fix needs step_key and instruction');
    if (out.verdict === 'fail' && Array.isArray(out.fixes) && out.fixes.length === 0) errors.push('a fail verdict needs at least one fix');
    return { ok: errors.length === 0, errors, value: out };
  }
  if (typeof out.summary !== 'string' || !out.summary.trim()) errors.push('summary missing');
  if (typeof out.deliverable !== 'string' || out.deliverable.trim().length < 80) errors.push('deliverable missing or too short');
  if (!Array.isArray(out.acceptance)) errors.push('acceptance must be an array');
  else {
    const norm = (s) => String(s ?? '').trim().toLowerCase();
    for (const c of agent.acceptance) {
      const row = out.acceptance.find((a) => norm(a?.criterion) === norm(c));
      if (!row) errors.push(`acceptance criterion not addressed: "${c}"`);
      else if (row.met !== true) errors.push(`acceptance criterion not met: "${c}"${row.note ? ` (${row.note})` : ''}`);
    }
  }
  return { ok: errors.length === 0, errors, value: out };
}
