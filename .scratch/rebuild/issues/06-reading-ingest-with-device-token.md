# 06 — Reading ingest with the Device token

**What to build:**
A Device posts a Reading and it is stored against the right Device with a server-side timestamp. Posting with a bad token, an unknown hostname, or non-numeric values is rejected with a distinct status so an installer can tell what went wrong. Verifiable with a single curl.

**Blocked by:** 05 — Devices end to end

**Status:** ready-for-agent

- [ ] `POST /api/readings` accepts `{device, temp, humidity}` with the Device token as a bearer token and returns 201
- [ ] 401 on missing or wrong Device token, 404 on unknown hostname, 422 on missing or non-numeric temp or humidity
- [ ] Temperature and humidity are stored as integers; the timestamp is set by the server in UTC
- [ ] Hyphens in a posted hostname are normalised to underscores as the old code did, so existing boards still match
- [ ] The old `/api/write` route is removed
- [ ] The write rate limiter is kept and applies only to this route
- [ ] HTTP tests cover the success path and each rejection
