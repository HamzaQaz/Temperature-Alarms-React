---
status: accepted
---

# The server records incidents: warning or worse, two clean Readings to close, kept as long as Readings

Technicians open the Incidents page in the morning to read what happened overnight (ticket 21). Rebuilding that from raw Readings in the browser would put Condition rules in the browser, which PRODUCT.md rules out, and Offline cannot be rebuilt from Readings at all because it is the absence of them. So the backend records incidents as they happen. The coordinator made these decisions for the owner on 2026-10-05:

- **What an incident is.** A Condition at warning or worse: Hot warning or critical, Cold, Dry, Mold risk high, Offline. Moderate Mold risk is a heads-up and never an incident, the same line the dashboard's "Need attention" tile draws.
- **When it opens.** On the first Reading whose Conditions (from `conditions.ts`, never a second copy of the thresholds) include it at warning or worse. Each later level change is recorded as a new segment; the incident's level is the worst any segment reached.
- **When it closes.** After two consecutive Readings without it at warning or worse. One clean Reading is a blip and changes nothing, so an incident does not flap on a closet sitting at the threshold. The end time is the first of the two clean Readings. Falling back to moderate Mold risk counts as clean.
- **Offline.** It opens when the server would first report the Device Offline, by the same rule as `conditions.ts`: the second after three Report intervals with no Reading. Because Offline is computed when read, no Reading can open it, so the backend runs a sweep once every Report interval that opens one for each Device now past that point. The first pass waits one interval after start, so a quick restart does not mark every Device Offline before it has had a chance to report. The next Reading closes it, with that Reading's time as the end. A Device that has never reported has no Offline incident: it has not been installed yet.
- **The peak.** The worst Reading during the incident: the highest temperature for Hot, the lowest for Cold and the lowest humidity for Dry, the highest humidity for Mold risk. For Offline it is the last Reading before the silence.
- **How long they are kept.** As long as Readings: an incident that ended before the retention window (ADR 0004, 90 days) is deleted by the same daily job, after the Readings. An ongoing incident stays however old it is.

## How it is stored

Two tables, `incidents` and `incident_segments`, both deleted with their Device (and the segments with their incident) by `ON DELETE CASCADE`, as Readings are. Segments are rows of their own rather than a JSON column or a fixed set of columns because an incident has any number of them (a closet swinging between Hot warning and critical gets one per swing), and the timeline reads them in order by incident. The incident row carries what the rules need between Readings: the clean-Reading count, the time of the first clean Reading, and the peak so far.

The rules live in `backend/src/incidents.ts`, pure functions beside `conditions.ts`; `incidentStore.ts` loads and saves. Ingest runs them in the same transaction as the Reading insert, holding the Device's row lock, and the sweep takes the same lock, so two writers never judge one Device at once. An open incident exists only in its row, never in memory, so a restart neither loses nor duplicates it, and a unique key on (Device, Condition while open) refuses a second open incident outright. The backend is one process (ADR 0001), so one sweep runs, as one retention job does.

## Consequences

- `GET /api/incidents?from&to` serves the log and the timeline: incidents that overlap a window of at most eight days, oldest first, each with its segments. The stream sends an `incident` message when one opens, changes level, or closes.
- Reset history deletes a Device's incidents with its Readings: an incident whose Readings are gone cannot be checked.
- Changing a threshold changes which future Readings open incidents; recorded incidents keep the levels they were recorded at.
- The demo replays the same rules over its backfilled week (`replayIncidents`), so its past incidents cannot disagree with its Readings.
- An Offline incident can open up to one Report interval after the moment it records as its start, the sweep's period. Its start time is still exact.
