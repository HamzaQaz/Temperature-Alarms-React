# 03 — Backend skeleton, config, schema, and test harness

**What to build:**
The backend starts as a set of small modules against the new three-table schema, refuses to start when misconfigured, and has a test harness that runs HTTP tests against a real MySQL. `npm test` in the backend is green with the health endpoint as the first test. Existing routes may be temporarily removed; they return in later tickets.

**Blocked by:** 01 — Repo housekeeping

**Status:** ready-for-agent

- [ ] Backend is split into modules with one job each: config, database, migrations, routes per resource, conditions, sse, retention, auth (routes may be empty stubs for now)
- [ ] Startup reads config once and exits with a clear message if database password, Admin token, or Device token is missing
- [ ] A connection pool replaces per-request connections
- [ ] A versioned migration runner applies migrations on startup and records which have run
- [ ] The first migration creates `campuses`, `devices`, and `readings` per ADR 0002, with a unique shortcode, a unique hostname, cascade delete from devices to readings, and an index on device and recorded time
- [ ] Timestamps are stored in UTC
- [ ] A Docker Compose file provisions a throwaway MySQL for tests, and `TEST_DATABASE_URL` overrides it
- [ ] Each test starts from a clean schema via the migration runner
- [ ] The health endpoint has a passing HTTP test that checks database connectivity
- [ ] The backend `.env.example` documents every variable including both tokens
