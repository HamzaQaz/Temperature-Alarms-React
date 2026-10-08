---
status: accepted
---

# One `readings` table instead of one table per Device

The PHP-era schema created a new MySQL table per Device at runtime, named after the Device hostname, with dates stored as locale-formatted strings. This forced string-built SQL, an identifier whitelist, DDL executed from a form field, one query per Device for the dashboard, and text-parsing of timestamps in the browser. We decided on a single `readings` table keyed by `device_id` with a real `DATETIME` column, alongside `devices` and `campuses` (the table formerly called `locations`). Temperature stays an integer in Fahrenheit because the DHT11 resolves whole degrees.

## Update 2026-10-07: More accurate sensors

A board can now carry a DHT22 or an SHT31 instead of a DHT11 (firmware 6), and both resolve tenths of a degree and of a percent. Readings stay whole numbers all the same, rounded at ingest as before: the new sensors are there for accuracy (±0.5 °C and ±0.3 °C against the DHT11's ±2 °C), which rounding keeps, not for resolution, and one integer column keeps every query, chart, CSV and incident peak unchanged. Each Device records which sensor its board says it carries, so its History page can name it. Storing tenths would be a schema change of its own, if the Hot threshold ever needs them.

## Consequences

- A one-time, re-runnable migration walks each existing `ESP_*` table into `readings`, parsing the string dates once. Old tables are left in place until the numbers are verified, then dropped by hand. This is the one place an identifier is built from data: a legacy table name is accepted only after matching the hostname pattern exactly, and every other statement stays parameterised.
- "Offline" and "history for a day" become `recorded_at` comparisons in SQL, not string matching.
- Adding a Device is a plain INSERT; deleting one cascades to its Readings.
