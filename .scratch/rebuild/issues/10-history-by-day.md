# 10 — History by day

**What to build:**
From a card, a technician opens one day of a Device's history as a chart of temperature and humidity and a table, steps to the previous or next day, sees the day's min, max, and average, and watches it refresh live. An admin can reset the Device's history behind a confirmation. This is the `/impeccable` pass on History.

**Blocked by:** 09 — Live updates over SSE

**Status:** done

- [x] `GET /api/devices/:id/history?date=YYYY-MM-DD` returns that local day's Readings oldest first plus min, max, and average for temperature and humidity, and never more than one day
- [x] `DELETE /api/devices/:id/history` requires the Admin token and deletes only that Device's Readings
- [x] The History page takes a device id and a date from the URL, defaults to today, and offers previous and next day
- [x] The chart shows both temperature and humidity; the table shows time in 12-hour format with correct AM and PM
- [x] Live refresh listens on the SSE stream and reloads the day when a Reading for this Device arrives, debounced
- [x] Reset is behind a confirmation and shows the token prompt on 401
- [x] The History page has had an `/impeccable` pass
- [x] HTTP tests cover day bounds at midnight, the summary numbers, an empty day, and the reset

## Comments

**2026-09-07, on completion.** Decisions that go a step beyond the checklist, each easy to change if unwanted:

- **Whose "local day"?** The browser's. `GET /api/devices/:id/history` takes an optional `tz` (an IANA name) beside `date`; the page sends `Intl.DateTimeFormat().resolvedOptions().timeZone`. Without `tz` the server uses its own zone, so the spec's URL still works. The day is cut by `backend/src/localDay.ts`, which is unit-tested across both clock changes (a 23-hour and a 25-hour day). `date` defaults to today in that zone.
- **The response carries the Device** (id, hostname, closet, closetType, campus) and the day's bounds as `from`/`to` instants, so the page needs one request and can draw the axis midnight to midnight. Averages are to one decimal; a day with no humidity gives `humidity: null` rather than a summary of nothing.
- **Route is `/history/:deviceId?date=YYYY-MM-DD`** (the card links by id, not hostname). Today is the bare URL. `/history` with no Device shows a pointer back to the dashboard.
- **Live refresh** reloads the day 2 s after the last matching Reading (a burst costs one request), only when the Reading's instant falls inside the day on screen: a past day never reloads, and other Devices are ignored. Verified in a browser with Playwright. The Live indicator is shown for today only, since a past day cannot change.
- **The table** is newest first, 100 rows a page, in a bounded scroll box with a sticky header, so a full day of 2,880 rows neither stretches the page nor weighs on the DOM.
- **Shared pieces moved:** the dashboard's `Tile` is now `frontend/src/components/Tile.tsx`, and `AdminTokenPanel` moved out of `components/settings/` with an `action` sentence so History can say what needs the token.
- **Shown beyond the spec's list** (chart, table, min/max/avg), each a presentation call flagged for a decision: a Readings-count tile with the day's first and last time; seconds in the table's times (two Readings a minute must tell apart); a native date field and a Today button beside previous/next; the IDF/MDF tag in the heading, as on the card. The old page's Trend tile is gone: the spec lists min, max, and average only.
- Reset without a stored token shows the "Admin token needed" panel; a stored token the server refuses shows "Not authorised" and is forgotten, as on Settings.

No PRODUCT.md exists for `/impeccable`; the pass used the Dashboard and Settings pages as the design system. `/impeccable init` would capture that for future passes.
