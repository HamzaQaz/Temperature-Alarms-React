---
title: Tell a dead sensor apart from a dead board
labels: [needs-triage]
status: open
---

## Problem Statement

When the DHT11 cannot be read (unplugged, bad wire, failed part), the firmware logs `sensor: read failed (NaN), sample skipped` (`arduino/TemperatureAlarms/sensor.cpp`) and posts nothing. To the server, a board with a dead sensor is the same as a board with no power or no network: it goes Offline after three missed Report intervals.

The two need different fixes and often different people. A dead sensor means swapping a part in the closet. Offline means power, the switch port, or WiFi. Today the technician finds out which only after driving there. Once notifications land (`.scratch/notifications/`), the email will say "Offline" for both.

## Solution

Owner decision, 2026-10-06: a new Condition, **Sensor fault**, with its own Incident, emailed like any other.

- **Firmware (version 5).** When a read fails, the board waits 2 seconds (the DHT11's minimum) and tries once more. If that also fails, it still posts to `/api/readings` for that Report interval, but with `"fault": "sensor"` and no `temp` or `humidity`, plus the usual self-report fields (`fw`, `rssi`, `uptime`, …). Boards get it over the air (ADR 0007). Older firmware keeps today's behaviour.
- **Server.** A fault report proves the board is alive, so it keeps the Device Online, but it is not a Reading: nothing is written to `readings`. The Device keeps a `last_report_at` and a count of consecutive fault reports. **Sensor fault** is active once that count reaches 3, the same three intervals Offline waits, so a single bad read never raises it. Its level is **critical**, since the closet is unmonitored. The next good Reading clears the count. The Incident then closes by the usual ADR 0006 rule: two clean Readings in a row.
- **Online/Offline moves from "last Reading" to "last report".** Offline is about hearing from the board, and a fault report is hearing from it. CONTEXT.md's definition changes to match, and ADR 0009 records it.
- **What the technician sees.** The Dashboard card shows Sensor fault. Its last good Reading stays visible but is marked stale with its age ("last good Reading 14 min ago"). The Incidents page and the email name it plainly: "Sensor fault: the board is online but its sensor is not answering."

## User Stories

1. As a technician, I want a closet whose sensor has failed to say "Sensor fault", not "Offline", so that I bring a DHT11 and not a switch port tester.
2. As a technician, I want one failed read to be ignored, so that DHT11 hiccups do not raise anything.
3. As a technician, I want a Sensor fault to be an Incident with a start and end, and to be emailed, so that it is treated as seriously as a hot closet: the closet is unwatched.
4. As a technician, I want the card to keep the last good Reading with its age, so that I know what the closet was doing when the sensor died.
5. As a technician, I want a board whose sensor and network both fail to be Offline, as today, since the server cannot tell more.
6. As an operator, I want old firmware to behave exactly as it does now, so that boards can be updated over the air one at a time.

## Implementation Decisions

- **Ingest** (`routes/readings.ts`): `parseReading` accepts either a Reading (`temp`, `humidity`) or a fault report (`fault: "sensor"`, no values); anything else stays a 422. Both need the Device token and a known Device, and both update the self-report fields (`deviceInfo.ts`). A fault report returns 202, not 201, since nothing was created. It still carries `X-Firmware-Available`, so a board with a dead sensor can still be updated.
- **Storage** (migration 0010): `devices.last_report_at DATETIME NULL` and `devices.sensor_faults INT NOT NULL DEFAULT 0`. A Reading sets `last_report_at` and zeroes `sensor_faults`; a fault report sets `last_report_at` and adds one. Backfill `last_report_at` from each Device's latest Reading.
- **Conditions** (`conditions.ts`): `ConditionName` gains `'Sensor fault'`. `conditionsFor` takes `secondsSinceReport` for Offline and `sensorFaults` for Sensor fault. When Sensor fault is active, the value Conditions (Hot, Cold, Dry, Mold risk) are not computed from the stale Reading: a sensor that died hot must not keep the closet "Hot".
- **Incidents** (`incidents.ts`, `incidentStore.ts`): a Sensor fault Incident opens on the fault report that brings the count to 3, judged under the same Device row lock as Readings. While it is active, value incidents that are still open keep their clean-Reading count frozen (no Readings arrive) and close normally once Readings resume. The Offline sweep counts silence from `last_report_at`. A Sensor fault Incident's peak is the last good Reading, as Offline's is.
- **Firmware:** `sensorRead` retries once. `reporter` gains `reportFault(hostname)`, built like the Reading body without the values. `FIRMWARE_VERSION 5`. The README bench checklist gets a step: unplug the sensor, see the fault report (serial and Settings), see Sensor fault after three intervals, plug it back, see it clear.
- **Frontend:** a Sensor fault label and style for the card, using the critical token from DESIGN.md, and the "last good Reading" stale line. The Incidents log and ruler get the new Condition's name and colour. The demo (`backend/scripts/demo.mjs`) gives one Device a sensor fault for an hour in its backfilled week, and replays it.
- **Docs:** ADR 0009 (`docs/adr/0009-sensor-fault.md`, proposed with this spec). CONTEXT.md gains **Sensor fault** and **Fault report**, and Online/Offline is reworded to "last report". ADR 0006 gets an update note for the new Condition.

## Testing Decisions

- **API seam:** a fault report is accepted with the Device token and refused without it. It writes no Reading and keeps the Device Online. Three in a row open a Sensor fault Incident at critical; two do not. A good Reading after a fault resets the count, and two close the Incident. A Device that was Hot and then faults is no longer Hot. Silence after fault reports goes Offline on time. Self-report fields update from a fault report. Old-firmware bodies are unchanged.
- **Pure tests** in the Conditions and incidents suites: the count boundary (2 versus 3), value Conditions suppressed during a fault, Offline from the last report.
- **Firmware:** the bench step above on the test board (ESP_64533B), with the build signed and installed over the air.
- **Migration test:** `last_report_at` backfilled from the latest Reading.

## Out of Scope

- Other sensor faults: readings stuck at one value, or values that are possible but wrong. A stuck DHT11 is worth a later look.
- Reporting WiFi or memory trouble as Conditions. Those stay on the Firmware tab.
- Firmware for boards that cannot be updated over the air.

## Further Notes

- Build and sign version 5 with the local `config.h` and keys. Never ship a wrong Device token over the air: a board that cannot authenticate can no longer update itself. Stage it to the test board first.
- With notifications on, the first board updated to v5 with a dead sensor will email. That is the point, but warn whoever is on the list.
