# 02 — Support DHT22 and SHT31 sensors

**What to build:**
The DHT11 reads ±2 °C and ±5 % humidity, coarse for a closet sitting near a Hot threshold. Let a board carry a DHT22 or an SHT31 (I²C) instead, chosen in `config.h`, and record which sensor each Device has so Readings can be read with the right confidence.

**Blocked by:** none

**Status:** ready-for-agent

**GitHub:** #17

- [ ] `config.h`: `SENSOR_TYPE` (`DHT11`, `DHT22`, `SHT31`), with pins per type in `config.example.h`; `sensor.cpp` hides the difference behind `sensorRead`, retry and fault report unchanged
- [ ] The self-report carries the sensor type; the server stores it on the Device and Settings shows it
- [ ] Builds for each type with core 3.1.2; IRAM and flash noted (IRAM is at 92% today, and the SHT31 library is small, but check)
- [ ] README: wiring for each, and the bench checklist per type
- [ ] Bench run on a real DHT22 and SHT31: this is `ready-for-human` work once the code lands

## Open questions

- Which sensor is the district willing to buy? (Cost per closet decides it.)
- Should the Dashboard show the sensor's accuracy beside a Reading near a threshold?

## Comments

**2026-10-07 — owner decisions (triage).** Support both DHT22 and SHT31. The Dashboard does not show accuracy; the sensor type is recorded per Device and shown on its History page.
