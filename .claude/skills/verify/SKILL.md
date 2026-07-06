---
name: verify
description: Build/launch/drive recipe for the LabOS Electronic Lab Notebook web app (Vite + React + TS SPA).
---

# Verifying LabOS

Single-package Vite React TS SPA. No backend — auth and data are mocked
in `src/contexts/AuthContext.tsx` and `src/data/mockData.ts`.

## Launch

```bash
npm install       # first time only
npm run dev -- --port 5173 --strictPort
```

App serves at http://localhost:5173/. Vite HMR logs to stdout; no
separate build step needed to observe changes.

## Drive it

This is a GUI — use Playwright (Chromium is preinstalled at
`/opt/pw-browsers/chromium`, no `playwright install` needed;
`npm install playwright` in scratchpad if the `playwright` package
itself isn't present).

Key flows:
- Visiting any app route while logged out redirects to `/login`.
  Auth is mocked: any non-empty email/password works
  (`AuthContext.login`). Session persists via `localStorage`
  (`labos.auth` key) — refreshing while logged in should stay on
  the same page.
- Login → `/dashboard` — stat cards, filter tabs (All/Active/Complete/Draft,
  counts derived live from `src/data/mockData.ts:experiments`),
  search box (filters by name/id), table row click → experiment editor.
- `/experiments/:id` — only `EXP-2026-0142` has full mock detail
  data (`experimentDetails` in mockData.ts). Any other id renders a
  "not found" fallback with a link back to the dashboard — useful
  for testing that path directly via URL.
  - Protocol steps are clickable and cycle pending → in_progress → done.
  - Right side panel has 3 tabs (AI Insights / Comments / History);
    Comments tab has a working add-comment input (Enter to submit).
- Sidebar nav items Protocols/Inventory/Analytics/Team/Audit Log are
  intentionally unbuilt "Coming soon" stub pages (`src/pages/StubPage.tsx`)
  — not a bug if they show a placeholder card instead of real content.
- Logout button in sidebar footer clears the mock session and
  redirects to `/login`.

## Gotchas

- The dev server binds a real port; if re-running verification in the
  same session, kill the previous background `npm run dev` first or
  pass a different `--port`.
- `noUnusedParameters` is on in tsconfig — unused fn params must be
  prefixed with `_` (e.g. `AuthContext.login`'s unused `password` in
  older iterations) or `tsc -b` fails.
