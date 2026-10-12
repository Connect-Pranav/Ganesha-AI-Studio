# Ganesha AI Studio

Control-room dashboard for three brands — **LittleLoop** (kids' animated shorts), **Sunverse** (music & YouTube) and **Foliocraft** (portfolio builder) — run by three agents: **GANESHA** (orchestrator), **NARADA** (research) and **CODE-SHAKTI** (coding).

**Status: Milestone 1 — Demo Mode.** All figures are illustrative demo data. No database, no AI provider, no external integrations.

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

## AI connection
The browser never holds API keys. AI status shows **Not configured** until
`VITE_AI_STATUS_ENDPOINT` points to your own server-side adapter (see `.env.example`).
No automatic retries; no provider calls from the frontend.

## Testing states
- `?state=error` – simulated load error
- `?state=empty` – empty tasks / activity / workflows
- `?state=slow` – long loading skeleton

## Roadmap
1. ✅ Dashboard (Demo Mode)
2. Supabase / PostgreSQL data layer
3. Agent execution framework + server-side AI adapter
4. NARADA live research
5. LittleLoop & Sunverse production pipelines
6. Foliocraft conversions & consolidated revenue
