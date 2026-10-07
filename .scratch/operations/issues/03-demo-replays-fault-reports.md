# 03 — The demo replays fault reports the way the server does

**What to build:**
`backend/scripts/demo.mjs` replays the backfilled week's incidents with the backend's `replayIncidents`, but fault reports go through its own copied loop (`replayReports`) calling `applyFaultReport`. Let the backend's replay take a merged, time-ordered stream of Readings and fault reports, so the demo has one path and cannot drift from ingest.

**Blocked by:** none

**Status:** ready-for-agent

- [ ] `replayIncidents` (or its successor) accepts both kinds of report, ordered by time, and applies each with `applyReading` or `applyFaultReport`
- [ ] `demo.mjs` drops `replayReports`; CRMS IDF 4 still shows its hour of Sensor fault in the 7-day ruler
- [ ] A backend test replays a mixed stream and gets the same incidents as live ingest of the same reports
- [ ] The demo starts and looks the same (screenshot of Incidents, 7 days)

## Comments
