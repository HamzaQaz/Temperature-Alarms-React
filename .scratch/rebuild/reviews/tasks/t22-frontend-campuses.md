Target: the Campuses page in frontend/src, which is the frontend half of ticket 22 (.scratch/rebuild/issues/22-campus-overview.md).

Change: build the Campus overview from the chosen comp, `.scratch/design/comps/campuses.html`. Open it and read its Notes panel. The audience is IT leadership (PRODUCT.md, Users). Build it in the real app's shadcn/ui components and the tokens in index.css, following DESIGN.md exactly; do not copy the comp's CSS. Use the impeccable skill: run its context step and read reference/craft-floor.md before editing.
- **Navigation:** a "Campuses" sidebar item at route `/campuses`, with the title "Campuses · Temperature Alarms". Put it in a sensible order with Dashboard, Incidents, and Settings.
- **Summary:** a one-sentence summary at the top (no headline tiles), built from the API's numbers.
- **Table:** one row per Campus, in the API's worst-first order. The columns are:
  - Campus, as a link to the Dashboard filtered to that Campus
  - In a Condition now, as badges with counts; moderate Mold risk shows as a heads-up
  - Worst closet, as a link to its History today
  - 7 days, as a small labelled column chart of each day's high against the server's threshold line, with amber only on days the API flagged as holding an incident (the One Meaning Rule) and an accessible label
  - Since last incident, which links to the Incidents page for that window
- **Below the table:** a footnote naming the threshold and the retention window.
- **Phones:** stacked rows with labels, as in the comp's 390 px version.
- **Live updates:** refresh on the stream's reading and incident messages, throttled to at most once per 10 s. A changed row takes the Reading-landed wash.
- **States:** Skeleton, Placeholder (empty and error), and fully keyboard operable.
- **DESIGN.md:** add the small column chart to Charts.

API: `GET /api/campuses/overview`, as implemented (read the route, its tests, and README's API section). If something is missing, add it minimally to that route and its tests, and say so.

Constraints: you are the only frontend worker now, and no backend worker is running. Never commit, push, stash, reset, or checkout. Run at most one Docker stack, and only when `docker ps` shows none besides the test DB: `deploy/deploy.sh demo --web-port 8084`, then `--down`.

Ownership: frontend/src, frontend/e2e, DESIGN.md, and the overview route plus its tests only if needed.

Observable acceptance: frontend `npm run lint`, `typecheck`, `test`, and `build` pass. `node e2e/walk.mjs` passes; extend it with a Campuses step. On the demo, at 1440 and 390 px, the page reads right. Run `C:/Users/night/.claude/skills/impeccable/scripts/impeccable detect --json <changed files>` and fix its findings. Save screenshots to .scratch/design/campuses/. Send worker_done with --files-modified.
