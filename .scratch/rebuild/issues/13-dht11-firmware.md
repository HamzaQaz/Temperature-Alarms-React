# 13 — DHT11 firmware

**What to build:**
An installer wires a DHT11 to a NodeMCU per the new diagram, fills in one config header, flashes one sketch, and the board reports a Reading every 30 seconds to the backend with the Device token. It survives WiFi drops without a reboot and never sends a bad sample.

**Blocked by:** 06 — Reading ingest with the Device token

**Status:** done

- [x] The old DS18B20 sketch and its pinout image are deleted
- [x] The sketch is a folder of small files the Arduino IDE compiles together: the main sketch with only setup and loop, a WiFi module, a sensor module, a reporter module, and a config header
- [x] `config.example.h` is committed with SSID, password, server URL, Device token, and interval; `config.h` is gitignored
- [x] The board identifies itself by its `ESP_` hostname
- [x] Data pin is GPIO 5; a new pinout diagram shows DHT11 on GPIO 5, 3.3 V, and ground, with a note about the 10 kΩ pull-up for bare four-pin sensors
- [x] NaN samples are skipped and logged to serial
- [x] Each Reading is a JSON POST with the Device token as a bearer header; the HTTP status is logged to serial; a failure waits for the next interval with no retry loop
- [x] WiFi reconnects in the loop without a reboot
- [x] No on-device web server
- [x] The firmware README section covers wiring, library names and versions, board settings, flashing, and the bench checklist: hostname on serial, first POST returns 201, unplugged sensor yields skipped samples, router reboot yields resumed posting
- [x] Verified once against the running ingest endpoint

## Comments

2026-09-09: Implemented. The sketch compiles clean with `--warnings all` under arduino-cli (esp8266 3.1.2, DHT sensor library 1.4.7, Adafruit Unified Sensor 1.1.15). No board was on hand, so the last box is open: what was verified against the running backend is the exact request the reporter builds (same body, `Content-Type`, and `Authorization: Bearer` header, sent with curl), which returned 201, a wrong token 401, and an unregistered hostname 404. The bench checklist in the README is how to close it with hardware.

## Comments

**2026-09-09 — hardware verification.** Flashed a NodeMCU with an integrated DHT11 (`ESP_8FBD03`) from WSL over usbipd with arduino-cli. Serial showed `wifi: connected`, the hostname, then `sensor: 88.3 F, 30 %` and `report: 201 created` every 30 s against the dev backend through a Windows port-forward; the card appeared on the dashboard as Online with a Hot warning at 89 °F. The integrated board carries its sensor on GPIO 4 (D2), not the D1 the wiring diagram uses, so `DHT_PIN` became a `config.h` setting defaulting to 5; a probe sketch confirmed the sensor answered only on D2 and only with DHT11 timing.
