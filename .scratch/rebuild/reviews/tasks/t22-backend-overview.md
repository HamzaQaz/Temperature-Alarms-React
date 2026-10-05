Target: backend/ for ticket 22 (.scratch/rebuild/issues/22-campus-overview.md), the backend half: `GET /api/campuses/overview`.

Change: one public endpoint, needing no token like `/api/dashboard`, that returns the Campuses worst first, each with:
- campus id, name, shortcode, and closet count
- `now`: counts per Condition name and level at warning or worse, plus moderate Mold risk listed separately as a heads-up, all from the same Condition rules as the dashboard
- `worst`: the worst Device with its latest Reading, its level, and its Offline state
- `days`: the last 7 local days (use localDay.ts; today is partial), each with the day's highest temperature Reading and whether an incident at warning or worse overlapped that day. Read incidents from the incident log that ADR 0006 and the incident module describe (already built; read them)
- `lastIncidentEnd`: the end of the most recent closed incident, or `ongoing: true` with the start of the open one, or null if there is none within retention (90 days)
- `threshold`: the Hot warning threshold the server uses, so the chart's line comes from the server

Order: worst first by the worst level now, then by Campus name. Keep the queries bounded: a few grouped queries, not one per Campus per day. Check with EXPLAIN that the 7-day max uses the (device_id, recorded_at) index. Add tests at the HTTP seam:
- a Campus with no Devices
- a Campus with no incident in 90 days
- an ongoing incident
- a day that had an incident
- the 7-day boundaries in the configured local time
- worst-first ordering

Document the endpoint in README's API section with an example.

Constraints: another worker is building the Incidents page in frontend/ at the same time and may make small additive edits to the incidents route; do not edit that route. Never commit, push, stash, reset, or checkout. Share the test DB on :3307: if it is already up, use it and do not take it down. Do not start a full stack unless `docker ps` shows only the test DB.

Ownership: a new route or file for the overview, the campuses route registration, their tests, and README.md (API section only).

Observable acceptance: backend `npm test` and `npm run typecheck` pass under PowerShell. Run the demo once if no stack is running, and confirm that the overview returns the four demo Campuses with sensible days and incidents. Send worker_done with an example JSON response and --files-modified.
