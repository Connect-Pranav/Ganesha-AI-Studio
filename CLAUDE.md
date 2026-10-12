# Project Rules — Ganesha AI Studio

## Purpose
Build an internal AI Production Command Center for three products. This is not an external SaaS business.

## Approved product brands
- LittleLoop — Instagram kids' animated shorts.
- Sunverse — YouTube music channel and music production house.
- Foliocraft — portfolio builder with paid premium features.

Never include the owner's personal name, initials, photograph, or personal identity in product branding or public-facing output.

## Platform and agents
- Platform name: Ganesha AI Studio.
- GANESHA: master orchestrator.
- NARADA: market intelligence and trend research.
- CODE-SHAKTI: reusable coding skill.
Use clear technical IDs in code, e.g. `ganesha_orchestrator`, `narada_market_intelligence`, `littleloop_trend_scout`.

These are internal working names inspired by traditional mythology. Create original logos and visuals; do not imitate copyrighted adaptations or imply religious endorsement.

## Engineering rules
1. Inspect the repository before editing.
2. Implement code, do not merely provide instructions.
3. Make small, reversible changes.
4. Run relevant tests/build/type checks and report the actual result.
5. Never fabricate test results, data, metrics, or integration status.
6. Never suppress validation or hide errors to make the app appear healthy.
7. Keep each product's data, assets, analytics, credentials, and workflow logically isolated.
8. Use mock/demo data only when explicitly labeled as demo data.
9. Require human approval before spending money, publishing content, deploying websites, or performing irreversible actions.
10. Keep secrets in environment variables or a secret manager. Never expose secrets in frontend code or Git.
11. Do not assume Claude, OmniRoute, or Google AI Pro subscriptions automatically grant API access. Verify the configured provider, endpoint, model ID, and terms.
12. Do not expose the local OmniRoute gateway publicly.
13. Avoid adding dependencies or agents without a clear requirement.

## Agent execution contract
Every agent must have:
- A specific responsibility and technical ID.
- Validated input/output schemas.
- Explicit tool permissions.
- Bounded retries and useful error messages.
- Persisted execution status and audit history when persistence is implemented.
- Evidence and source URLs for research claims.
- Human approval gates for consequential actions.

## Working protocol
For each request:
1. Inspect relevant files and error logs.
2. State the root cause briefly when debugging.
3. Edit the actual files.
4. Run relevant verification commands.
5. Fix regressions caused by the changes.
6. Report changed files, commands actually run, results, and remaining blockers.
Do not claim success unless verified.
