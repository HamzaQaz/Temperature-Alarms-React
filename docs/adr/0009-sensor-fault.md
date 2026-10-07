---
status: accepted
---

# A board with a dead sensor sends fault reports; Sensor fault is its own Condition

Until now, a failed DHT11 read was skipped and nothing was posted, so a dead sensor looked exactly like a dead board: Offline after three missed Report intervals. The fixes differ (a part in the closet against power, port, or WiFi), so the owner decided on 2026-10-06 to tell them apart with a new Condition and Incident.

## Decision

- **Firmware 5** retries a failed read once after 2 s. If that also fails, it posts a **fault report** to `/api/readings` for that Report interval: `{"device", "fault": "sensor"}` plus the usual self-report fields, with no values. Older firmware is unchanged.
- **A fault report is not a Reading.** Nothing goes into `readings`, and it returns 202. It needs the Device token and a registered Device, as a Reading does, shares the Device's rate limit, updates the self-report fields, and carries `X-Firmware-Available`, so a board with a dead sensor can still be updated. Any other `fault` value, or a fault with a `temp` or `humidity`, is a 422. It updates `devices.last_report_at` and adds one to `devices.sensor_faults` (migration 0010, which fills `last_report_at` from each Device's latest Reading). A Reading sets `last_report_at` and zeroes the count.
- **Online and Offline count from the last report, not the last Reading.** Offline means the server has not heard from the board, and a fault report is hearing from it. This changes CONTEXT.md's definition. For old firmware the two are the same. The last report is the later of `last_report_at` and the latest Reading, since a Reading written straight to the table (the demo's backfill, a legacy import) is a report too; a `last_report_at` stamped past the future slack of a clock step is passed over, as a future Reading is (`latestReading.ts`).
- **Sensor fault** (level critical: the closet is unwatched) is active when the count reaches 3 (`FAULT_REPORTS_BEFORE_SENSOR_FAULT` in `conditions.ts`, fixed rather than configured), the same three intervals Offline waits by default, so a single DHT11 hiccup raises nothing. While it is active, Hot, Cold, Dry, and Mold risk are not computed from the stale last Reading. If the board then falls silent, Sensor fault stays alongside Offline, as a stale Reading's Conditions do.
- **Its Incident** follows ADR 0006: it opens on the third fault report and closes after two good Readings in a row, ending at the first. A fault report between two good Readings starts that count again. Its peak is the last good Reading, as Offline's is. Fault reports are judged under the same Device row lock, in the same transaction, as Readings. A fault report closes an open Offline incident, as a Reading does, and can record a missed Offline stretch the same way.
- **What browsers get.** The dashboard carries `lastReportAt` and `secondsSinceReport` beside `secondsSinceReading`. The stream sends a `fault` message (`device`, `online`, `conditions`, `lastReportAt`) for each fault report, and a Reading's message carries `lastReportAt`.

## Consequences

- A board with both a dead sensor and no network is Offline, as before.
- The Offline sweep reads the last report; the "heard since" rule of ADR 0006 is unchanged.
- Value incidents open when the sensor died stay open, and their clean count is frozen, until Readings return. They then close by the normal rule.
- A Device that has never sent a Reading opens no incident, Sensor fault or Offline: there is no Reading to be its peak. Its Sensor fault Condition still shows on the dashboard.
- A fault report does not tell `/api/health` that ingest works (`ingestHealth.ts`): it wrote nothing to `readings`. A failed one still marks ingest failing.
- Notifications (ADR 0008) email Sensor fault incidents like any other.
- Stuck-value faults (a sensor returning the same number forever) are not detected.
