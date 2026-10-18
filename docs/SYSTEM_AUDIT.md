# System Audit — Ganesha AI Studio

Audit date: 2026-10-13. Audited commit: `217d8a3` on `main`. No secrets are recorded here.

## 1. What actually exists

| Layer | Reality |
|---|---|
| Frontend | React 18 + TypeScript + Vite SPA. Classic dashboard + lazy-loaded three.js 3D command center. Reads `public/agent-data/*.json` (static files). Some panels are demo data and are labelled **Demo**. |
| Hosting | `wrangler.jsonc` deploys Worker `ganesha-studio` with **static assets only** (`./dist`, SPA fallback). There is **no Worker script** (`main` is absent), so there is no backend, no API routes and no server-side secrets. |
| Cloudflare bindings | **None.** No D1, KV, R2, Queues, Durable Objects or cron triggers are declared. |
| GitHub Pages | `.github/workflows/deploy.yml` builds and deploys the same SPA to GitHub Pages on every push to `main`. It does not deploy to Cloudflare. |
| Agent execution | Outside the app. (a) `.github/workflows/agents.yml` runs `scripts/agent-runner.mjs` (Gemini, NARADA + GANESHA only) daily at 05:53 IST. (b) Claude scheduled tasks clone the repo, act as agents per `agents/RUNTIME.md`, write deliverables to the private vault repo and status JSON to this repo. |
| Persistence | Git-committed JSON files: `runs.json` (8 runs), `research.json` (14 findings), `tasks.json` (20), `activity.json` (21), `pipelines.json` (3 pipelines). Deliverables live in private repo `Connect-Pranav/Ganesha-AI-Vault`. |
| Agent registry | `agents/registry.json` v2: 31 agents, 5 teams, unique IDs and names. 5 pipeline templates in `agents/pipelines.json` with gates (DHARMA safety, CHITRAGUPTA QA) and approval steps. |
| Tests | `npm test`: 13 node:test tests (registry, contracts, routing, templates, permissions, validation, status rules). **13/13 pass.** |
| Build | `npm run build` (validate data → `tsc -b` → `vite build`): **passes.** |

## 2. Deployment target
- The production URL `ganesha-studio.pravanigroup.workers.dev` serves a page titled "Ganesha AI Studio" (checked via web fetch).
- The repo's Worker name (`ganesha-studio`) matches the URL. Deployment is most likely Cloudflare Workers Builds connected to this repo (nothing in the repo deploys to Cloudflare). **Unverified:** this sandbox's network policy blocks direct requests to workers.dev, so the deployed asset hash could not be compared with a local build.
- Consequence: any change to `wrangler.jsonc` on `main` will be picked up by the Cloudflare build. Backend work therefore stays on branch `feat/worker-orchestrator` until the D1 database exists and deployment is authorized.

## 3. Provider status (from real run records)
- **Claude engine:** 8 successful runs, latest 2026-10-13T02:27Z. These are Claude scheduled-task sessions, not Anthropic API calls. No `ANTHROPIC_API_KEY` is used anywhere.
- **Gemini engine:** **0 runs ever recorded.** The workflow exits cleanly without `GEMINI_API_KEY`, so the secret is almost certainly not set. Default model `gemini-2.5-flash` is an older generation; the current free-tier Flash model listed on the Gemini pricing page is `gemini-3.8-flash`.

## 4. Gaps against the requested system

| Requirement | Gap |
|---|---|
| Persistent orchestration with leases, idempotency, resume, cancel, pause | Pipeline status is a JSON file edited by a CLI inside a scheduled session. No leases, no idempotency keys, no cancel/pause, no task inputs/outputs/cost records. |
| Real provider adapters + connection tests | Gemini adapter exists only in a GitHub Action (NARADA/GANESHA). No Claude API adapter. "Connected" is inferred from run logs, which is honest but not a live test. |
| Server-side secrets / OAuth | Impossible today: no Worker script. |
| YouTube / Instagram / Spotify / Flow | Not implemented. |
| Human approvals | Implemented as vault Issue comments (`approve` / `reject`) processed by the Claude goal runner. Works, but not in the dashboard. |
| Scheduling | GitHub Actions cron + Claude scheduled tasks. No Cloudflare cron. |

## 5. Simulated or hard-coded states found
- `src/data/demoData.ts` powers brand pipelines/funnels and some metrics. All are labelled **Demo** in the UI (`DemoBadge`, mode banner). No unlabelled fake success states were found.
- `App.tsx` quick actions create tasks locally only and say "(demo, not saved)".
- Test-state URLs (`?state=error|empty|slow`) are explicit simulations.

## 6. Duplicates and naming
- No duplicate agents. Two agents share a theme name with an ops variant on purpose (MAYA / MAYA-OPS, LAKSHMI / LAKSHMI-OPS) with distinct IDs and roles.
- Requested roles map onto existing agents (see `IMPLEMENTATION_PLAN.md`), so no new agents are required for the music and short-form workflows.

## 7. Platform facts that constrain the plan
- **Spotify (Feb 2026 Dev Mode changes):** Development-mode apps need the owner on Premium, max 5 users; `popularity` fields, `artists/{id}/top-tracks`, browse new-releases/categories and batch endpoints were removed. Chart/popularity research must use other permitted public chart sources.
- **Google Flow:** no public API for Flow was found. Veo video generation is exposed through the Gemini API, which is a separate, paid capability; it is not Flow and is not assumed available. Plan: Flow handoff (prompts + manual asset registration).
- **Anthropic API:** billed per token and separate from any Claude subscription.
