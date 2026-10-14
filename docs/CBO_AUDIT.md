# CBO / CFO / Production Audit — Ganesha AI Studio

Audit date: 2026-10-14. Base commit: `6fe274f` (`main`). Work branch: `feat/cbo-command-center`.
No secrets are recorded here.

## 1. What exists (verified in the repo, not assumed)

| Layer | Reality |
|---|---|
| Frontend | React 18 + TS + Vite SPA, hash routing, 9 sections: 3D Command Center, Overview, Pipelines, Analytics, LittleLoop, Sunverse, Foliocraft, Agents, AI Connection. |
| Backend | Cloudflare Worker `ganesha-studio` (`worker/index.mjs`), D1 `ganesha`, cron every 5 min. Admin bearer token auth. |
| Orchestrator | `worker/orchestrator.mjs`: workflows → tasks from `agents/pipelines.json`, leases, idempotency keys, bounded retries with backoff, gates (DHARMA, CHITRAGUPTA) with upstream correction, approvals, pause/resume/cancel. |
| Providers | `worker/providers.mjs`: Anthropic Messages + Gemini `generateContent`, live test, `provider_calls` log (tokens, latency, cost only if an env price is set). |
| Deploy | `main` is built and deployed by Cloudflare Workers Builds. **Pushing to `main` = deploying.** |
| Tests / build (baseline) | `npm test` **48/48 pass**; `npm run build` passes (run 2026-10-14 on `6fe274f`). |

## 2. The 31 agents (all preserved; IDs unchanged)

| ID | Name | Team | Role | Engines | Approval | Used in templates |
|---|---|---|---|---|---|---|
| `ganesha_orchestrator` | GANESHA | master | Chief Orchestrator | claude/gemini | yes | — |
| `narada_market_intelligence` | NARADA | master | Research & Intelligence | claude/gemini | yes | research_brief:research |
| `chitragupta_quality_audit` | CHITRAGUPTA | master | Quality & Audit Controller | claude | yes | sunverse_song_release:qa, littleloop_episode:qa, foliocraft_feature:qa, research_brief:qa |
| `samvada_handoffs` | SAMVADA | master | Communication & Handoffs | claude | yes | sunverse_song_release:handoff, littleloop_episode:handoff, foliocraft_feature:handoff, research_brief:handoff, ops_weekly_review:handoff |
| `sunverse_tumburu_music_director` | TUMBURU | sunverse | Music Director & Composer | claude | yes | sunverse_song_release:composition |
| `sunverse_vagdevi_lyricist` | VAGDEVI | sunverse | Lyricist | claude | yes | sunverse_song_release:lyrics |
| `sunverse_saraswati_vocal_director` | SARASWATI | sunverse | Vocal & Performance Director | claude | yes | sunverse_song_release:vocals |
| `sunverse_vishvavasu_sound_engineer` | VISHVAVASU | sunverse | Sound Engineer | claude | yes | sunverse_song_release:mix |
| `sunverse_gandharva_trend_analyst` | GANDHARVA | sunverse | Music Trend Analyst | claude | yes | sunverse_song_release:trends |
| `sunverse_vishvakarma_video_producer` | VISHVAKARMA | sunverse | Music Video Producer | claude | yes | sunverse_song_release:video |
| `sunverse_surya_release_manager` | SURYA | sunverse | Release & Publishing Manager | claude | yes | sunverse_song_release:release |
| `sunverse_nata_visual_designer` | NATA | sunverse | Artwork & Visual Identity Designer | claude | yes | sunverse_song_release:artwork |
| `littleloop_krishna_story_director` | KRISHNA | littleloop | Story & Character Director | claude | yes | littleloop_episode:concept |
| `littleloop_vyasa_scriptwriter` | VYASA | littleloop | Scriptwriter & Dialogue Specialist | claude | yes | littleloop_episode:script |
| `littleloop_drishti_visual_planner` | DRISHTI | littleloop | Research & Visual Planner | claude | yes | littleloop_episode:visual_plan |
| `littleloop_maya_prompt_engineer` | MAYA | littleloop | Animation Prompt Engineer | claude | yes | littleloop_episode:prompts |
| `littleloop_chitra_character_designer` | CHITRA | littleloop | Character & Art Designer | claude | yes | littleloop_episode:characters |
| `littleloop_nataraja_edit_director` | NATARAJA | littleloop | Animation & Editing Director | claude | yes | littleloop_episode:edit |
| `littleloop_nada_sound_director` | NADA | littleloop | Voice & Sound Director | claude | yes | littleloop_episode:sound |
| `littleloop_lakshmi_growth_analyst` | LAKSHMI | littleloop | Channel Growth Analyst | claude | yes | littleloop_episode:posting |
| `foliocraft_brahma_product_architect` | BRAHMA | foliocraft | Product Architect | claude | yes | foliocraft_feature:spec |
| `foliocraft_nirnaya_strategy_analyst` | NIRNAYA | foliocraft | Product Strategy Analyst | claude | yes | foliocraft_feature:decision |
| `foliocraft_sutradhara_ux_architect` | SUTRADHARA | foliocraft | UX/UI & Design-System Architect | claude | yes | foliocraft_feature:ux |
| `code_shakti` | KARMA | foliocraft | Software Engineer (CODE-SHAKTI skill) | claude | yes | foliocraft_feature:build |
| `foliocraft_kubera_monetisation` | KUBERA | foliocraft | Monetisation Analyst | claude | yes | foliocraft_feature:pricing |
| `ops_agni_automation` | AGNI | ops | Automation Engineer | claude | yes | ops_weekly_review:automation |
| `ops_soma_analytics` | SOMA | ops | Data & Analytics Analyst | gemini/claude | yes | ops_weekly_review:metrics |
| `ops_hanuman_recovery` | HANUMAN | ops | Troubleshooting & Recovery Specialist | claude | yes | ops_weekly_review:incidents |
| `ops_dharma_safety` | DHARMA | ops | Safety & Policy Reviewer | claude | yes | sunverse_song_release:safety, littleloop_episode:safety |
| `ops_maya_docs` | MAYA-OPS | ops | Documentation Manager | claude | yes | ops_weekly_review:docs |
| `ops_lakshmi_growth` | LAKSHMI-OPS | ops | Growth & Distribution Analyst | claude | yes | ops_weekly_review:growth |

## 3. Capability mapping — no new agents created

| Requested capability | Where it lives | Why no new agent |
|---|---|---|
| GANESHA CBO (`GANESHA_CBO`) | `worker/cbo.mjs`, an executive layer over `ganesha_orchestrator` | Planning, cost, budgets and reporting are deterministic code. An LLM agent should not do arithmetic on money. |
| CFO (estimates, budgets, ledger) | `worker/cbo.mjs` + `worker/finance.mjs` | Same reason. |
| Smart Voice Director | `worker/voices.mjs`. It recommends; NADA (LittleLoop) and SARASWATI (Sunverse) own the creative voice direction in pipelines. | Their contracts already cover voice direction. |
| Character continuity | CHITRA (character bible) + D1 `characters` table | Existing contract |
| Video prompts / scenes | MAYA (Flow prompts), VISHVAKARMA (music video), NATARAJA (edit) + D1 `scenes` | Existing contracts |
| Canva artwork / thumbnails | NATA (artwork brief); Canva connection is the execution channel | Existing contract |
| Publishing | SURYA / LAKSHMI approval steps (unchanged; never auto-publish) | Existing |

## 4. Lifecycle mapping (requested states ← stored task status)

The D1 `tasks.status` CHECK constraint is kept to stay backward compatible. The requested lifecycle is derived from it:

| Requested | Derived from |
|---|---|
| DRAFT | A plan returned by `POST /api/cbo/plan` that has not been started yet (no rows written) |
| READY | `queued`, all dependencies completed, no hold |
| ASSIGNED | `queued`, waiting on upstream steps that are still progressing |
| RUNNING | `running` |
| WAITING_FOR_APPROVAL | `waiting_for_approval` (content approval or budget approval) |
| BLOCKED | `waiting_for_external_action`; a dependency that failed or was cancelled; the workflow is paused; global dispatch pause |
| FAILED / COMPLETED / CANCELLED | Same names |

## 5. Gaps found → what this branch adds

| Gap | Added |
|---|---|
| No cost preflight; cost only if an env price is set | Pricing registry with source URL + verification date, per-task estimates (direct + conservative + confidence + assumptions), INR display with a stored FX rate you set |
| No budgets, reservations or global pause | Budgets (monthly / provider / project / task), atomic reservation ledger, approval thresholds, global dispatch pause, reconciliation of estimate vs actual |
| Gemini thinking tokens not counted | Adapter now adds `thoughtsTokenCount` to output tokens (billed as output per Google's pricing page) |
| No deadlines / priority / reassignment | `task_meta` (priority, deadline), reassignment with contract checks, overdue detection |
| No executive report / command interface | `GET /api/cbo/report`, `POST /api/cbo/command` (answers from records, no LLM call) |
| No voice library, characters, scenes, media/provider-job tracking | 10 voice profiles, Smart Voice Director, characters, scenes with version history, media assets, provider jobs (Flow = manual handoff) |
| No provider/subscription manager beyond Claude/Gemini | Connections registry (Claude, Gemini, Gemini TTS, OpenAI, Canva, Google Flow, YouTube) + subscriptions you enter |

## 6. Verified external facts (retrieved 2026-10-14)

- Anthropic pricing: Claude Sonnet 5.5 is $2 / MTok input, $10 / MTok output, $0.10 / MTok cache hits, $2.50 / MTok 5-minute cache writes. Source: https://platform.claude.com/docs/en/about-claude/pricing
- Gemini pricing (Standard tier):
  - `gemini-3.8-flash` and `gemini-3.6-flash` have a free tier. Paid tier: $0.75 input / $3.75 output (incl. thinking) per MTok until 2026-12-31, then $1.50 / $7.50 from 2027-01-01.
  - `gemini-3.5-flash-lite`: $0.30 / $2.50.
  - `gemini-3.8-flash-tts`: free tier, $0.50 text input / $9.00 audio output per MTok until 2026-12-31. Audio is 25 tokens per second.
  - Source: https://ai.google.dev/gemini-api/docs/pricing
- Canva Connect: OAuth 2.0 (the reference app uses PKCE). Brand templates + autofill work on Canva Pro, Teams or Enterprise; private apps need Enterprise. Source: https://www.canva.dev/docs/connect/reference-apps/nourish/
- Google Flow: no public Flow API was found (search 2026-10-14; the support page could not be fetched from this sandbox). Flow stays a **manual handoff**.
- OpenAI: a ChatGPT subscription does not include API access. API needs its own key and billing. Prices were not verified in this run, so none are seeded.

## 7. Implementation status (branch `feat/cbo-command-center`)

| Feature | Status |
|---|---|
| GANESHA_CBO report, plan (DRAFT), command bar (12+ intents, no AI call, actions need confirmation) | Implemented and tested |
| Cost preflight before every dispatch; atomic reservation ledger; reconciliation of estimate vs actual; INR with stored FX | Implemented and tested (mocked providers) |
| Budgets (monthly / provider / project / per-task), approval threshold, unknown-cost policy, global dispatch pause, max concurrent paid tasks | Implemented and tested |
| Task manager: lifecycle states, priority, deadlines, overdue, reassignment with contract checks, retry, estimate detail | Implemented and tested |
| CFO dashboard: spend, reserved, queued estimate, subscriptions, forecast, estimate vs actual, cost per deliverable, pricing registry, quota = unknown | Implemented and tested |
| Provider & subscription manager (Claude, Gemini, Gemini TTS, OpenAI, Canva, Flow, YouTube) | Implemented. Claude/Gemini/OpenAI live tests are awaiting credentials. |
| OpenAI | Credential check only (lists models, no tokens used). No agent adapter yet. |
| Canva Connect | Not implemented beyond detecting the config. Blocked on a Canva integration (client ID/secret) and the OAuth flow. |
| Google Flow | No public API found → manual handoff with prompts, steps, output registration and owner-reported status. |
| Voice library (exactly 10: 4 male, 4 female, 2 kids), Smart Voice Director, locked assignments | Implemented and tested |
| Speech synthesis (Gemini TTS) | Implemented, but awaiting credentials and a provider voice name per profile. **Not verified live.** |
| Singing | Not supported by any configured integration |
| Child/toddler voices | No verified provider. Profiles K1/K2 stay descriptive only. |
| Characters, productions, scenes (versioned regeneration), continuity checks, media assets, provider jobs, four-pillar learning modules, prompt builder | Implemented and tested |
| Deployment | **Not deployed.** Merging to `main` deploys via Cloudflare Workers Builds, which needs your approval. |

### Migrations
`0003_cbo_finance.sql` and `0004_production.sql` are additive (`CREATE ... IF NOT EXISTS`). The Worker creates them on first request (`ensureSchema`). Rollbacks are in `migrations/rollback/`.

### First workflow to run after deploy
1. Open CFO & Costs:
   - Set a USD→INR rate and the source you read it from.
   - Set your Gemini billing tier.
   - Set a monthly budget.
   - Add your four subscriptions with the real amounts.
2. Open Task Manager → Plan & estimate → LittleLoop episode × 1 → Estimate. Read the assumptions, then Start.
3. Watch the CBO Executive page: the first step is estimated, reserved, run and reconciled. Then compare estimate vs actual in CFO.
