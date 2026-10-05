Target: the Incidents page in frontend/src, which is the frontend half of ticket 21 (.scratch/rebuild/issues/21-incident-log-and-timeline.md).

Change: build the Incidents page from the chosen comp, `.scratch/design/comps/incidents.html`. Open it in a browser and read its Notes panel. Build it in the real app's components, which are shadcn/ui and Tailwind tokens from index.css, following DESIGN.md exactly. Do not copy the comp's CSS. Use the impeccable skill: run its context step and read reference/craft-floor.md before editing.
- **Navigation:** add an "Incidents" item to the sidebar, with route `/incidents` and the document title "Incidents · Temperature Alarms".
- **Controls:** a window control with Overnight (18:00 to 08:00 local), Today, and 7 days, plus previous and next and a date label. Keep the state in the URL. Next stops at the present.
- **Summary:** a one-sentence summary. Its count, worst incident, and still-going list come from what the API returned; no Condition is decided in the browser.
- **The log:** oldest first. Each row shows start, end or "ongoing", the badge with its level, the duration (or "so far"), Campus and Closet, the peak facts, the hostname in mono, and a "History, <day>" outline button linking to the History page for that Device and day.
- **The shared ruler:** each incident is a span, segmented by level, using the signal colours by the One Meaning Rule (Critical Fill for critical, with no text on it). Mark "now" for ongoing incidents. On phones, show per-row spans with a reduced ruler, as the comp's 390 px version does.
- **Live updates:** consume the stream's `incident` messages (see README's API section after the backend task; the backend worker added them). A new incident arrives at the bottom with the Reading-landed wash and a 6 px rise, and a level change updates its row in place. Reduced motion keeps the fade.
- **States:** a Skeleton while loading, the Placeholder for empty ("No incidents overnight") and error states, and fully keyboard operable.
- **DESIGN.md:** add the span chart to the Charts section, and the Incidents page wherever pages are listed.

API: `GET /api/incidents?from&to`, as implemented in backend/ (read the route, its tests, and README's API section; the shape is final). If something the comp needs is missing from the API, add it in the backend route and its tests, minimal and additive, and say so.

Constraints: you are the only frontend worker now. A backend worker may be editing backend/ for the Campus overview at the same time (a new campuses overview route); you may touch only the incidents route if strictly needed. Never commit, push, stash, reset, or checkout. Run at most one Docker stack, and only when `docker ps` shows none besides the test DB. Use `deploy/deploy.sh demo --web-port 8084`: it backfills incidents and creates live ones. Bring it down with `--down`.

Ownership: frontend/src, frontend/e2e, DESIGN.md, and the incidents route plus its tests only if needed.

Observable acceptance: frontend `npm run lint`, `typecheck`, `test`, and `build` pass. `node e2e/walk.mjs` passes; extend it with an Incidents step. On the demo, at 1440 and 390 px, the page shows backfilled nights and a live incident arriving. Run `C:/Users/night/.claude/skills/impeccable/scripts/impeccable detect --json <changed files>` and get no findings, or fix them. Save screenshots to .scratch/design/incidents/. Send worker_done with --files-modified.
