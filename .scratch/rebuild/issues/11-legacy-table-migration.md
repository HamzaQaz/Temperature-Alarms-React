# 11 — Legacy table migration

**What to build:**
An operator upgrading a production database runs the migration and every Reading from the old per-Device tables lands in `readings` with a correct timestamp, without touching the old tables. Running it again changes nothing. Per ADR 0002.

**Blocked by:** 03 — Backend skeleton, config, schema, and test harness

**Status:** ready-for-agent

- [ ] A migration discovers every table matching the `ESP_` hostname pattern and, for each row, resolves the Device by hostname, parses the string DATE and TIME columns, and inserts into `readings`
- [ ] Rows whose date or time cannot be parsed are logged with table and id and skipped; the migration never aborts on one bad row
- [ ] A legacy table whose hostname has no Device row is logged and skipped
- [ ] Running the migration twice does not duplicate Readings
- [ ] Legacy tables are left in place; the deploy guide gains a paragraph on verifying counts and dropping them by hand
- [ ] A test builds two legacy tables from fixtures in the old formats, including at least one unparseable row, and asserts counts, timestamps, idempotence, and that the legacy tables still exist
