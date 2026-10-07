# 02 — Firmware 5: retry once, then send a fault report

**What to build:**
The board stops going silent when its sensor fails. It retries the read once after 2 s. If that fails too, it posts a fault report for that Report interval. Shipped over the air as version 5. See the spec's Firmware.

**Blocked by:** 01

**Status:** in-progress

- [x] `sensorRead` retries once after 2 s before giving up
- [x] `reporter`: `reportFault(hostname)` posts `{device, fault:"sensor", fw, rssi, uptime, heap, reset, update}` and treats 202 as success. It still honours `X-Firmware-Available`
- [x] `FIRMWARE_VERSION 5`. Compiles unsigned and signed with core 3.1.2, with IRAM and flash use noted
- [x] README bench checklist: unplug the sensor, see the fault report on serial and on Settings, see Sensor fault after three intervals, plug it back in, see it clear after two Readings
- [ ] Bench run on ESP_64533B: build signed with the local `config.h` and keys (not committed), stage it to that board only through the Firmware tab, then run the checklist above

## Comments

**2026-10-06, built by the coordinator.** `sensorRead` tries a NaN read once more after 2 s, with `force` so the DHT library does not hand back its cached NaN. `reporter.cpp` shares the self-report fields between `readingJson` and a new `faultJson`. One `send` posts either body, and treats 201 (Reading) or 202 (fault report) as success, honouring `X-Firmware-Available` on either. The loop sends a fault report when the read fails. `FIRMWARE_VERSION 5`. Compiled signed with the portable arduino-cli (esp8266 3.1.2, DHT sensor library 1.4.7, Adafruit Unified Sensor 1.1.15): `Enabling binary signing`, IRAM 92% (unchanged), signed image 433,540 B, marker `TA-FIRMWARE-VERSION=5`. Its path is `.scratch/prodtest/runs/ota-v5/` (gitignored: it holds the WiFi password and Device token). Bench watcher: a dead-sensor board on firmware 5 is still `FAIL bad sensor` (new test; 56/56). README module table and bench step 3 are updated. **Left:** the bench run on ESP_64533B. The server must run sensor-fault 01 first; an older server answers a fault report 422, and the board then behaves as before (Offline).
