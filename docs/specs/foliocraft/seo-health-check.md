# Foliocraft spec — Portfolio SEO health check (premium)

- **Status:** Draft spec (not implemented). Implementation needs the Foliocraft product codebase, which is not in this repository.
- **Task:** `t_20261026T023211Z_foliocraft_6_claude`
- **Source finding:** `f_20261026T023211Z_foliocraft_4_claude` — Lovable's growth tools check indexability, metadata, sitemap and robots.txt, connect Search Console, and draft ads that only go live after user approval ([Lovable blog](https://lovable.dev/blog/introducing-growth-tools), [Lovable docs](https://docs.lovable.dev/features/growth-tools), retrieved 2026-10-26, confidence: medium).
- **Tier decision:** Premium (paid plan). A basic indexability warning stays free (see scope); the full report, fix suggestions and re-check history are premium.
- **Approval:** Writing this spec needs no approval. Shipping the feature to users (deploying) does. The feature itself never spends money or submits anything to a search engine without the user's explicit action.

## Problem
A creator publishes a portfolio and assumes people can find it. Often they can't: the site is still set to "hide from search engines", pages have no title or description, project pages share one generic title, images have no alt text, or the sitemap is missing. The user has no way to see this inside Foliocraft, so the portfolio quietly stays invisible to recruiters and clients who search by name or skill.

## User
A creator on a paid plan with a published portfolio (custom domain or Foliocraft subdomain) who wants it to show up in search for their name and specialty, without learning SEO.

## Journey
1. The user opens **Settings → Search visibility** (or a "Check search health" prompt after publishing).
2. They click **Run check**. Foliocraft scans the *published* version of every public page.
3. They see a score summary (passed / warnings / errors) and a list of issues grouped by page, worst first.
4. Each issue says what is wrong, why it matters in one sentence, and offers **Fix** (opens the exact field in the editor) or, where safe, **Apply suggested fix** (e.g. generate a page title from the project title).
5. Suggested fixes change the draft only. Nothing goes live until the user republishes, as with any other edit.
6. After republishing they click **Re-check** and see which issues are resolved.

## Checks (MVP)
All checks run against Foliocraft's own rendered output for the portfolio; no third-party crawling service is needed.

| ID | Check | Severity |
|----|-------|----------|
| `indexing_disabled` | Site-level "hide from search engines" is on, or a page has `noindex` | error |
| `robots_blocks` | Generated robots.txt disallows public pages | error |
| `sitemap_missing` | sitemap.xml absent, or omits a public page, or lists a hidden/deleted page | error |
| `title_missing` | Page has no `<title>` | error |
| `title_length` | Title shorter than 10 or longer than 60 characters | warning |
| `title_duplicate` | Two or more public pages share the same title | warning |
| `description_missing` | No meta description | warning |
| `description_length` | Description shorter than 50 or longer than 160 characters | warning |
| `canonical_mismatch` | Canonical URL missing or points at a different domain than the primary domain | warning |
| `image_alt_missing` | Content image without alt text | warning |
| `heading_structure` | Page has no H1 or more than one H1 | warning |
| `social_preview_missing` | No Open Graph title/image for the home page | warning |
| `broken_internal_link` | Internal link to a page that is hidden, deleted or 404 | error |

Length thresholds are guidance for the user, not hard rules; they are kept in one config so they can be tuned without code changes.

## Data model (proposed)
```ts
type SeoSeverity = 'error' | 'warning';

interface SeoIssue {
  checkId: string;        // one of the check IDs above
  severity: SeoSeverity;
  pageId?: string;        // absent for site-level issues
  pagePath?: string;      // e.g. "/projects/brand-refresh"
  message: string;        // user-facing, plain language
  fieldRef?: string;      // editor field to open for "Fix"
  suggestedFix?: { field: string; value: string }; // draft-only change
}

interface SeoCheckRun {
  id: string;
  portfolioId: string;    // runs never cross portfolios
  publishedVersionId: string; // which published build was scanned
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'completed' | 'failed';
  error?: string;         // real error text when failed; never a fake "all good"
  pagesScanned: number;
  issues: SeoIssue[];
}
```
A failed scan shows the failure and its reason; it never displays a partial result as a clean report.

## In scope (MVP)
- The checks in the table above, run on demand against the latest published version.
- Report grouped by page with severity, explanation and a Fix link to the editor field.
- Draft-only suggested fixes for titles, descriptions and alt text (alt suggestions require the user to review each one before applying).
- Re-check and a history of the last 10 runs per portfolio.
- **Free tier:** a single banner in the editor when indexing is disabled on a published site (`indexing_disabled`), with a link to turn it off. The full report is premium.

## Out of scope (later)
- Google Search Console connection, impressions/clicks data, or sitemap submission (needs OAuth, a verified provider setup and owner approval; tracked as a follow-up).
- Paid ads or any promotion that spends money.
- Keyword research, rank tracking, backlink analysis.
- Scheduled/automatic scans and email alerts.
- AI search citation visibility (tracked separately in `t_20261027T022703Z_foliocraft_6_claude`).
- Performance / Core Web Vitals scoring.

## Acceptance criteria
1. On a paid plan, **Run check** on a published portfolio completes and lists every public page scanned (`pagesScanned` equals the number of public pages).
2. With site-level "hide from search engines" on, the report shows `indexing_disabled` as an error; turning it off, republishing and re-checking clears it.
3. A hidden or deleted page never appears in the generated sitemap; if it does, `sitemap_missing` is reported as an error naming the page.
4. Two public pages with the same title each show `title_duplicate`.
5. A page with no meta description shows `description_missing`; a 200-character description shows `description_length`.
6. A content image with no alt text shows `image_alt_missing` with the page path and a Fix link that opens that image's alt field.
7. **Apply suggested fix** changes only the draft; the published site is unchanged until the user republishes (verified by re-checking before republishing: the issue is still reported).
8. AI-suggested alt text is never applied in bulk without per-image review.
9. A link to a hidden page reports `broken_internal_link`.
10. If the scan fails (e.g. the published build can't be loaded), the run status is `failed` with the real error and no score is shown.
11. A run for one portfolio can never read pages or results of another portfolio (isolation test).
12. On the free plan, the full report is not available, but the `indexing_disabled` banner appears when the condition is true.
13. The feature makes no network calls to search engines or ad platforms.

## UX notes (for the UX spec)
- States to design: never run, running (with progress by page), completed with issues, completed clean, failed, free-plan upsell.
- Severity must be conveyed by text and icon, not colour alone.
- Mobile: issues list collapses to one column; Fix opens the editor field in a sheet.

## Open questions for the owner
- Where does the Foliocraft product code live, so this can be implemented as a PR?
- Confirm the free/premium split: is the `indexing_disabled` banner free, or should all checks be premium?
- Should a Search Console connection be the next step, given it needs OAuth and verified API access?
