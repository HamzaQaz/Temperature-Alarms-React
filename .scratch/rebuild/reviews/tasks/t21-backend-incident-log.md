Target: backend/ for ticket 21 (.scratch/rebuild/issues/21-incident-log-and-timeline.md), the backend half only, plus a new ADR and the demo.

Change:
- **Write ADR 0006 (docs/adr/0006-incident-log.md)** recording these decisions, which the coordinator made for the owner on 2026-10-05:
  - An incident is a Condition at warning or worse. Moderate Mold risk is a heads-up and never an incident (this matches the dashboard's "Need attention" tile).
  - An incident opens on the first Reading whose Conditions include it at warning or worse, and it records each level change.
  - It closes after two consecutive Readings without it, at warning or worse (hysteresis, so a one-Reading blip does not flap). Its end time is the first of those two clean Readings.
  - Offline opens when the server would first report the Device as Offline (the same rule as `conditions.ts`) and closes on the next Reading. Because Offline is computed when read today, add a periodic sweep in the server process (interval at most the Report interval; it must stay cheap and run as one instance, like retention, per ADR 0001's single-instance note).
  - Incidents are kept as long as Readings are (ADR 0004's 90 days, pruned by the same retention job).
  - The peak is the worst Reading during the incident: the highest temperature for Hot, the lowest for Cold and Dry, the highest humidity for Mold risk, and for Offline the last Reading before it.
  - Read docs/adr/ for the format.
- **Migration:** add a versioned migration (see backend/src/migrations, 0005 or the next number), re-runnable like the others, for an `incidents` table and an `incident_segments` table (or one table with segments as rows; your call, so justify it in the ADR). Foreign key to devices, with ON DELETE CASCADE (deleting a Device removes its Readings today, and its incidents must go too).
- **The incident rules** live in one module next to conditions.ts and use its Condition output. Never duplicate the thresholds. Hook it into reading ingest (routes/readings.ts) inside the same transaction as the Reading insert, or right after it, with a restart-safe design: an open incident is in the database, so a restart neither loses nor duplicates it. Also hook in "Reset history" for a Device, which must delete its incidents too.
- **API:** `GET /api/incidents?from=<iso>&to=<iso>` (public like `/api/dashboard`, no token) returns the incidents that overlap the window, oldest first: Device (id, hostname, closet, campus id/name/shortcode), Condition name, worst level, start, end or null, peak Reading (value, humidity, temp, recorded_at), and segments `[{level, start, end}]`. Bound the window to 8 days or less and require `from < to` (422 otherwise).
- **Live:** emit an `incident` message on the existing SSE stream when an incident opens, changes level, or closes, in the same unnamed-message style as readings (`data` carries `type: "incident"`; read sse.ts and README's API section).
- **Demo:** backend/scripts/demo.mjs gets incidents. The live loop produces them through the API naturally. The 7-day backfill writes plausible past incidents straight into the new tables, consistent with the backfilled Readings, using the same rules: put the rules in a pure function the demo can import, or replay the rules over the backfilled Readings. Prefer the replay, so they cannot disagree.
- **Docs:** README's API section gets the new endpoint and stream message, and CONTEXT.md defines Incident.

Tests (test-first where possible, at the HTTP seam like the existing suite):
- opens on a warning Reading
- a level change adds a segment
- one clean Reading does not close it, two do
- moderate Mold risk opens nothing
- an Offline incident opens via the sweep and closes on the next Reading
- a restart (a new app instance on the same DB) continues an open incident
- deleting a Device and resetting history remove its incidents
- retention prunes them
- `/api/incidents` window validation and overlap
- the SSE `incident` message

Constraints: no frontend changes (other workers own frontend/). Another worker is editing backend/src/routes for a dashboard `order` parameter at the same time. You own the incident files, readings.ts ingest, retention.ts, sse.ts, migrations, and demo.mjs. If you must touch the dashboard query file, coordinate by keeping your change minimal and additive. Never commit, push, stash, reset, or checkout. The test DB on 127.0.0.1:3307 may be shared: if it is already up and healthy, use it and do not take it down. Run only the test DB, no full stack, unless you need one to check the demo; check `docker ps` first, and run at most one stack.

Ownership: backend/ (except routes for the dashboard order), docs/adr/0006-*, README.md (API section only), and CONTEXT.md (the Incident term).

Observable acceptance: `npm test` and `npm run typecheck` pass in backend/ under PowerShell, with the new tests. Run the demo once (`deploy/deploy.sh demo --web-port 8084`, then `--down`) and confirm `/api/incidents` returns backfilled and live incidents. Send worker_done with the API shape (an example JSON), the test counts, and --files-modified.
