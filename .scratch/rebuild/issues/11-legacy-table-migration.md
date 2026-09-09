# 11 — Legacy table migration

**What to build:**
An operator upgrading a production database runs the migration and every Reading from the old per-Device tables lands in `readings` with a correct timestamp, without touching the old tables. Running it again changes nothing. Per ADR 0002.

**Blocked by:** 03 — Backend skeleton, config, schema, and test harness

**Status:** done

- [x] A migration discovers every table matching the `ESP_` hostname pattern and, for each row, resolves the Device by hostname, parses the string DATE and TIME columns, and inserts into `readings`
- [x] Rows whose date or time cannot be parsed are logged with table and id and skipped; the migration never aborts on one bad row
- [x] A legacy table whose hostname has no Device row is logged and skipped
- [x] Running the migration twice does not duplicate Readings
- [x] Legacy tables are left in place; the deploy guide gains a paragraph on verifying counts and dropping them by hand
- [x] A test builds two legacy tables from fixtures in the old formats, including at least one unparseable row, and asserts counts, timestamps, idempotence, and that the legacy tables still exist

## Comments

**2026-09-04, from the ticket 03 code review.** Migration `0001-initial-schema` runs a bare `CREATE TABLE devices` and `CREATE TABLE campuses`. A production database already has the PHP-era `devices` (Name, Campus, Location) and `locations` (NAME, SHORTCODE) tables, so the first migration will fail there as written, and this ticket assumes new-shape `devices` rows already exist when it resolves a Device by hostname. No ticket currently converts legacy `devices`/`locations` into the new shape. Decide before starting this ticket: either a preceding migration renames the legacy tables aside (e.g. `legacy_devices`, `legacy_locations`) and copies their rows into `campuses`/`devices`, or the deploy guide has the operator do that by hand. ADR 0002 calls `campuses` "the table formerly called `locations`", so the copy is the intended reading.

**2026-09-09, implementation.** Took the copy reading. `0000-legacy-tables-aside` renames the PHP-era `devices` and `locations` to `legacy_devices` and `legacy_locations` when it finds them in the old shape (a `devices` table with no `hostname` column), so `0001-initial-schema` can create the new tables on a production database. `0002-legacy-campuses-and-devices` copies them into `campuses` and `devices` through the same `parseCampus` and `parseDevice` rules the API uses; the old free-text `Campus` column is matched against a shortcode first and a name second. `0003-legacy-readings` walks every `ESP_xxxxxx` table in 5000-row chunks, each chunk and its bookkeeping in one transaction, with per-table progress in `legacy_readings_progress` so a re-run copies only rows added since. The timestamp parser (`migrations/legacyTimestamp.ts`) reads the PHP `m/d/Y` + `g:i:s A` strings and the Node-era en-US `toLocaleDateString`/`toLocaleTimeString` strings, including the narrow no-break space Node 20 puts before AM/PM, plus ISO dates and 24-hour times; day-first dates are rejected rather than guessed. The zone comes from a new optional `LEGACY_TIME_ZONE` (default: the server's zone), because the PHP writer pinned America/Chicago while the Node writer used the server's zone, and a UTC server would otherwise read PHP-era rows six hours off. Migrations now receive a `MigrationContext` (zone plus a log sink) so the test asserts on the log lines. `DEPLOYMENT.md` gained the upgrade section with the count and timestamp checks to run before dropping the legacy tables by hand.

Code review (standards and spec, same day) raised one real gap: the runner records each migration once, so a restart does not re-walk the legacy tables. Added `npm run migrate:legacy` (`src/migrateLegacy.ts`) to run the two guarded migrations by hand, and reworded the guide. Also from review: `parseCampus`/`parseDevice` moved out of the route modules into `campusInput.ts`/`deviceInput.ts` so migrations do not import Express routes; `isCalendarDay` shared between `localDay` and the legacy parser; `runMigrations(pool, { context, list })`; ADR 0002 now records the one whitelisted identifier. Left as is: ISO dates and 24-hour times stay accepted because they are unambiguous and cost nothing, while day-first slash dates remain rejected; production formats could not be sampled from here, which is why the guide's timestamp spot-check exists.
