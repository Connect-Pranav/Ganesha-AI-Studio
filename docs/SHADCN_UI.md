# shadcn/ui in Ganesha AI Studio

Components live in `src/components/shadcn/` (Button, Badge, Input, Textarea, Dialog, Tabs, Toaster via sonner).
Live gallery: **Settings → UI components (shadcn/ui)** (preview only; nothing is sent or saved).

```tsx
import { Button } from '@/components/shadcn/button';
<Button variant="outline" size="sm">Approve</Button>
```

## Isolation from the existing design (`src/styles.css`)
- Tailwind v4 with prefix **`tw:`** → write classes as `tw:flex tw:gap-2`. Theme variables are `--tw-*`.
- shadcn colour tokens are `--sc-*` in `src/shadcn.css` (the app already uses `--accent`, `--radius`, `--sidebar`…).
- No Tailwind Preflight (it would restyle the whole app); a small reset applies only to shadcn parts (`[data-slot]`).
- Tailwind scans only `src/components/shadcn/`. Put Tailwind-styled code there, or add an `@source` line.
- The Settings gallery is code-split; the Toaster is mounted once in `App.tsx`.

## Adding more components
`components.json` is configured (`style: new-york`, prefix `tw`, ui alias `@/components/shadcn`), so on your own
computer `npx shadcn@latest add card` writes a correctly prefixed component. The cloud agent environment cannot
reach ui.shadcn.com, so components there were copied from the MIT-licensed source (github.com/shadcn-ui/ui,
`apps/v4/registry/new-york-v4/ui`) and prefixed with the same transform.

## shadcn MCP server
`.mcp.json` registers `npx shadcn@4.22.1 mcp` for Claude Code sessions opened in this repo on your computer
(browse/search/install components by chat). It is a local server; it is not a claude.ai connector.
