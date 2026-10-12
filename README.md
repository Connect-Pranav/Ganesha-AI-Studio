# Ganesha AI Studio

Control-room dashboard for three brands — **LittleLoop** (kids' animated shorts), **Sunverse** (music & YouTube) and **Foliocraft** (portfolio builder) — run by three agents: **GANESHA** (orchestrator), **NARADA** (research) and **CODE-SHAKTI** (coding).

**Status:** dashboard + working agent layer. Sections marked **Live** show real agent output; sections marked **Demo** are illustrative.

## Agents
| Agent | ID | Does | Engines |
|---|---|---|---|
| NARADA | `narada_market_intelligence` | Daily trend research per brand, every finding cites real sources | Claude, Gemini |
| GANESHA | `ganesha_orchestrator` | Turns findings into ≤3 tasks per brand, routes to agents | Claude, Gemini |
| CODE-SHAKTI | `code_shakti` | Implements one coding task as a pull request (you merge) | Claude |

Contracts: `agents/*.md` · registry: `agents/registry.json` · data schema: `agents/DATA_SCHEMA.md`.
Output lives in `public/agent-data/*.json` and is validated (`npm run validate:data`) before every deploy.

### Engines (both zero-cost)
- **Gemini** — `.github/workflows/agents.yml`, daily 05:53 IST + manual "Run workflow".
  Add repo secret `GEMINI_API_KEY` (free key from Google AI Studio). Optional variable `GEMINI_MODEL`.
  Evidence comes from Google News RSS; Gemini may only cite those retrieved items.
- **Claude** — Claude scheduled tasks clone this repo, research with web search, write via
  `node scripts/record.mjs --engine claude --file out.json`, validate, and push.

## Run locally
```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build → dist/
```

## Deploy
Every push to `main` builds and deploys to GitHub Pages via `.github/workflows/deploy.yml`.

## Structure
```
src/
  types.ts                 shared types
  data/demoData.ts         DEMO data (clearly labelled in the UI)
  services/                data + AI-status services (no UI code)
  components/              UI only
```

## AI connection status
Derived only from the real run log (`runs.json`): no runs → Not configured, last run failed → Error,
no run in 48h → Disconnected, otherwise Connected. The browser never holds keys or calls a provider.

## Testing states
- `?state=error` – simulated load error
- `?state=empty` – empty tasks / activity / workflows
- `?state=slow` – long loading skeleton

## Roadmap
1. ✅ Dashboard
1b. ✅ Agent layer: NARADA, GANESHA, CODE-SHAKTI on Claude + Gemini
2. Supabase / PostgreSQL data layer
3. Agent execution framework + server-side AI adapter
4. NARADA live research
5. LittleLoop & Sunverse production pipelines
6. Foliocraft conversions & consolidated revenue
