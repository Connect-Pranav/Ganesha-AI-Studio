# Ganesha AI Studio

Control-room dashboard for three brands — **LittleLoop** (kids' animated shorts), **Sunverse** (music & YouTube) and **Foliocraft** (portfolio builder) — run by three agents: **GANESHA** (orchestrator), **NARADA** (research) and **CODE-SHAKTI** (coding).

**Status:** dashboard + working agent layer. Sections marked **Live** show real agent output; sections marked **Demo** are illustrative.

## Agents — 31 in 5 teams
| Team | Agents |
|---|---|
| Master control | GANESHA (orchestrator), NARADA (research), CHITRAGUPTA (quality gate), SAMVADA (handoffs) |
| Sunverse | TUMBURU, VAGDEVI, SARASWATI, VISHVAVASU, GANDHARVA, VISHVAKARMA, SURYA, NATA |
| LittleLoop | KRISHNA, VYASA, DRISHTI, MAYA, CHITRA, NATARAJA, NADA, LAKSHMI |
| Foliocraft | BRAHMA, NIRNAYA, SUTRADHARA, KARMA (CODE-SHAKTI), KUBERA |
| Shared ops | AGNI, SOMA, HANUMAN, DHARMA, MAYA-OPS, LAKSHMI-OPS |

- Registry (single source of truth): `agents/registry.json` → team contracts generated into `agents/teams/*.md`
- Pipelines: `agents/pipelines.json` (song release, episode, feature, research, weekly ops) with
  DHARMA/CHITRAGUPTA gates and human-approval stops
- Runtime protocol: `agents/RUNTIME.md` · status CLI: `scripts/pipeline.mjs` · tests: `npm test`
- Goals go in as Issues in the **private** vault repo; deliverables stay there. This repo/site holds status only.

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
