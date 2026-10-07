# 03 — The demo replays fault reports the way the server does

**What to build:**
`backend/scripts/demo.mjs` replays the backfilled week's incidents with the backend's `replayIncidents`, but fault reports go through its own copied loop (`replayReports`) calling `applyFaultReport`. Let the backend's replay take a merged, time-ordered stream of Readings and fault reports, so the demo has one path and cannot drift from ingest.

**Blocked by:** none

**Status:** done

- [x] `replayIncidents` (or its successor) accepts both kinds of report, ordered by time, and applies each with `applyReading` or `applyFaultReport`
- [x] `demo.mjs` drops `replayReports`; CRMS IDF 4 still shows its hour of Sensor fault in the 7-day ruler
- [x] A backend test replays a mixed stream and gets the same incidents as live ingest of the same reports
- [x] The demo starts and looks the same (screenshot of Incidents, 7 days)

## Comments

**2026-10-07 — built by an agent; awaiting review.**

**What was built.** `backend/src/incidents.ts`: `replayIncidents(reports, rules, until?)` now takes a Device's reports oldest first, each a `TimedReading` or a new `TimedFaultReport` (`{ fault: 'sensor', recordedAt }`, the shape of the wire body; the union is `TimedReport`). A Reading goes through `applyReading` and clears the count; a fault report adds one to the count (as ingest keeps `devices.sensor_faults`) and goes through `applyFaultReport` with the last good Reading; silence is counted from the last report of either kind, so Offline opens when the sweep would have opened it and peaks at the last good Reading. A stream of Readings alone replays exactly as before. `backend/scripts/demo.mjs`: `replayReports` is gone, with the `applyReading`, `applyFaultReport` and `offlineIncident` imports it needed; the backfill loop collects one list of reports (a Reading, or a fault report in the fault hour) and `backfillIncidents(pool, device, reports)` hands it to `replayIncidents` for every Device, fault hour or not.

**Decisions beyond the ticket.** The name stays `replayIncidents` (no successor), and the caller still passes the reports oldest first, as before. The demo sorts its list once before replaying, because at a Report interval of one or two seconds its ±1.5 s jitter can swap two neighbours (the old fault-hour path sorted too). Not changed, noticed: the replay checks a silence one second before each report, so a report arriving at exactly the second Offline would begin records no Offline, where ingest's `missedOffline` records a zero-length one. The demo never lands on that second (its gaps are one or two intervals with jitter, or the long power cut), and it predates this ticket.

**Tested.** `backend/test/incidents.test.ts`: three more in "replayIncidents": Sensor fault opens on the third fault report at critical, peaks at the last good Reading, and ends at the first of two good Readings; a Reading clears the count, and a board that never sent a Reading opens nothing; silence after fault reports counts from the last one, with the last good Reading as the Offline peak. New "replayIncidents agrees with ingest": twelve reports (Readings and fault reports) posted through the real `POST /api/readings` with the server clock held by `mock.timers` (Date only), the Offline sweep run every Report interval between them, record Hot (left alone by the fault reports, its clean count frozen), Sensor fault (on the third, clean count reset by a later fault report), Offline (opened by the sweep, counted from the last fault report) and an open Hot; `replayIncidents` over the same reports gives the same list as `GET /api/incidents` (Condition, level, start, end, peak, segments). Written red first: before the change the replay could not read fault reports. Equivalence (scratch script, not committed): the old `replayReports` from 9767fd9 and the new `replayIncidents` give identical incidents on 3,000 seeded random mixed streams (38,549 incidents, 3,527 of them Sensor fault and 11,958 Offline), so the demo writes what it wrote before. The demo, run locally without containers: built backend (`node dist/index.js`) and `node scripts/demo.mjs` on the test database, Vite frontend: the backfill wrote 478,596 Readings and 7 incidents in 8 s, CRMS IDF 4 (Band Hall) has its Sensor fault (critical, 58 min, violet on the 7-day ruler), and the page logged no console errors. Screenshot: `.scratch/operations/shots/incidents-7-days.png` (1440 px, Playwright Chromium).

**Untested.** `deploy.sh demo` and the Compose `demo` service (I ran the same script as local processes rather than start containers); the demo's live loop past its first two minutes (unchanged by this ticket); the page in light theme and at phone width. "Looks the same" rests on the equivalence check and the scripted incidents all being there, not on a before-and-after pair of screenshots.

**Verified 2026-10-07** on the test MySQL (`temperature_alarms_test_demo`): backend `npm run typecheck` and `npx tsc --noEmit -p tsconfig.json` clean; `npm test` 414/414 (an earlier full run had one failure, `firmware.test.ts` "fetch failed: bad port", from the random test port landing on a port fetch refuses; that file passed 18/18 on rerun and the full run after it was clean). Not run, since nothing in frontend/ or arduino/ changed: the frontend checks and the bench tests.
