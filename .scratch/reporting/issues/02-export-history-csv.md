# 02 — Export History to CSV

**What to build:**
A "Download CSV" on a Device's History page for a date range: one row per Reading (local time, UTC time, °F, °C, % humidity), so someone can chart it in Excel or attach it to a work order. Incidents for the same range as a second download.

**Blocked by:** none

**Status:** ready-for-agent

- [ ] `GET /api/devices/:id/readings.csv?from=YYYY-MM-DD&to=YYYY-MM-DD`, streamed (90 days of 30 s Readings is about 260,000 rows), range capped at retention; same auth as History
- [ ] `GET /api/incidents.csv` with the Incidents page's filters
- [ ] Filename names the Campus, Closet, and range; values unformatted (no `°`), a header row, CRLF line ends for Excel
- [ ] History and Incidents pages gain the button per DESIGN.md
- [ ] Tests: header and rows, range cap, a Device with no Readings, cell values that start with `=`, `+`, `-`, or `@` are escaped (Closet names are user-entered)

## Comments
