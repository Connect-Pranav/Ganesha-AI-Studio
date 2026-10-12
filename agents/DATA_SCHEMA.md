# Agent data schema

All agent output lives in `public/agent-data/` as JSON. Both engines (Claude, Gemini)
write the same shapes. `node scripts/validate.mjs` must pass before any commit;
the deploy build runs it too, so invalid data never reaches the live site.

Brand IDs: `littleloop` | `sunverse` | `foliocraft` | `studio`
Agent IDs: `narada_market_intelligence` | `ganesha_orchestrator` | `code_shakti`
Engine IDs: `claude` | `gemini`
Timestamps: ISO 8601 UTC, e.g. `2026-10-13T03:15:00Z`

## runs.json — audit history (keep newest 100)
```json
{ "runs": [{
  "id": "run_20261013T031500Z_narada_gemini",
  "agent": "narada_market_intelligence",
  "engine": "gemini",
  "startedAt": "...", "finishedAt": "...",
  "status": "success | failed | partial",
  "summary": "3 findings across 3 brands",
  "error": "only when failed/partial"
}]}
```

## research.json — NARADA findings (keep newest 60)
```json
{ "updatedAt": "...", "findings": [{
  "id": "f_20261013_littleloop_1",
  "brand": "littleloop",
  "title": "Short headline (<= 90 chars)",
  "insight": "What it means for the brand and what to try (<= 400 chars)",
  "confidence": "high | medium | low",
  "evidence": [{ "title": "...", "url": "https://...", "source": "Publisher", "retrievedAt": "..." }],
  "agent": "narada_market_intelligence", "engine": "claude | gemini", "createdAt": "..."
}]}
```
Rules: every finding needs >= 1 evidence item with a real `https://` URL that was actually
retrieved in that run. No evidence → no finding. Never invent numbers or sources.

## tasks.json — GANESHA plan (keep newest 80)
```json
{ "updatedAt": "...", "tasks": [{
  "id": "t_20261013_sunverse_1",
  "title": "Imperative, <= 90 chars",
  "brand": "sunverse",
  "agent": "ganesha_orchestrator | narada_market_intelligence | code_shakti",
  "status": "queued | in_progress | review | done",
  "priority": "high | medium | low",
  "reason": "Why, referencing finding ids",
  "sourceFindings": ["f_..."],
  "requiresApproval": true,
  "createdAt": "...", "createdBy": "ganesha_orchestrator", "engine": "claude | gemini",
  "prUrl": "optional, set by CODE-SHAKTI"
}]}
```
`requiresApproval: true` for anything that publishes, spends money or deploys.

## activity.json — event feed (keep newest 100)
```json
{ "events": [{
  "id": "e_...", "at": "...", "brand": "littleloop",
  "agent": "narada_market_intelligence", "engine": "gemini",
  "kind": "research | task | code | system",
  "text": "Plain sentence, <= 160 chars"
}]}
```
