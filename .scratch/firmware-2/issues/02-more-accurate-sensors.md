# 02 — Support DHT22 and SHT31 sensors

**What to build:**
The DHT11 reads ±2 °C and ±5 % humidity, coarse for a closet sitting near a Hot threshold. Let a board carry a DHT22 or an SHT31 (I²C) instead, chosen in `config.h`, and record which sensor each Device has so Readings can be read with the right confidence.

**Blocked by:** none

**Status:** done

**GitHub:** #17

- [x] `config.h`: `SENSOR_TYPE` (`DHT11`, `DHT22`, `SHT31`), with pins per type in `config.example.h`; `sensor.cpp` hides the difference behind `sensorRead`, retry and fault report unchanged
- [x] The self-report carries the sensor type; the server stores it on the Device and Settings shows it
- [x] Builds for each type with core 3.1.2; IRAM and flash noted (IRAM is at 92% today, and the SHT31 library is small, but check)
- [x] README: wiring for each, and the bench checklist per type
- [ ] Bench run on a real DHT22 and SHT31: this is `ready-for-human` work once the code lands

## Open questions

- Which sensor is the district willing to buy? (Cost per closet decides it.)
- Should the Dashboard show the sensor's accuracy beside a Reading near a threshold?

## Comments

**2026-10-07 — owner decisions (triage).** Support both DHT22 and SHT31. The Dashboard does not show accuracy; the sensor type is recorded per Device and shown on its History page.

**2026-10-07 — built by an agent; awaiting review.** Status done for the code; the last box, the bench run on a real DHT22 and SHT31, stays open as `ready-for-human` work. README (Hardware, Wiring, Firmware, Bench checklist, API), CONTEXT.md (**Device**), ADR 0002 (new "Update 2026-10-07: More accurate sensors").

**What was built.** Firmware 6 (`FIRMWARE_VERSION` raised from 5). `config.example.h` gains `SENSOR_TYPE` (`DHT11`, the default, `DHT22` or `SHT31`), keeps `DHT_PIN` for both DHT sensors, and adds `SHT31_SDA_PIN` 4 (D2), `SHT31_SCL_PIN` 5 (D1) and `SHT31_ADDRESS` 0x44. `sensor.cpp` turns the bare word into a number the preprocessor can compare (token pasting), so each build compiles only its own sensor's code and library, and an unknown word stops the build with `#error "SENSOR_TYPE in config.h must be DHT11, DHT22 or SHT31"`; a `config.h` from before (no `SENSOR_TYPE`) builds a DHT11, as today. Behind the unchanged `sensorRead`: the DHT11 and DHT22 go through the same DHT library, the type passed straight through; the SHT31 through Adafruit SHT31 Library 2.2.2 (on Adafruit BusIO 1.17.4), `Wire.begin` on the configured pins first, a single-shot high-repeatability measurement whose checksum the library checks, converted to °F. The retry (2 s later) and its serial lines (`sensor: read failed (NaN), trying once more`, then `... sample skipped` and a fault report) are the same for every sensor, as is the Reading line `sensor: 72.5 F, 45 %`, so `bench.py` and the checklist read all three alike. New `sensorType()` names the sensor; `sensorBegin()` logs it at boot (`sensor: DHT22 on GPIO 5`, `sensor: SHT31 at 0x44, SDA GPIO 4, SCL GPIO 5`, or `SHT31 not answering at 0x44, ...`, after which it is still read every interval). The self-report (Readings and fault reports) ends with `"sensor":"DHT22"`. Backend: migration `0016-device-sensor` adds `devices.sensor` (VARCHAR(16), NULL until a board says; guarded). `deviceInfo.ts` reads `sensor`, kept only when it is exactly `DHT11`, `DHT22` or `SHT31`, and it alone makes a body a self-report; ingest writes it with the other self-report fields. `GET /api/devices/:id/history` answers `device.sensor`, `GET /api/firmware/status` answers `info.sensor`. Frontend: History's subtitle reads `Campus · ESP_A1B2C3 · DHT22 sensor` once the day has loaded and the board has said; Settings, Firmware, gains a Sensor column beside the other self-report columns. The Dashboard is unchanged.

**Decisions beyond the ticket.** Settings and History both show it: the checklist names Settings, the owner named History, and the Firmware tab is where everything else a board says about itself already shows, so it is one column there. History names the sensor and not its accuracy (the owner's decision names the type; the accuracies are in the README's Hardware table, and the Dashboard shows neither). Readings stay whole degrees and whole percent, rounded at ingest as before (ADR 0002 update): the new sensors bring accuracy, not resolution, and nothing downstream changes; storing tenths is left for its own ticket. The sensor is what the board last said, like every other self-report field: a report from older firmware, which names none, clears it rather than leaving a stale name, and a board before firmware 6 shows none (in practice a DHT11, the only sensor that firmware drives, but the server records what a board says, not what it infers). An unknown name (`BME280`, `dht22`, ` SHT31`) is dropped and the Reading still accepted, as for every self-report field. The column is a VARCHAR, not an ENUM, so a fourth sensor needs only the list in `deviceInfo.ts`. The SHT31 sits on the NodeMCU's usual I²C pins (SDA D2, SCL D1) on a breakout board, which carries the pull-ups; its heater stays off; it waits the same 2 s before a retry as a DHT, though it could go sooner. The SHT31 library was chosen over a hand-written driver (the protocol is small) for its checksum handling and bench record; it costs two pinned libraries in the README table, only SHT31 builds compile them. The bench checklist's per-sensor table gives a reference tolerance of the datasheet accuracy plus one for rounding (5 °F and 6 % for a DHT11, 2 °F and 3 % for a DHT22 or SHT31) for the first board of a new sensor: a suggestion for the human bench run, open to the owner. `FIRMWARE_VERSION` 6: a sibling firmware ticket (#18, the fallback network) may take 6 too, so whichever merges second takes 7 and its docs follow.

**Tested.** `deviceInfo.test.ts` (4 more, at the HTTP seam on the test MySQL): a Reading with `sensor: "SHT31"` is kept and shown in the Firmware status and on History, and not on another Device; a fault report carries it too (202, then shown); a later self-report without it (firmware 5 flashed back) clears it; `BME280`, `dht22`, ` SHT31`, `31` and `""` are each dropped with a 201, and `sensor` alone is still a self-report. The first test now expects `sensor: null` from a firmware 3 board; `history.test.ts`'s contract test expects `sensor: null` on the Device; the migration tests list `0016-device-sensor` and re-run it when it landed unrecorded. Firmware compiled with arduino-cli and core 3.1.2 (never flashed), every build signed with a throwaway key pair kept outside the repo, so the figures match a production build:

| Build | IRAM | Code in flash | Globals in RAM | `.bin` |
| --- | --- | --- | --- | --- |
| 03c4700, firmware 5, DHT11 | 60,847 / 65,536 B (92 %) | 397,776 B (37 %) | 29,520 B | 433,216 B |
| firmware 6, `DHT11` | 60,847 (92 %) | 397,960 (37 %) | 29,516 | 433,408 |
| firmware 6, `DHT22` | 60,847 (92 %) | 397,960 (37 %) | 29,516 | 433,408 |
| firmware 6, `SHT31` | 61,447 (93 %, 93.8) | 400,848 (38 %) | 29,988 | 436,912 |

The DHT builds cost no IRAM and 184 bytes of flash; the SHT31 build adds 600 bytes of IRAM (the core's I²C driver) and about 3 KB of flash, and links Adafruit SHT31, BusIO, Wire and SPI instead of the DHT libraries (checked in each build's library folder; each binary carries only its own sensor's boot line). No compiler warnings. A `config.h` without `SENSOR_TYPE` builds the DHT11 firmware byte for byte the same size as `DHT11`; `SENSOR_TYPE BME280` stops at the `#error`. Frontend: typecheck, lint, unit tests and build.

**Untested.** Any real board: the bench run on a DHT22 and an SHT31 (the open box), an SHT31 at 0x45 or on other pins, an SHT31 unplugged and plugged back in while running, and an over-the-air update from firmware 5 to 6. The History subtitle and the Firmware tab column only through typecheck and build, not in a browser. The migration on a copy of the production database.

**Verified 2026-10-07** against `temperature_alarms_test_sensors`: in `backend/`, `npm run typecheck` and `npx tsc --noEmit -p tsconfig.json` clean; `npm test` 448/450. The 2 failures are `legacyMigration.test.ts`'s case-sensitive table-name checks (`ESP_2EB804` comes back `esp_2eb804`): the server answering on 127.0.0.1:3347 for that run reported a Windows build of MySQL 8.4 with `lower_case_table_names=1` (Docker Desktop was down), and the untouched 03c4700 backend fails the same two there (10/12); this ticket does not touch the legacy migration. Before that outage, `deviceInfo`, `migrations`, `history` and `legacyMigration` passed 58/58 on the container. In `frontend/`: `npm run typecheck`, `npm run lint`, `npm test` 85/85, `npm run build`, all clean. Firmware: `arduino-cli compile --fqbn esp8266:esp8266:nodemcuv2` with core 3.1.2 for `DHT11`, `DHT22` and `SHT31` (figures above), plus the 03c4700 sketch, an unknown type and an old `config.h`. Not run: `bench.py`'s tests (`bench.py` unchanged), the deploy tests (nothing in `deploy/` changed), the browser walk.
