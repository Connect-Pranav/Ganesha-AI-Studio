# Integration Setup

Everything here is done once, by the owner, in your own accounts. No secret ever goes into Git.
Commands run from the repo root after `npm install` (Node 22+).

## Status (2026-10-13)

| Integration | Code | Account setup | State |
|---|---|---|---|
| Worker backend + D1 | ✅ branch `feat/worker-orchestrator` | ✅ D1 `ganesha` created; schema via Console | Pending deploy |
| Admin auth | ✅ | ❌ `ADMIN_TOKEN` not set | Pending |
| Claude (Anthropic API) | ✅ adapter + live test | ❌ `ANTHROPIC_API_KEY` | Pending |
| Gemini API (Worker) | ✅ adapter + live test | ❌ `GEMINI_API_KEY` (Worker secret) | Pending |
| Gemini (GitHub Action) | ✅ existing | ❌ repo secret `GEMINI_API_KEY` (0 runs recorded) | Pending |
| YouTube (@SURVERSE_09) | Phase 5 | Google Cloud OAuth client | Not started |
| Instagram | — | — | On hold by owner |
| Spotify | Phase 7 | Spotify app; owner needs Premium (Dev Mode rule since Feb 2026) | Not started |
| Google Flow | Phase 8: manual handoff | None (no public Flow API found) | Not started |

## 1. Create the D1 database
```bash
npx wrangler login                       # opens Cloudflare in your browser
npx wrangler d1 create ganesha           # prints a database_id
```
Put that `database_id` into `wrangler.jsonc` (replacing `REPLACE_WITH_D1_DATABASE_ID`). It is an identifier, not a secret.

Apply the schema, local first, then remote:
```bash
npx wrangler d1 migrations apply ganesha --local
npx wrangler d1 migrations apply ganesha --remote
```
Rollback (destroys orchestrator data; export first):
```bash
npx wrangler d1 export ganesha --remote --output backup.sql
npx wrangler d1 execute ganesha --remote --file migrations/rollback/0001_orchestrator.down.sql
```

## 2. Secrets (Worker)
```bash
npx wrangler secret put ADMIN_TOKEN        # any long random string; the dashboard sends it as a Bearer token
npx wrangler secret put ANTHROPIC_API_KEY  # console.anthropic.com → API keys (billed per token, separate from a Claude subscription)
npx wrangler secret put GEMINI_API_KEY     # aistudio.google.com → Get API key (free tier available)
```
Generate an admin token: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`

Optional vars in `wrangler.jsonc`: `ANTHROPIC_MODEL`, `GEMINI_MODEL`, `MAX_CONCURRENT_TASKS` (1-6), `ALLOW_PROVIDER_FALLBACK` (`true` lets an agent use the other provider when its own is down). Optional cost tracking: `ANTHROPIC_PRICE_PER_MTOK` / `GEMINI_PRICE_PER_MTOK` as `"input,output"` USD per million tokens from the provider's pricing page. Without them only token counts are recorded; cost is never guessed.

For local dev, put the same names in `.dev.vars` (git-ignored).

## 3. Verify (after deploy)
```bash
BASE=https://ganesha-studio.connect-pranav09.workers.dev
curl $BASE/api/health
curl -X POST -H "authorization: Bearer $ADMIN_TOKEN" $BASE/api/providers/claude/test
curl -X POST -H "authorization: Bearer $ADMIN_TOKEN" $BASE/api/providers/gemini/test
```
`state: "connected"` appears only after a real reply from the provider. A key that exists but fails shows `error` with the provider's message (keys redacted).

## 4. API summary
All routes except `/api/health` need `Authorization: Bearer <ADMIN_TOKEN>`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Public liveness: version, DB bound, token set |
| GET | `/api/providers` · POST `/api/providers/{claude\|gemini}/test` | Connection state · live test |
| GET | `/api/usage` | Calls, errors, tokens (and cost if priced), last 30 days |
| GET | `/api/agents` · PUT `/api/agents/{id}/engines` | 31-agent registry with engines · override engines |
| GET | `/api/templates` | Pipeline templates |
| POST | `/api/workflows` (`Idempotency-Key` header) | Start a workflow `{template,title,goal,input}` |
| GET | `/api/workflows[?status=]` · `/api/workflows/{id}` | List · detail with tasks, approvals, events |
| POST | `/api/workflows/{id}/pause\|resume\|cancel` | Owner control |
| GET | `/api/tasks/{id}` · `/api/artifacts/{id}` | Task detail · versioned deliverable |
| POST | `/api/tasks/{id}/retry` · `/complete-external` | Retry a failed task · confirm a manual action happened |
| GET/POST | `/api/approvals[?status=]` · `/api/approvals/{id}` `{decision,note}` | Pending approvals · approve/reject |
| POST | `/api/orchestrator/tick` | Run one orchestration pass now (cron does this every 5 min) |
| GET | `/api/summary` | Dashboard aggregates counted from D1 (no keys) |
| GET | `/api/artifacts?brand=` | Deliverable list per brand (metadata only) |

## 5. Deploying
`main` is deployed to Cloudflare by the Workers build connected to this repo. Do not merge the backend branch until steps 1-2 are done; with the placeholder `database_id` the Cloudflare deploy would fail (the existing site would keep serving the previous version).

## 6. Later phases (what you will need)
- **YouTube (Phase 5):** Google Cloud project → enable YouTube Data API v3 + YouTube Analytics API → OAuth consent screen → OAuth client (Web). Redirect URI will be `https://ganesha-studio.connect-pranav09.workers.dev/api/oauth/google/callback`. Secrets: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`; var `GOOGLE_OAUTH_REDIRECT_URI`; plus `TOKEN_ENCRYPTION_KEY` for encrypting refresh tokens at rest.
- **Spotify (Phase 7):** app at developer.spotify.com in Development Mode; owner account needs Premium. Popularity fields, artist top-tracks and browse endpoints are no longer available, so trend data will come from permitted public charts.
- **Google Flow (Phase 8):** none; prompts are generated for copy-paste and finished clips are registered back in the dashboard.
