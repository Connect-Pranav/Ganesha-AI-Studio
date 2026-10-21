# GANESHA GROWTH AI

Owner-only lead generation, CRM and approval-gated outreach inside Ganesha AI Studio.
UI: top navigation → **Growth** (`#/growth`). API: `/api/growth/*` (admin token required).

## Brands
Only **LittleLoop**, **Sunverse / SURVERSE** and **Foliocraft**. Enforced in three places:
`worker/growth/brands.mjs` (`assertBrand`), every service query, and `CHECK` constraints in
`migrations/0017_growth.sql`. Adding a brand is a deliberate code change to those files plus a new
migration. NIKHILs TECH Studio is not part of Growth AI and is not configured anywhere in it.

## Architecture (reuses existing agents — no new agents)
| Capability | Implemented by |
|---|---|
| Growth Manager (plans, limits, budgets) | `worker/growth/agents.mjs` `budgetCheck` + campaign settings |
| Market Researcher / Lead Hunter / Company Researcher | NARADA (`narada_market_intelligence`) — Gemini + Google Search grounding |
| Qualification & Scoring | SOMA (`ops_soma_analytics`); points clamped/summed on the server (`computeScore`) |
| Outreach Writer, Reply Intelligence | SAMVADA (`samvada_handoffs`); policy check `draftIssues` (DHARMA rules) |
| Pipeline Manager | `worker/growth/core.mjs` (stages, audit, dedupe, suppression, tasks) |
| Revenue & Analytics | `worker/growth/analytics.mjs` (counts from rows only) |
| Cost & Resource Manager | `growth_jobs` log + CFO pricing (`finance.mjs`) |

Data: `growth_campaigns`, `growth_leads`, `growth_activities` (audit trail), `growth_drafts`,
`growth_suppressions`, `growth_replies`, `growth_tasks`, `growth_jobs`, `growth_brand_config`.

## Sales playbooks (Mushak's skills)
`worker/growth/playbooks.mjs` holds the playbooks each agent job loads into its prompt:
finding (signal-based prospecting from public sources), signals, qualification (BANT mapped onto the
5-part score), writing (short, signal-first, one easy-yes question), offer ladder, replies & objections,
and account rules (one contact per organisation at a time; stop after 3 silent contacts or ~6 touches).
Adapted from the MIT-licensed skill files of github.com/ethanplusai/harvey (© 2026 Ethan Rogers).
Not adopted: email-pattern guessing / SMTP probing, LinkedIn profile search and LinkedIn automation,
and automated sending. A first message whose subject fakes a thread ("re:"/"fwd:") is refused;
template/AI phrases, em dashes, "!" and long bodies are shown to the owner as non-blocking style flags.

## Approval gate (mandatory)
1. Agent or owner creates a draft → status `pending_approval`; recipient, suppression and permission checked.
2. Owner approves → `approved_hash = content_hash`.
3. Any edit changes `content_hash` → approval invalid → back to `pending_approval`.
4. `sendDraft` is the only send path: needs a valid approval, re-checks suppression, compare-and-set lock,
   unique idempotency key. Manual channel is marked sent only when the owner confirms (`confirmSent: true`).
5. Opt-out / "no thanks" replies add the contact to the do-not-contact list for all brands.

There is no auto-approve setting and no agent can call approve or send.

## Limits & cost
Per campaign: agent jobs/day, max leads, ₹ budget (0 = free tier only). Per brand: monthly job cap
(`GROWTH_MONTHLY_JOB_LIMIT` env overrides). CFO "pause dispatch" also stops Growth jobs. Cost per job =
CFO verified price × your billing tier; unknown prices stay "unknown". Agent jobs retry once.

## Setup
- `GEMINI_API_KEY` (Settings → API keys). Google Search grounding uses Gemini's free monthly quota.
- Optional: `GROWTH_MONTHLY_JOB_LIMIT`.
- Email/calendar/inbox integrations are **not connected**: send manually and confirm; paste replies;
  track meetings and confirm them yourself. The `email` channel reports "not connected" until an adapter exists.

## Limitations
- Discovery relies on Google Search grounding; sources not returned by grounding are marked unverified.
- Only generic business mailboxes (partnerships@, hello@…) are stored; personal emails are dropped.
- Demo leads (Settings tab) are labelled DEMO, excluded from metrics and cannot be contacted.
