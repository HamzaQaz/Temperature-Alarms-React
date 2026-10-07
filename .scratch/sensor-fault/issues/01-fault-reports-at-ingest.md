# 01 — Fault reports at ingest, and the Sensor fault Condition and Incident

**What to build:**
The server accepts a fault report from a board whose sensor is not answering. The report keeps the Device Online without writing a Reading, and three in a row raise the Sensor fault Condition (critical) and its Incident. Online and Offline count from the last report, not the last Reading. See `.scratch/sensor-fault/spec.md`, Implementation Decisions (Ingest, Storage, Conditions, Incidents).

**Blocked by:** none (if notifications 02 lands first, Sensor fault incidents are emailed with no extra work)

**Status:** done

- [x] Migration 0010: `devices.last_report_at` (backfilled from the latest Reading) and `devices.sensor_faults`
- [x] `parseReading` accepts `{device, fault: "sensor", …self-report}` with no values and returns 202. It still needs the Device token and a known Device, updates `deviceInfo`, and carries `X-Firmware-Available`
- [x] `conditions.ts`: `'Sensor fault'` (critical) when `sensorFaults >= 3`. Offline counts from seconds since the last report. Value Conditions are suppressed while Sensor fault is active
- [x] Incidents: Sensor fault opens on the third fault report and closes after two good Readings. Its peak is the last good Reading. The Offline sweep uses `last_report_at`. Both take the same Device row lock
- [x] The dashboard and stream payloads carry the new Condition and `lastReportAt`
- [x] Tests at the seam and pure tests as listed in the spec's Testing Decisions, including proof that old-firmware bodies behave as before
- [x] ADR 0009 accepted. CONTEXT.md gains **Sensor fault** and **Fault report**, and Online/Offline is reworded. ADR 0006 gets an update note

## Comments

**2026-10-06 — built by an agent, test-first; status left in-progress for the coordinator.** ADR 0009 is accepted with the details below.

**What was built.** Migration 0010 adds `devices.last_report_at` (filled from each Device's latest Reading; only NULLs, so a rerun keeps later reports) and `devices.sensor_faults`. `/api/readings` takes a fault report, `{device, fault: "sensor"}` plus the self-report fields and no values: 202 `{device, fault: "sensor"}`, no Reading written, same Device token, 404 and the New device list for an unregistered board, the same per-Device rate limit, `parseDeviceInfo`, and `X-Firmware-Available`. Any other `fault`, or a fault with `temp` or `humidity`, is 422. A Reading sets `last_report_at` and zeroes the count; a fault report sets it and adds one; both under the Device row lock, in the report's transaction. `conditions.ts` gains `Sensor fault` (critical) at `sensorFaults >= FAULT_REPORTS_BEFORE_SENSOR_FAULT` (3, a constant beside `DEFAULT_THRESHOLDS`, since config.ts belonged to the notifications work), `conditionsFor` takes `secondsSinceReport` and an optional `sensorFaults`, and while Sensor fault is active the value Conditions are not computed. `incidents.ts` gains `applyFaultReport` and a `LastReport` (`{at, reading}`) that `offlineIncident` and `missedOffline` now take; `incidentStore.ts` gains `recordFaultIncidents` and `latestReadingOf`, and the sweep counts from the last report. The dashboard carries `lastReportAt` and `secondsSinceReport`; the overview judges Conditions the same way. The stream sends a `fault` message (`device`, `fault`, `online`, `conditions`, `lastReportAt`), and a `reading` message carries `lastReportAt`. Frontend, minimal: the `Sensor fault` name and `lastReportAt`/`secondsSinceReport` in `types.ts`, the Dashboard's "aged past Offline, ask again" check counts from the last report (otherwise a faulting board, Online with an old Reading, would refetch every second), and the Incidents page's summary and facts have a plain Sensor fault line instead of "null". The fault stream message is not handled by the browser yet (ticket 03); the card catches up on its next load. README's API table, CONTEXT.md (**Fault report**, **Sensor fault**, Online/Offline from the last report), and an ADR 0006 update note.

**Decisions beyond the ticket.** (1) The last report is the later of `last_report_at` and the latest Reading, so Readings written straight to the table (the demo's backfill, a legacy import, the existing tests) still count, and a `last_report_at` past the future slack of a clock step is passed over like a future Reading (`lastReportAt` in `latestReading.ts`). (2) Sensor fault stays alongside Offline when a faulting board then falls silent, as a stale Reading's Conditions do; a board that dies outright is still only Offline. (3) A fault report between two good Readings starts an open Sensor fault's clean count again. (4) A fault report closes an open Offline incident and can record a missed Offline stretch, like a Reading. (5) A Device that has never sent a Reading opens no Sensor fault or Offline incident (no peak to store; `peak_temp_f` is NOT NULL); its Condition still shows. (6) A fault report does not mark `/api/health` ingest as working, since it wrote nothing to `readings`; a failed one still marks it failing.

**Tests.** New `backend/test/sensorFault.test.ts` at the seam, pure cases in `conditions.test.ts` and `incidents.test.ts`, the backfill and a rerun in `migrations.test.ts`, and the dashboard and stream payload expectations updated.

**Untested.** No real board: firmware 5 is ticket 02, so no fault report has come from hardware. The demo has no fault data yet (ticket 03); it still runs the same rules. The race between a fault report and the sweep is closed by the row lock, not tested. Email for Sensor fault incidents waits on notifications 02.

**2026-10-06 — verified by the coordinator.** Combined with the other ticket in progress at the same time, on a fresh MySQL 8.4: backend typecheck clean and `npm test` 344/344; frontend lint, typecheck, `npm test` 65/65, and build clean. Not committed.
