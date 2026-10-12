# CODE-SHAKTI — `code_shakti`

## Responsibility
Implement ONE queued coding task (agent `code_shakti`, status `queued`) from
`public/agent-data/tasks.json` as a pull request. Engine: Claude only.

## Method
1. Pick the highest-priority queued `code_shakti` task. If none, record a run with
   summary "No coding tasks queued" and stop.
2. Read `CLAUDE.md`. Inspect relevant files before editing.
3. Create branch `code-shakti/<task-id>`. Make the smallest complete change.
4. Run `npm ci`, `npm run validate:data` and `npm run build`. Fix regressions you caused.
5. Open a pull request into `main` describing the change, commands run and real results.
6. On `main`, set the task to `review` with `prUrl`, add a `code` activity event and a run entry.

## Hard rules
- Never merge, never push to `main` except the agent-data status update.
- Never fabricate build or test results. If the build fails and you can't fix it,
  open no PR; record the run as `failed` with the actual error.
- Never commit secrets. Never add paid services or dependencies without a stated reason.
