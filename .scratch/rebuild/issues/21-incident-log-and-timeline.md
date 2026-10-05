# 21 — Incident log and the Incident timeline

**What to build:**
A technician opens Incidents first thing in the morning and reads what happened overnight. Each incident shows its Device, its Condition and peak level, the start, the end (or "ongoing"), and the duration, plus a link to that day's History. Under the list sits a shared overnight ruler that shows each incident as a span, so overlaps and the worst stretch of the night are visible at a glance. The direction is the comp `.scratch/design/comps/incidents.html`; PRODUCT.md names the technicians' morning job.

**Blocked by:** 20 — Review every ticket, and deploy in one step

**Status:** done

- [x] The backend records an incident when a Device's Condition reaches warning or worse. It records each level change and the end, along with the peak Reading. The server decides every one of these: the incident rules live beside the Condition rules, never in the browser (PRODUCT.md, "The server decides, the browser shows")
- [x] An incident that is open when the server restarts is neither lost nor duplicated. An Offline incident starts when the server declares the Device Offline
- [x] `GET /api/incidents?from&to` returns the incidents that overlap a window, oldest first, each with its level segments. Retention follows ADR 0004, or a decision recorded in a new ADR
- [x] An Incidents page in the sidebar shows the Overnight, Today, and 7 days windows, with previous and next. It has a one-sentence summary, the log, and the ruler. A new incident arrives live over the existing stream
- [x] The demo (`backend/scripts/demo.mjs`) produces incidents, so the page has content without hardware
- [x] Tests at the API seam: an incident opens, changes level, closes, survives a restart, and an Offline incident opens and closes

## Open questions for triage

- Is moderate Mold risk an incident, or only a heads-up? The comp counts warning and worse only.
- Should a short blip (one Reading over the threshold) open an incident, or is a minimum duration needed?

## Comments

**2026-10-04 — done, by supervised Orca workers; reviewed in round 3.** Specs: `.scratch/rebuild/reviews/tasks/t21-backend-incident-log.md` and `t21-frontend-incidents.md`. Review: `.scratch/rebuild/reviews/round3.md`.

**What was built.** ADR 0006 records the rules, and they live in `backend/src/incidents.ts`: pure functions beside `conditions.ts`, never a second copy of the thresholds. `incidentStore.ts` loads and saves them in two tables, `incidents` and `incident_segments` (migration 0005), which cascade with their Device. Ingest judges each Reading in the Reading's own transaction, under the Device's row lock. An Offline sweep runs once per Report interval, its first pass one interval after start. Ingest also records, already closed, an Offline stretch the sweep missed because the Device came back before the next pass. `GET /api/incidents?from&to` (at most 8 days, 422 otherwise) and an `incident` stream message on open, level change, and close. Reset history and retention remove incidents with their Readings. The demo replays the same rules over its backfilled week. The Incidents page in the sidebar has the Overnight (18:00 to 08:00), Today, and 7 days windows in the URL, previous and next (next stops at the present), a summary sentence, the log oldest first with a History link per row, and the shared span ruler segmented by level (per-row spans on phones). A live incident arrives at the end of the log with the Reading-landed wash.

**Decisions (the open questions).** Moderate Mold risk is a heads-up, never an incident. One Reading at warning or worse opens an incident, and it takes two clean Readings in a row to close it, so there is no minimum duration to open but there is hysteresis to close. Incidents are kept as long as Readings, 90 days (ADR 0004); an ongoing one stays however old it is.

**Untested.** Real hardware and a real night: everything here ran on the test database and the demo. The race between a Reading and Reset history is closed by a lock but not tested. The Dashboard's reload for a Device it had not loaded is verified on the demo, not by a unit test. A restart in production was tested only as a new app instance on the same database.
