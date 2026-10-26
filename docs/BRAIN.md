# Ganesha Brain

Agents → **Brain**. Turns GANESHA from a chat bot into an agent system:

| Feature | What it does |
|---|---|
| **Missions** | One goal → GANESHA *thinks* (success criteria, risks) → *plans* 2–6 steps with the best agents → **you approve / reject** → agents *execute* one step at a time, each using earlier steps' output → a checker *verifies* every step (one redo with its note if it fails) → final result → lessons saved → delivered. |
| **Long-term memory** | Facts every agent reads before answering. Scopes: whole studio, one brand team, or one agent. Add them in Brain → Memory, or tell any agent in chat “yeh yaad rakho: …”. Missions save their own `LESSON:` lines. Keys/passwords/card numbers are refused. |
| **Skills library** | Reusable methods (`/reel-script`, `/flow-video-prompt`, `/yt-seo`, `/song-lyrics`, `/research-brief`, `/outreach-draft`, `/landing-copy`, `/code-review`, `/weekly-report`, plus your own). Type `/skill-id …` in any agent chat; the mission planner also assigns skills to steps. |
| **Multi-model router** | Free engines first. Plans → Gemini then Groq. Checks → Groq (fast) then Gemini. Agent steps → that agent's own engine, then the free ones. Claude/OpenAI are used only where you set them as an agent's engine. |
| **Connectors** | Finished missions go only to the destinations you tick: GitHub vault, Google Drive, Notion, Slack. |

Missions run while the Brain page is open (one step per call, streamed) and also every 5 minutes via the Worker cron, so closing the page doesn't stop them. Nothing is published, sent to outsiders, spent or deployed by a mission.

## Free setup (Settings → API keys)

**Groq (second free engine)** — console.groq.com → API Keys → Create → `GROQ_API_KEY` (starts with `gsk_`). Optional `GROQ_MODEL` (default `llama-3.3-70b-versatile`; change it if Groq retires that model).

**GitHub vault** — github.com → Settings → Developer settings → Fine-grained tokens → only repository `Ganesha-AI-Vault` → Permissions: *Contents: Read and write* → `GITHUB_TOKEN`. Optional `GITHUB_VAULT_REPO` (default `Connect-Pranav/Ganesha-AI-Vault`). Test warns if the repo is public.

**Slack** — api.slack.com/apps → Create app → Incoming Webhooks → On → Add to a channel → `SLACK_WEBHOOK_URL`.

**Notion** — notion.so/my-integrations → New internal integration → copy secret → `NOTION_TOKEN`. Open the Notion page that should hold mission pages → ••• → Connections → add your integration. Copy the 32-character ID from the page link → `NOTION_PAGE_ID`.

**Google Drive (Apps Script, free, no OAuth app needed)** — script.google.com → New project → paste below → set `SECRET` → Deploy → New deployment → Web app → Execute as **Me**, Who has access **Anyone** → copy the `/exec` URL → `DRIVE_WEBHOOK_URL`, and the same secret → `DRIVE_WEBHOOK_SECRET`.

```javascript
var SECRET = 'change-me-to-a-long-random-string';

function doPost(e) {
  var data = JSON.parse(e.postData.contents);
  if (data.secret !== SECRET) return out({ ok: false, error: 'bad secret' });
  if (data.ping) return out({ ok: true });
  var folder = DriveApp.getRootFolder();
  data.folder.split('/').forEach(function (name) {
    var it = folder.getFoldersByName(name);
    folder = it.hasNext() ? it.next() : folder.createFolder(name);
  });
  var doc = DocumentApp.create(data.filename);
  doc.getBody().setText(data.content);
  doc.saveAndClose();
  var file = DriveApp.getFileById(doc.getId());
  file.moveTo(folder);
  return out({ ok: true, url: file.getUrl() });
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
```

Then Brain → Connectors → **Test** each one.

## API (owner token)

`GET /api/brain` · `GET|POST /api/brain/memory` · `PATCH|DELETE /api/brain/memory/:id` · `GET|PUT /api/brain/skills` · `DELETE /api/brain/skills/:id` · `POST /api/brain/connectors/:id/test` · `GET|POST /api/brain/missions` · `GET /api/brain/missions/:id` · `POST /api/brain/missions/:id/decide` `{decision: approve|reject|cancel, deliver?}` · `POST /api/brain/missions/:id/advance`.

Tables: `brain_memory`, `brain_skills`, `missions`, `mission_steps`, `mission_deliveries` (migration 0021, created automatically).

## Missions from chat
SAARTHI (CBO chat) and GANESHA's own agent chat can start a mission: ask for multi-step work ("Sunverse ka monsoon song pack banao") and the plan appears in the chat with **Approve / Reject**. Nothing runs before you tap Approve. SAARTHI also reads the studio memory, takes `/skill-id` commands and saves "yaad rakho" facts.
