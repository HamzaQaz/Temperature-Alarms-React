Target: everything committed since commit a9f0782 on this branch: the incident log (ADR 0006), the Incidents page, the Campus overview, and the Dashboard's worst-first order. Read the tickets .scratch/rebuild/issues/21-*.md and 22-*.md, ADR 0006, and the task specs .scratch/rebuild/reviews/tasks/t21-*.md, t22-*.md, and t-card-order.md.

Change:
1. **Code review,** on two axes, Standards (CLAUDE.md, DESIGN.md, the surrounding idiom) and Spec (each ticket's checklist and each task spec). Run `git diff a9f0782..HEAD`. Look especially for:
   - incident correctness: hysteresis, the Offline sweep, restart safety, the cascade on delete and reset, and retention
   - SQL cost and indexes
   - SSE message handling
   - the browser deciding anything the server should
   - accessibility of the new charts
2. **Fix** every verified bug you find, test-first where a test can show it, and record each finding with its fix in .scratch/rebuild/reviews/round3.md.
3. **A full UI walk** on the demo stack (`deploy/deploy.sh demo --web-port 8084`), at 1440 and 390 px, in both themes: the Dashboard (worst first and By Campus, plus a live rise), Incidents (each window, a live arrival), Campuses (live), History, and Settings.
4. **Retake** docs/screenshots/ for the new pages, adding incidents.png and campuses.png, and overwrite dashboard-dark.png if the order changed what is above the fold. Update README's Screenshots section and the repo-layout or feature mentions for the two pages.
5. **Mark tickets 21 and 22** `Status: done`, ticking their checklists, with a short closing comment each (what was built, decisions, and what is untested).

Constraints: you are the only worker. Never commit, push, stash, reset, or checkout: the coordinator commits. Run one stack only, and leave nothing running at the end.

Ownership: the whole repo, for fixes. Keep fixes minimal and within the tickets' scope.

Observable acceptance: backend `npm test` and `typecheck`; frontend `lint`, `typecheck`, `test`, and `build`; `node e2e/walk.mjs` on a fresh stack; and `python -m unittest arduino/test_bench.py`, all passing. Send worker_done with the findings count, a fix summary, the check results, and --files-modified.

Also investigate: on a freshly started demo stack, one run of the card-order check saw a Reading never reach the browser over SSE (the Need attention tile stayed 0); later runs were fine. Reproduce by starting the demo, opening the Dashboard immediately, and posting a Reading. If it is real (for example, the stream connects before the API is ready and does not retry, or a proxy buffers the first event), fix it with a test.

Also check: on an Offline incident the row says "2 h 38 min" while its sentence says "No Readings for 2 h 40 min" (.scratch/design/incidents/backfilled-night-1440.png). The two durations come from different start points (incident start vs last Reading); make them agree or say why they differ.
