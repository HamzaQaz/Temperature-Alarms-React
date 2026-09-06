# 07 — Dashboard from the readings table

**What to build:**
The dashboard shows every Device with its latest Reading, whether it is Online, its Campus and Closet, and an IDF or MDF tag, filtered by Campus from the URL. The countdown matches the real Report interval and the summary averages ignore Devices with no Reading. This is the `/impeccable` pass on the Dashboard.

**Blocked by:** 06 — Reading ingest with the Device token

**Status:** done

- [x] `GET /api/dashboard?campus=SHORTCODE` returns one entry per Device with hostname, campus, closet, closetType, latest reading or null, online, and secondsSinceReading, in one query
- [x] Campus filter is case-insensitive as before, and an unknown campus returns an empty list
- [x] The response includes the configured Report interval so the UI never hardcodes it
- [x] Online means the last Reading arrived within three Report intervals, computed on the server
- [x] The old `/api/temperature/*` and `/api/history` routes are removed
- [x] Cards show Online or Offline, time since last Reading, and the IDF or MDF tag; the countdown is seeded from the interval in the response
- [x] Summary tiles show total Devices, average temperature, and average humidity, ignoring Devices with no Reading
- [x] The Dashboard has had an `/impeccable` pass, including the wall-screen reading distance
- [x] HTTP tests cover the payload shape, the filter, online versus offline at the boundary, and a Device with no Readings
