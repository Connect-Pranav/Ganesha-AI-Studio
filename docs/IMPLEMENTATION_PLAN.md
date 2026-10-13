# Implementation Plan

Principle: keep the existing static dashboard, 31-agent registry, pipelines CLI, vault flow and GitHub Actions working; add a Worker backend beside them. Everything new lives on branch `feat/worker-orchestrator` until the D1 database exists and deployment is approved.

## Architecture (target)

```
Browser (existing SPA) ──/api/*──▶ Worker `ganesha-studio` (worker/index.mjs)
                                     ├─ D1 `ganesha` : workflows, tasks, artifacts, approvals,
                                     │                 provider_calls, connections, schedules
                                     ├─ cron (every 5 min) ─▶ GANESHA tick: lease → run agent → verify
                                     └─ providers: Anthropic Messages API, Gemini generateContent
Static assets (dist/) still served by the same Worker.
```

Why D1 + cron and not Queues/Workflows: D1, Cron Triggers and static assets are on the Workers Free plan; Queues need Workers Paid. The orchestrator is written so a queue can replace the cron tick later without schema changes.

Long pipelines never run inside one HTTP request. A request creates the workflow and returns; each cron tick (and an immediate `waitUntil` kick) claims a few ready tasks with a time-limited lease.

## Role mapping for requested workflows (no new agents)

| Requested role | Existing agent |
|---|---|
| Music Researcher, Music Structure Analyst | GANDHARVA (`sunverse_gandharva_trend_analyst`), NARADA for cross-source research |
| Songwriter / Lyricist | VAGDEVI |
| Composer / Music Director | TUMBURU |
| Vocal direction | SARASWATI |
| Production Planner (audio) | VISHVAVASU · (video) VISHVAKARMA · artwork NATA |
| Quality Reviewer | DHARMA (safety/originality gate) + CHITRAGUPTA (acceptance gate) |
| YouTube publishing | SURYA (approval step) |
| Short-form researcher / trend analyst | DRISHTI + NARADA |
| Scriptwriter | VYASA · story KRISHNA |
| Character & voice continuity | CHITRA (character bible) + NADA (voice) |
| Video production planner | MAYA (Flow prompts) + NATARAJA (edit plan) |
| Posting | LAKSHMI (approval step) |
| Analytics feedback | SOMA |

## Phases and order

| # | Deliverable | Depends on you |
|---|---|---|
| 1 | Worker API, D1 schema `0001`, GANESHA orchestrator (statuses queued/running/waiting_for_approval/waiting_for_external_action/completed/failed/cancelled, leases, idempotency keys, bounded retries with backoff, gate → upstream correction, approvals, cancel/pause/resume), admin token auth, cron | Create D1, set `ADMIN_TOKEN` |
| 2 | Anthropic + Gemini adapters, timeouts, retries, 429 handling, token usage logging, `/api/providers/test` live check, Connections panel | API keys |
| 3 | `MUSIC_TREND_TO_SONG` template + research brief contract + artifact versioning | — |
| 4 | `SHORT_FORM_TREND_TO_VIDEO` template + character bible store | — |
| 5 | Google OAuth (validated state, server-side auth-code exchange, encrypted refresh token in D1), channel identity check vs `@SURVERSE_09`, analytics sync, private resumable upload behind approval | Google Cloud OAuth client |
| 6 | Instagram | On hold (owner decision 2026-10-13) |
| 7 | Spotify metadata via client-credentials, limited to endpoints still available | Spotify app (owner Premium required) |
| 8 | Flow handoff UI: copy prompts, register clips, resume QA | — |
| 9–12 | Schedules UI, dashboard panels, test suite expansion, staged deploy | Deploy approval |

## Rollout
1. Branch builds and tests green locally (mocked providers, local D1).
2. Owner creates D1 and secrets; migrations applied to remote D1.
3. Merge to `main` only after approval; Cloudflare build deploys; smoke-test `/api/health` and the dashboard.
4. Rollback: revert the merge commit; static site returns to assets-only. D1 tables are additive and can stay.
