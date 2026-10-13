# Sidebar Audit — Ganesha AI Studio

Audit date: 2026-10-13. Audited commit: `df8f592` (main). Work branch: `audit/sidebar`.
No secrets are recorded here. All 31 agents, IDs, roles and relationships are unchanged.

## Root cause of most gaps
The studio runs on two systems: the **live backend** (Cloudflare Worker + D1: goals, 31-agent
execution, approvals, deliverables) and the **scheduled runner** (Claude scheduled tasks / GitHub
Action writing `public/agent-data/*.json`). Before this change, most pages read only the scheduled
runner's JSON, so they could not see live goals, approvals, failures, provider state or deliverables.

## Section-by-section

| # | Section | Before | After | What changed |
|---|---|---|---|---|
| 1 | 3D Command Center | Partially working | Working | Agent colours, arcs and HUD come from live backend state (working / waiting for you / failed in last 48 h); backend health chip and real AI state; core, brand and agent panels show live counts. Falls back to scheduled-runner data when locked. |
| 2 | Overview | Partially working | Working | Live KPIs (goals in progress, waiting for you, agents working, failed steps 7 d), live brand counts, **Needs you** list, **Agent health** (incl. provider state), live activity. Long lists capped. |
| 3 | Pipelines | Partially working | Working | Every step shows attempt x/max, provider + model, duration, finish time, review result, your decision, errors and requested fixes; output **versions** (incl. rejected attempts); **execution log**; filters (All / In progress / Done / Failed). Each finished step states it produced a *written* deliverable — a “Done” goal never implies a song, video or site was generated or published. |
| 4 | Analytics | Partially working | Working | New **Studio operations** tab from D1 records: goals by status/brand, success rate, review pass rates, step time, approvals, AI calls / error rate / tokens / latency. `—` = no data source or not enough data; `0` = counted, none. Cost shows “Not tracked” unless a price is configured. Sunverse YouTube report unchanged. |
| 5 | LittleLoop | Partially working | Working* | Live goals for the brand, **Deliverables** library (latest version per step, reviews tab), honest integrations, production handoff steps, live activity. |
| 6 | Sunverse | Partially working | Working* | Same, plus the @SURVERSE_09 channel card (real public stats). |
| 7 | Foliocraft | Partially working | Working* | Same; code work is described as the weekly CODE-SHAKTI pull-request run, not as “connected”. |
| 8 | Agents | Partially working | Working | All 31 agents with live per-agent work (done / failed / queued / waiting, last active, review pass/fail), status that never marks an agent active without real work, “No AI engine” when none of its engines has a key, and an **AI engine selector** per agent (existing `PUT /api/agents/:id/engines`). |
| 9 | AI Connection | Broken / misleading | Working | Rebuilt on the Worker: key set (booleans), last real request result, actionable error (bad key / wrong model / quota / outage), 30-day calls / errors / tokens / cost, **Test connection** (live request), backend health, lock / unlock, Cloudflare secret instructions. GitHub links removed. Scheduled-runner status kept as a clearly labelled secondary card. |

\* “Working” for the panel. External production (audio/video generation, uploads, posting, deploys) is
manual by design or not yet integrated — see below.

## Integrations (verified individually)

| Integration | State | Evidence |
|---|---|---|
| YouTube public stats (Sunverse) | Connected | `GET /api/analytics/sunverse` returned real channel data for @SURVERSE_09 on 2026-10-13. |
| YouTube upload | Not configured | No Google OAuth client; uploads are done by the owner after approval (“Mark done”). |
| Instagram | On hold | By owner decision. |
| Google Flow | Manual handoff | No public Flow API found; agents write prompts, owner generates in Flow. |
| Spotify | Not configured | Not started. |
| GitHub (code) | Weekly run | CODE-SHAKTI scheduled task can open PRs; no CODE-SHAKTI PR has been verified yet. |
| Claude / Gemini on the Worker | Shown live in AI Connection | State comes from the Worker’s own request log and live test, never assumed. |

## New backend endpoints (read-only, owner token required)
- `GET /api/summary` — counts from D1: goals by status/brand, steps by status, approvals, failed steps 7 d,
  step duration median/p90, per-agent stats (incl. gate pass/fail, recent failures), provider status,
  30-day usage, recent events, integration facts. No key material (tested).
- `GET /api/artifacts?brand=` — deliverable metadata per brand (content stays behind `/api/artifacts/:id`).
- `/api/health` now also returns `primaryEngine` (non-secret) and allows the GitHub Pages mirror origin.

## Verification
- `npm test`: **48/48 pass** (13 registry/contract tests + 35 Worker tests on a real local D1 with a
  mocked provider). New test: summary counts, empty-DB nulls, auth, no key leakage, brand artifacts.
- `npm run build`: passes (data validation, schema check, `tsc -b`, Vite).
- `wrangler deploy --dry-run`: passes; bindings `DB (ganesha)`.
- UI: the built site was served by `wrangler dev` with a local D1 seeded by the real orchestrator
  (mocked AI, local only). All 9 sections captured on desktop (1440) and mobile (390), unlocked and
  locked: **0 page errors, 0 horizontal overflow**.
- Not verified here: production after deploy (this sandbox cannot reach workers.dev directly).

## Remaining owner setup
- `GEMINI_API_KEY` Worker secret, if not already set (AI Connection shows the real state).
- Optional `ANTHROPIC_API_KEY` (billed per token).
- YouTube upload: Google OAuth client (see `INTEGRATION_SETUP.md` §6).
