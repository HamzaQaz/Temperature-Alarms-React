# Round 3 review — the incident log (ADR 0006), Incidents, Campuses, and the worst-first Dashboard

Reviewed 2026-10-04 on branch HamzaQaz/incidents-campuses: everything since `a9f0782` (c3e2a61, f9dd464, 25bd987, 64301e7, 86f962f). Two axes, as before: **Standards** (CLAUDE.md, DESIGN.md, PRODUCT.md, the surrounding idiom) and **Spec** (tickets 21 and 22, ADR 0006, and the task specs t21-*, t22-*, t-card-order). Two review sub-agents read the diff in parallel; I verified every finding below by reading the code or reproducing it, against the test MySQL or the demo stack (`deploy/deploy.sh demo --web-port 8084`). The coordinator added three items during the review (the SSE miss, the Offline duration, and "0 min"), and they are included here.

## Check results

| Check | Result |
|---|---|
| backend `npm test` | **211 pass, 0 fail** (207 before; 4 new tests) |
| backend `npm run typecheck` | clean |
| frontend `npm run lint`, `typecheck`, `test`, `build` | clean; **29 pass** (28 before; 1 new test, and 1 extended) |
| `impeccable detect` on the changed frontend files | `[]` |
| `node e2e/walk.mjs` on a fresh stack | **36 of 36** (own project `round3walk`, empty database, WEB_PORT 8084; taken down with `-v` afterwards) |
| `python -m unittest arduino/test_bench.py` | 53 tests OK |

## Findings and fixes, most severe first

### 1. Each latest-Reading query scanned every Reading since a silent Device last reported
- **Where:** the correlated "latest Reading" subquery in `routes/readings.ts` (`SELECT_DASHBOARD`), `routes/campusOverview.ts` (`SELECT_DEVICES`), and `incidentStore.ts` (`LATEST_READING`, used by the Offline sweep).
- **Severity:** bug (SQL cost). The Dashboard query predates this round, but the sweep and the overview are new, and the Dashboard order work runs this query on every live re-sort.
- **Found:** `EXPLAIN ANALYZE` on the demo (479k Readings, 24 Devices). Because the subquery orders by `recorded_at DESC, id DESC`, MySQL walks `ix_readings_recorded` backwards (retention's index, migration 0004) and filters on the Device. That costs one step for a Device that is reporting, but for a silent Device it reads every Reading anyone posted since. I added one Device whose last Reading was 6 days old, and the Dashboard and overview query went from about 20 ms to **2,350 ms**: 16,423 index rows per evaluation, 75 evaluations. `FORCE INDEX (ix_readings_device_recorded)` was no better at 450 ms, because MySQL then sorted the Device's whole range.
- **Fix:** start each ORDER BY with the Device, `ORDER BY r2.device_id DESC, r2.recorded_at DESC, r2.id DESC`. Inside the subquery that column is a constant, but it lets MySQL see that `ix_readings_device_recorded` already gives the order, so it reads one row backwards: **20 ms** with the silent Device, plan `Covering index lookup on r2 using ix_readings_device_recorded (reverse)`. The same prefix is on the new previous-Reading lookup at ingest (finding 2). A comment on `SELECT_DASHBOARD` says why. Plans were checked by hand; there is no automated test for a query plan.

### 2. An Offline incident was missed when the Device came back before the next sweep
- **Where:** `incidentStore.ts` `recordReadingIncidents` and `offlineSweep.ts`. Ticket 21 ("An Offline incident starts when the server declares the Device Offline") and ADR 0006 (Offline).
- **Severity:** bug (spec). Both reviewers found it independently.
- **Failure scenario:** the sweep runs once every Report interval, and Offline begins 3 intervals and 1 s after the last Reading. Take a Device that is silent for 3.3 intervals. The Dashboard shows it Offline for about 10 s, and the demo's `replayIncidents` would record an incident, but the live log records nothing, because no sweep pass ran during that window.
- **Fix (test first):** a new pure rule, `missedOffline` in `incidents.ts`. When a Reading arrives and no Offline incident is open, ingest reads the previous Reading (one indexed step). If the Device went Offline after that Reading and within the last sweep period, ingest records the Offline incident already closed, from `offlineStartsAt(previous)` to this Reading, and broadcasts it as `closed`. An older silence with nothing open means no sweep was running (a restart or an outage of the server itself), so it is not charged to the Device, which matches the ADR's intent for restarts. ADR 0006 records this. Tests: "a Device back before the sweep caught its silence still gets the Offline stretch, already closed", and "a silence older than the sweep's period with nothing open is the server's own outage, not an incident".

### 3. A Reading from a Device the Dashboard had not loaded never reached the screen (the "SSE miss")
- **Where:** `frontend/src/pages/Dashboard.tsx`, `onReading` → `applyReading`, which ignores an unknown hostname. This is the coordinator's item 1.
- **Severity:** bug.
- **Root cause, reproduced:** the stream works. On a freshly started demo, the Dashboard opened before the demo service finished seeding its 24 Devices, so it had no card for them. Every later Reading for those Devices was dropped silently, including the scripted Hot critical, so Need attention stayed 0 until a reload. Later runs opened after seeding, which is why they passed. Reproduced deterministically on the demo with a throwaway script: open the Dashboard, register a new Device through the API, and post a 95 °F Reading. The card never appeared.
- **Fix:** a Reading from a hostname with no card makes the page ask the server again, once per hostname per view (a ref set, cleared when the Campus or order changes), so another Campus's Devices under a filter cost one request each, not one per Reading. Verified on the rebuilt demo: the same script now shows the new card within the 4 s wait. There is no unit test: the logic sits in the page component, and the repo tests only `lib/`.

### 4. The Campuses chart painted every incident day Warning Amber, whatever the level
- **Where:** `pages/Campuses.tsx` (column fill), `routes/campusOverview.ts` (`days[].incident`). DESIGN.md, The One Meaning Rule: "Amber means warning wherever it appears; if it appears anywhere else, it is wrong."
- **Severity:** standards (hard). A day whose only incident was Hot critical or Mold risk high showed as warning. DESIGN.md had been edited in two places to allow this, which contradicted the rule.
- **Fix (test first):** the overview now reads incident *segments* overlapping the window, still one statement, filtered through `incidents` first. Each day gets `incidentLevel`: the worst level any incident reached on that day, so a critical stretch on Tuesday does not colour Monday. `incident` is kept. The column takes `levelLook(level).column` (a new entry beside `span`: Warning Amber, High Red at 70%, Critical Fill for critical, today solid), so the palette stays in `lib/conditions.ts`. The chart's accessible label names the level ("An incident on Thu (critical)"), and the footnote and DESIGN.md (Signal colours and Charts) now say the same. README's API section documents `incidentLevel`. Tests: backend "each day carries the worst level an incident reached on that day, from its segments…", and the frontend `chartLabel` test, extended with a critical day.

### 5. Reset history was neither atomic nor locked
- **Where:** `routes/readings.ts`, `DELETE /api/devices/:id/history`: two separate pool statements.
- **Severity:** bug (low). ADR 0006: "two writers never judge one Device at once."
- **Failure scenario:** a Reading lands between the two DELETEs and opens Hot. The second DELETE removes the incident but keeps its Reading, and the next Reading opens a second incident with a later start.
- **Fix:** both deletes run in one transaction on one connection, after `SELECT … FOR UPDATE` on the Device: the same lock ingest and the sweep take. The existing reset tests pass. The race itself is not tested.

### 6. Offline row and sentence disagreed by three Report intervals
- **Where:** `pages/Incidents.tsx` `Facts`. This is the coordinator's item 2 (".scratch/design/incidents/backfilled-night-1440.png": "2 h 38 min" against "No Readings for 2 h 40 min").
- **Severity:** bug (copy).
- **Why they differ:** the row's duration runs from the incident's start, the moment the server would first report Offline (last Reading + 3 intervals + 1 s), to the Reading that ended it. The sentence measured the silence from the last Reading.
- **Fix:** the sentence gives times instead of a second duration: "No Readings from 7:55 PM to 10:35 PM, then the Device reported again." This matches the ongoing variant ("No Readings since …"), and the row keeps the incident's own duration. Checked on the demo at 390 px.

### 7. "Since last incident" read "0 min" right after an incident ended
- **Where:** `lib/campusOverview.ts` `sinceLast`. This is the coordinator's item 3.
- **Fix (test first):** under a minute reads "Just now". So does an end a few seconds in the future, as when the browser's clock is behind the server's. Test: "reads just now for an end under a minute ago, never "0 min"". `formatGap` itself is unchanged, because "Offline, last Reading … ago" also uses it.

### 8. The 7-day Campus chart lost its last card's border on phones
- **Where:** `pages/Campuses.tsx`. shadcn's `TableBody` strips the last row's border (`[&_tr:last-child]:border-0`), and on phones each row is a card.
- **Severity:** UI bug, seen in the walk at 390 px in both themes (Willow Creek, the last card, had no outline).
- **Fix:** `max-md:[&_tr:last-child]:border` on the body. Confirmed in the retaken phone shot.

### 8b. On phones the order control covered the end of the Campus strip
- **Where:** `pages/Dashboard.tsx`, the filter row (t-card-order). On phones the Campus strip bleeds to the screen's edges (`-mx-4`), and "Worst first / By Campus" shared its row, sitting over the strip's end ("Cedar" cut off under it at 390 px).
- **Severity:** UI bug, seen while retaking `phone-dashboard.png`.
- **Fix:** the strip takes the whole row under `sm` (`max-sm:basis-full`), so the order wraps beneath it. DESIGN.md's order line says so. Confirmed in the retaken phone shot. Desktop is unchanged.

### 9. Returning to a window replayed its wash and rise
- **Where:** `pages/Incidents.tsx`. `landed` and `arrived` lived for the page's lifetime, while `Log` is keyed by window.
- **Severity:** bug (cosmetic). If you step to another night and back, every row that had arrived live washed and rose again.
- **Fix:** both are cleared when the window or date changes (state adjusted during render, as React recommends). Verified by reading.

### 10. The overview's completed-days cache grew without bound
- **Where:** `routes/campusOverview.ts` `pastDays`, keyed by `?tz=` on a public endpoint.
- **Severity:** standards (low). Asking with each of about 400 valid zones skipped the cache every time and kept every answer.
- **Fix:** at most 8 zones are kept (`PAST_DAYS_CACHE_ZONES`), and the oldest is read first.

### 11. The sweep's "first pass waits one interval" was untested
- **Fix:** a test starts the scheduled sweep with a 400 ms interval and asserts no pass at 150 ms and an Offline incident by 750 ms.

## Judged and left as they are

- **The browser picks "the worst" incident for the summary** (`lib/incidentWindow.ts` `worstIncident`). It ranks the levels the server recorded and breaks ties by duration. It decides no Condition and no level, and PRODUCT.md allows the browser to total what it can see. No change.
- **The browser chooses °F or % from the Condition name** (`Incidents.tsx` `peakFigure`). README defines `peak.value` by Condition, so the unit is part of the contract. A `peak.unit` field would be tidier. No change.
- **`lastIncident` rather than the spec's `lastIncidentEnd`.** The shape carries more: an ongoing incident's start. README and the tests document it. The spec wording should follow the code.
- **The overview's 5-minute cache of completed days** (raised as scope creep). After Reset history or a backfill, the 7-day highs can lag by up to 5 minutes while the incident flags are fresh. That is documented in the code and README, and it is the price of finding 12.
- **The 7-day maximum's cost (the coordinator's question).** Uncached on the demo (24 Devices, 479k Readings, 30 s interval) it takes **0.88 s**. A covering index `(device_id, recorded_at, temp_f)` only brought it to 0.64 s, because the GROUP BY over the CASE dominates, so it is not worth a migration. Scaled to the district's ~100 Devices: about 3.5 s for the six completed days, once per 5 minutes per zone (cached), plus today's partial range on each request, up to about 0.5 s late in the day. The page reloads at most once per 10 s per open browser. That is acceptable for a page leadership opens a few times a day. If it is ever not, a daily-high rollup table written at ingest is the fix, not a better query.
- **Level rank written three times in the backend** (`rankOf`, `severity`, `conditions.ts` `rank`) and small frontend formatters duplicated (`figure`, `ms`, `atNoon`): a Duplicated Code smell, left for a cleanup pass.
- **Never-reported Devices count as Offline on Campuses** but have no incident (ADR 0006: "it has not been installed yet"). This matches the Dashboard.

## UI walk

On the demo at 1440 × 900 and 390 × 844 (touch), in the dark and light themes: the Dashboard (worst first and By Campus), Incidents (Overnight, Today, 7 days), Campuses, History, and Settings. No console errors, no horizontal overflow on any page, and every page checked by eye (`.scratch/design/round3/`). Live checks:
- **The Dashboard rise:** a Hot critical Reading on the last card (Willow Creek MDF) moved it to first without a reload (`live-rise-1440.png`).
- **An Incidents arrival:** a Dry Reading added a row at the end of Today with the wash (`live-arrival-1440.png`).
- **Campuses:** a Reading changed two rows within the 10 s throttle (`live-campuses-1440.png`).

## Screenshots retaken

On a fresh demo, at the loop's Hot critical, Mold risk high, and Dry moment: `docs/screenshots/dashboard-dark.png`, `dashboard-light.png` (worst first changed what is above the fold), and `phone-dashboard.png` (after fix 8b) were overwritten, and `incidents.png` (7 days) and `campuses.png` were added. README's hero alt text, feature list, repo layout, and Screenshots section now mention the two pages. Nothing is left running: the demo is down with its volume, and only the shared test DB on :3307 remains, which this worker did not start.
