# 13 — DHT11 firmware

**What to build:**
An installer wires a DHT11 to a NodeMCU per the new diagram, fills in one config header, flashes one sketch, and the board reports a Reading every 30 seconds to the backend with the Device token. It survives WiFi drops without a reboot and never sends a bad sample.

**Blocked by:** 06 — Reading ingest with the Device token

**Status:** ready-for-agent

- [ ] The old DS18B20 sketch and its pinout image are deleted
- [ ] The sketch is a folder of small files the Arduino IDE compiles together: the main sketch with only setup and loop, a WiFi module, a sensor module, a reporter module, and a config header
- [ ] `config.example.h` is committed with SSID, password, server URL, Device token, and interval; `config.h` is gitignored
- [ ] The board identifies itself by its `ESP_` hostname
- [ ] Data pin is GPIO 5; a new pinout diagram shows DHT11 on GPIO 5, 3.3 V, and ground, with a note about the 10 kΩ pull-up for bare four-pin sensors
- [ ] NaN samples are skipped and logged to serial
- [ ] Each Reading is a JSON POST with the Device token as a bearer header; the HTTP status is logged to serial; a failure waits for the next interval with no retry loop
- [ ] WiFi reconnects in the loop without a reboot
- [ ] No on-device web server
- [ ] The firmware README section covers wiring, library names and versions, board settings, flashing, and the bench checklist: hostname on serial, first POST returns 201, unplugged sensor yields skipped samples, router reboot yields resumed posting
- [ ] Verified once against the running ingest endpoint
