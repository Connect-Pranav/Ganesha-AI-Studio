// Generates agents/teams/<team>.md from agents/registry.json (single source of truth).
//   node scripts/gen-contracts.mjs          write files
//   node scripts/gen-contracts.mjs --check  exit 1 if files are stale (used by tests)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, readRegistry } from './lib.mjs';

const reg = readRegistry();
const check = process.argv.includes('--check');
let stale = 0;

const SHARED = `## Rules for every agent on this team
- Follow \`CLAUDE.md\` and \`agents/RUNTIME.md\`.
- Produce exactly the deliverable described; meet every acceptance criterion.
- Never claim work was done that wasn't. Never invent numbers, sources or results.
- Original work only — no reproduced lyrics, scripts, characters or artwork.
- No owner identity in public-facing output.
- Anything that publishes, spends money or deploys is marked approval-required and stops there.`;

for (const [teamId, team] of Object.entries(reg.teams)) {
  const agents = reg.agents.filter((a) => a.team === teamId);
  const body = [
    `# ${team.name}`,
    '',
    `<!-- Generated from agents/registry.json by scripts/gen-contracts.mjs — edit the registry, not this file. -->`,
    '',
    SHARED,
    '',
    ...agents.flatMap((a) => [
      `## ${a.name} — \`${a.id}\``,
      `**Role:** ${a.role}  `,
      `**Mission:** ${a.mission}`,
      '',
      `- **Inputs:** ${a.inputs.join('; ')}`,
      `- **Output:** ${a.outputs.join('; ')}`,
      `- **Permissions:** ${a.permissions.map((p) => '`' + p + '`').join(', ')}`,
      `- **Needs approval for:** ${a.approvalRequired.length ? a.approvalRequired.join(', ') : 'nothing'}`,
      ...(a.limits ? [`- **Limits:** ${a.limits}`] : []),
      '',
      '**Acceptance criteria**',
      ...a.acceptance.map((c) => `- [ ] ${c}`),
      '',
    ]),
  ].join('\n');
  const file = join(ROOT, 'agents', 'teams', `${teamId}.md`);
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (current !== body) {
    stale++;
    if (!check) writeFileSync(file, body);
  }
}
if (check && stale) {
  console.error(`${stale} team contract file(s) out of date — run: node scripts/gen-contracts.mjs`);
  process.exit(1);
}
console.log(check ? 'Team contracts up to date.' : 'Team contracts generated.');
