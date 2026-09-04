# 10 — History by day

**What to build:**
From a card, a technician opens one day of a Device's history as a chart of temperature and humidity and a table, steps to the previous or next day, sees the day's min, max, and average, and watches it refresh live. An admin can reset the Device's history behind a confirmation. This is the `/impeccable` pass on History.

**Blocked by:** 09 — Live updates over SSE

**Status:** ready-for-agent

- [ ] `GET /api/devices/:id/history?date=YYYY-MM-DD` returns that local day's Readings oldest first plus min, max, and average for temperature and humidity, and never more than one day
- [ ] `DELETE /api/devices/:id/history` requires the Admin token and deletes only that Device's Readings
- [ ] The History page takes a device id and a date from the URL, defaults to today, and offers previous and next day
- [ ] The chart shows both temperature and humidity; the table shows time in 12-hour format with correct AM and PM
- [ ] Live refresh listens on the SSE stream and reloads the day when a Reading for this Device arrives, debounced
- [ ] Reset is behind a confirmation and shows the token prompt on 401
- [ ] The History page has had an `/impeccable` pass
- [ ] HTTP tests cover day bounds at midnight, the summary numbers, an empty day, and the reset
