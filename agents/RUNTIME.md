# Agent runtime protocol (Claude engine)

How a scheduled Claude run executes goals through the 31-agent workforce.
Public repo `Connect-Pranav/Ganesha-AI-Studio` = code, contracts, **status only**.
Private repo `Connect-Pranav/Ganesha-AI-Vault` = goals (Issues) and **all deliverable content**.

## 1. Intake (GANESHA)
- Goals are open Issues in the vault labelled `goal` and NOT labelled `ganesha:done` or `ganesha:blocked`.
- Process at most **2 goals per run**, oldest first.
- For an issue already linked to a pipeline (comment `pipeline: p_...` exists), resume it.
- If the issue has a comment from the repo owner starting with `approve` (case-insensitive) after the
  latest `needs-approval` label was added, mark that pipeline's approval step `completed` and continue.
  A comment starting with `reject` → mark it `skipped`, write SAMVADA handoff, label `ganesha:done`.
- New goal → `node scripts/pipeline.mjs route --title "<issue title>" --labels "<labels>"` →
  `create --template <t> --title "<short neutral title>" --goal vault#<n> --engine claude`.
  Comment on the issue: `pipeline: <id>` and the planned steps.

## 2. Execute steps
Loop: `node scripts/pipeline.mjs next --id <id>` → for each ready step:
1. `step --key <k> --status running`
2. Act as that agent. Read its contract in `agents/teams/<team>.md` (or the agent's own `.md`).
   Inputs = the vault files of its `dependsOn` steps + the goal issue body.
3. Write the deliverable to the vault: `pipelines/<id>/<NN>-<key>-<AGENTNAME>.md` with front matter
   (`agent`, `step`, `pipeline`, `goal`, `createdAt`) then the content. NN = step order (01, 02…).
4. Self-check against every acceptance criterion; list them at the end as a checklist with ✅ / ❌.
5. `step --key <k> --status completed` (or `failed` with the reason in the vault file).

Steps with no dependency between them may be done in any order. Research steps must cite retrieved
URLs with retrieval dates. Never invent numbers, sources, analytics or results.

## 3. Gates
- **DHARMA** (`gate`): review copyright (no reproduced lyrics/characters/art), child safety (LittleLoop),
  privacy, platform policy incl. AI disclosure. Verdict `pass`/`fail` with exact issues.
- **CHITRAGUPTA** (`gate`): check each prior deliverable against its agent's acceptance criteria and the goal.
- Gate `fail` → `step --key <gate> --status failed --qa fail`, then re-run the specific failing upstream
  step(s) once with the gate's fixes (their status goes back to `running`), then re-run the gate.
  The CLI enforces retry limits; when it refuses, stop, label the issue `ganesha:blocked`, and explain.
- Gate `pass` → `step --key <gate> --status completed --qa pass`.

## 4. Approvals
Steps marked `approval` (publishing, spending, deploying, merging) are prepared but **never executed**:
write the package to the vault, then `step --key <k> --status approval_required`, label the issue
`needs-approval`, and comment a short summary + what "approve" will do. Stop that pipeline for this run.

## 5. Handoff & close (SAMVADA)
Write `pipelines/<id>/NN-handoff-SAMVADA.md`: decisions, files, open blockers, next owner (< 300 words).
Comment it on the issue. When the pipeline is `completed`, label `ganesha:done` and close the issue.

## 6. Record & publish
- Public activity/runs: write `out.json` and run `node scripts/record.mjs --engine claude --file out.json`
  (events: short neutral text, no deliverable content; one run per agent group executed).
- `npm run build` must pass in the public repo. Commit `public/agent-data` only; push.
- Commit vault changes; push. Never commit secrets. Never publish deliverable content in the public repo.

## 7. Failure
If anything breaks: mark the step `failed`, record a `failed` run with the real error, push both repos,
and comment the error on the issue. HANUMAN reviews failures in the weekly ops review.
