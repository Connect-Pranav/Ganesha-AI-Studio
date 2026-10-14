# Subscription Intelligence + Cosmic Redesign — Audit & Status

Date: 2026-10-14. Branch: `feat/cbo-command-center` (base `main` @ `6fe274f`). No secrets recorded.

## 1. Prior branch, re-verified against the repository
| Claim in the earlier report | Actual |
|---|---|
| 31 agents preserved | ✅ `agents/registry.json` is unchanged versus `main` (0-line diff). A test asserts the exact 31 IDs in order. |
| "Nine new backend files" | ❌ **7**: `worker/{cbo,commands,connections,finance,production,voices}.mjs` + `worker/test/cbo.test.mjs`. The 4 migration files were counted separately. |
| "Nine new interface files" | ❌ **10**: 9 in `src/components/cbo/` + `src/services/cboService.ts`. |
| Two additive migrations + rollbacks | ✅ `0003`, `0004` + `rollback/0003`, `rollback/0004`. They are kept unchanged. |
| Orchestrator / providers / routes / nav / styles changed; Gemini thinking tokens | ✅ |

## 2. What each subscription actually exposes (checked 2026-10-14)
| Service | Consumer plan, billing, renewal | Consumer usage windows | Developer API usage / cost | Source |
|---|---|---|---|---|
| Claude (Pro/Max) | No official API → **import receipt** | No API. Shown in claude.ai Settings → Usage and in Claude Code `/usage`. → **import** | **Usage & Cost Admin API**: organization accounts only, Admin key. Not available to individual accounts. | https://platform.claude.com/docs/en/manage-claude/usage-cost-api ; public feature requests for a subscription-usage API (e.g. https://claudeissues.com/issue/44328-feature-request-claude-usage-command-api-endpoint-for-max-subscription-limits) |
| ChatGPT | No API → **import receipt** | No API (caps shown in the app) → **import** | **OpenAI Usage + Costs API**: organization Admin key | https://developers.openai.com/cookbook/examples/completions_usage_api |
| Google AI Pro | No API for Google One / AI Pro → **import receipt** | Gemini app limits and Flow credits are shown only in those apps → **import** | Gemini API key exposes **no** usage, billing or quota. The authorized path (Cloud Billing export to BigQuery via OAuth) is **not built**. | https://ai.google.dev/gemini-api/docs/pricing ; forum reports that a Pro subscription does not grant API quota |
| Canva | Connect `GET /v1/users/me/capabilities` returns plan-gated features only (no plan name, price or renewal). OAuth is **not built**. | Not exposed | n/a | https://www.canva.dev/docs/connect/api-reference/users/get-user-capabilities/ |

GANESHA’s own calls (`provider_calls`) are a separate, partial ledger. They are never shown as account-wide usage. When an Admin API is connected, “usage outside GANESHA” is calculated as account usage minus GANESHA usage.

## 3. Implementation status
| Feature | Status |
|---|---|
| Availability model (LIVE, RECENT, IMPORTED, CALCULATED, ESTIMATED, UNAVAILABLE, NEEDS_AUTHORIZATION, ERROR) per field, with source and time | Implemented and tested |
| Seven separate records per provider (consumer subscription, API account, API billing, subscription usage, API quota, GANESHA usage, external usage) | Implemented and tested |
| Profile import (plan, status, dates, amount, period, masked payment method, usage unit/window/limit), source required, card numbers refused | Implemented and tested |
| CSV/JSON import of receipts, invoices and usage exports; duplicates skipped; LIVE rows win over imported ones; imported API invoices superseded by live cost rows (no double count) | Implemented and tested |
| Anthropic Usage & Cost Admin adapter (`ANTHROPIC_ADMIN_KEY`) | Implemented and tested (mocked). **Awaiting credentials, not verified live.** Needs an organization account. |
| OpenAI Usage + Costs adapter (`OPENAI_ADMIN_KEY`), with pagination | Implemented and tested (mocked). **Awaiting credentials, not verified live.** |
| Google AI Pro, ChatGPT, Claude and Canva consumer data | **Not supported by any official integration** → import only |
| Gemini API billing (Cloud Billing export) | Not built (needs Google OAuth + BigQuery) |
| Canva capabilities (OAuth) | Not built |
| Renewal math: age (verified start vs first observed), days to renewal, period remaining, effective monthly cost, forecast (≥ 3 observed days), unused-allowance value, overage warning | Implemented and tested |
| Alerts: renewal ≤ 7 days, ≥ 80 % of allowance used, forecast over allowance, sync errors, unusual API-spend days (> 3× the 7-day average and ≥ $1) | Implemented and tested |
| CBO subscription-aware engine choice (allowed engines only; consumer subscriptions never callable; cheapest healthy; urgent tasks avoid rate-limited engines; owner override wins; every decision recorded in `dispatch_decisions`; the call really uses the chosen engine) | Implemented and tested |
| Subscription Intelligence dashboard (4 provider cards, 9 tabs) | Implemented. Browser-smoke checked against a local Worker. |
| Cosmic theme: tokens, starfield, Milky Way, nebulae, meteors, distant lightning, planets, Full / Balanced / Minimal setting, reduced-motion support, Cosmic Command Center orbit | Implemented. Contrast and motion-safety tested; browser-smoke checked. |
| Deployment | **Not deployed.** Merging to `main` deploys; that needs your approval. |

## 4. Database
`migrations/0005_subscription_intel.sql` is additive: `sub_facts`, `billing_records`, `usage_ledger`, `sync_runs`, `dispatch_decisions`. Rollback: `migrations/rollback/0005_subscription_intel.down.sql`. Migrations `0003` and `0004` are untouched.

## 5. Manual steps for the owner
1. For each of the four services, open Subscription Intelligence → Import plan details and enter the values from your latest receipt, including its source.
2. Optional: import past receipts as a CSV (Data Sources tab).
3. Optional: create an Anthropic **organization** Admin key and/or an OpenAI Admin key, then run:
   - `npx wrangler secret put ANTHROPIC_ADMIN_KEY`
   - `npx wrangler secret put OPENAI_ADMIN_KEY`

   Then press Sync. Until then API spend stays “Needs authorization”.
4. In CFO → Settings, set the USD→INR rate and your Gemini billing tier.
