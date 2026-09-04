---
status: accepted
---

# One `readings` table instead of one table per Device

The PHP-era schema created a new MySQL table per Device at runtime, named after the Device hostname, with dates stored as locale-formatted strings. This forced string-built SQL, an identifier whitelist, DDL executed from a form field, one query per Device for the dashboard, and text-parsing of timestamps in the browser. We decided on a single `readings` table keyed by `device_id` with a real `DATETIME` column, alongside `devices` and `campuses` (the table formerly called `locations`). Temperature stays an integer in Fahrenheit because the DHT11 resolves whole degrees.

## Consequences

- A one-time, re-runnable migration walks each existing `ESP_*` table into `readings`, parsing the string dates once. Old tables are left in place until the numbers are verified, then dropped by hand.
- "Offline" and "history for a day" become `recorded_at` comparisons in SQL, not string matching.
- Adding a Device is a plain INSERT; deleting one cascades to its Readings.
