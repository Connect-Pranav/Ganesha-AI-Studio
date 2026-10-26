# Foliocraft spec — Reusable project collections

- **Status:** Draft spec (not implemented). Implementation needs the Foliocraft product codebase, which is not in this repository.
- **Task:** `t_20261025T023112Z_foliocraft_4_claude`
- **Source finding:** `f_20261025T023112Z_foliocraft_3_claude` — Relume's changelog says its new CMS adds portfolio and other collection types at no extra cost ([What's New — Relume](https://www.relume.ai/whats-new), retrieved 2026-10-25, confidence: medium).
- **Tier decision:** Free core. Per the finding, structured project lists are becoming a baseline, so this is not a premium feature.
- **Approval:** Writing this spec needs no approval. Shipping the feature to users (deploying) does.

## Problem
Today a portfolio's projects are content blocks placed page by page. A user who wants the same project on the home page, a "Work" grid and a case-study page has to keep several copies, and the copies drift apart. Reordering or hiding a project means editing every page that shows it.

## User
A creator (designer, developer, writer, photographer) keeping a portfolio of roughly 3–50 projects up to date, often while job hunting.

## Journey
1. The user opens **Projects** and sees one list of every project entry.
2. They add a project: title, summary, cover image, tags, date, optional links and a body.
3. They drag entries to set the order, and mark an entry *Featured* or *Hidden*.
4. On any page they insert a **Project list** block and pick a view: all, featured only, or filtered by tag; grid or list; a maximum count.
5. Every page that lists projects updates from the one source. Editing an entry once updates it everywhere.
6. Each visible entry gets its own detail page at `/projects/<slug>`.

## Data model (proposed)
```ts
interface ProjectEntry {
  id: string;            // stable id
  portfolioId: string;   // owner portfolio; entries never cross portfolios
  slug: string;          // unique within the portfolio, URL-safe
  title: string;         // 1–120 chars, required
  summary?: string;      // up to 280 chars
  coverImage?: { assetId: string; alt: string }; // alt text required when an image is set
  tags: string[];        // up to 10, each 1–32 chars
  date?: string;         // ISO date (YYYY-MM or YYYY-MM-DD)
  links: { label: string; url: string }[]; // https URLs only, up to 5
  body?: RichText;       // detail-page content
  featured: boolean;
  visibility: 'visible' | 'hidden';
  order: number;         // position in the collection
  createdAt: string;
  updatedAt: string;
}

interface ProjectListBlock {
  type: 'project_list';
  filter: { featuredOnly: boolean; tags: string[] }; // tags = any-of
  layout: 'grid' | 'list';
  limit?: number;        // 1–50
}
```
Validation runs on save in the editor and again on the server; invalid entries are rejected with a field-level message, never silently fixed.

## In scope (MVP)
- One project collection per portfolio, with create, edit, duplicate, delete (with confirmation) and reorder.
- Featured and hidden flags; hidden entries never render publicly.
- The Project list block with the filters and layouts above.
- An auto-generated detail page per visible entry.
- A one-time, opt-in import that turns existing project blocks into entries; the original blocks stay until the user removes them.

## Out of scope (later)
- Collection types other than projects (blog, testimonials, services).
- Custom fields defined by users.
- AI-generated project text.
- Multiple collections per portfolio, nested collections, scheduled publishing.
- External CMS sync or an API/MCP endpoint (tracked separately in `t_20261019T022526Z_foliocraft_6_claude`).

## Acceptance criteria
1. A user can create an entry with only a title; it appears in the Projects list and, when visible, on every Project list block whose filter matches.
2. Editing an entry's title updates it on all pages that list it after one save, with no per-page edit.
3. Reordering entries in Projects changes their order in every Project list block.
4. A hidden entry renders in no public list and its detail page returns 404 publicly; the owner still sees it in the editor.
5. A block with `featuredOnly: true` shows only featured, visible entries; a block with tags shows entries that have any of those tags.
6. `limit` caps the rendered count; with no matching entries the block shows an empty state in the editor and renders nothing publicly.
7. Slugs are unique per portfolio; saving a duplicate slug is rejected with a clear error, and a slug change keeps a redirect from the old URL.
8. Saving an entry with a cover image but no alt text is rejected with a field-level error.
9. Link URLs that are not `https://` are rejected.
10. Entries from one portfolio can never be read or listed by another portfolio (isolation test).
11. Deleting an entry asks for confirmation and removes it from all lists; the import never deletes the original blocks.
12. The feature is available on the free plan.

## UX notes (for the UX spec)
- States to design: empty collection, loading, save error, import preview.
- Reordering must work with the keyboard as well as drag.
- Mobile: Projects list is a single column; reorder via move up/down controls.

## Open questions for the owner
- Where does the Foliocraft product code live, so this can be implemented as a PR?
- Should hidden entries be reachable by a private share link, or never public?
