# Backend review — tickets 03, 04, 05, 06, 08, 09, 10, 11, 12, 15, 17

Reviewed 2026-10-04 on branch HamzaQaz/razorfish (head `254dba2`), working tree as found. Scope: `backend/` (src, test, scripts, Dockerfile, migrations), plus the parts of `DEPLOYMENT.md`, `compose.yaml` and `frontend/nginx.conf` that the backend tickets depend on. Two axes: **Standards** (CLAUDE.md, ADRs, surrounding idiom) and **Spec** (each ticket's checklist and comments).

Every finding below was confirmed in one of two ways. Some were reproduced against the running app and the test MySQL with a throwaway probe piped to node, which left no file behind. The rest were confirmed by reading the code path end to end; those are marked *(by reading)*.

## Check results

| Check | Result |
|---|---|
| `npm run test:db` | MySQL 8.4 on 127.0.0.1:3307 came up healthy. Nothing else held the port, so this worker started it and took it down. |
| `npm test` | **160 pass, 0 fail**, 36 suites, 26.3 s |
| `npm run typecheck` | clean, exit 0 |
| `npm run test:db:down` | container and network removed. The `uireview-*` stack belongs to another worker and was left running. |

## Findings, most severe first

### 1. Spoofed `X-Forwarded-For` bypasses the general `/api/` rate limit
- **Where:** `backend/src/app.ts:15` (`app.set('trust proxy', true)`), used by the limiter at `backend/src/app.ts:19-32`
- **Tickets:** 06 (the write limiter is kept), 17 (that ticket says "trust proxy stays as it was". The spoofing reasoning there covers Readings only, not the general limiter.)
- **Severity:** bug (security)
- **Failure scenario:** with `trust proxy` set to `true`, `req.ip` is the leftmost `X-Forwarded-For` entry. `frontend/nginx.conf` sets `X-Forwarded-For $proxy_add_x_forwarded_for`, which *appends* to whatever the client sent, so the client controls the leftmost entry. Reproduced: 520 `GET /api/campuses` from one address, each with a different first XFF entry, produced **0** 429s. The same 520 without the header produced 27. Anyone can make unlimited Admin-token guesses and unlimited requests against every `/api/` route. The same applies to the manual PM2 install behind nginx.
- **Smallest fix:** `app.set('trust proxy', 1)`. Both supported deploys have exactly one proxy hop (nginx). Add a test that sends a rotating XFF and expects a 429.

### 2. Two concurrent legacy-readings runs duplicate Readings
- **Where:** `backend/src/migrations/0003-legacy-readings.ts:43-48`: progress is read once, outside any transaction and without a lock. The function then advances a local `lastId` and writes it back unconditionally at `:83-86`.
- **Ticket:** 11 ("Running the migration twice does not duplicate Readings")
- **Severity:** bug (data integrity) *(by reading)*
- **Failure scenario:** on a production upgrade the API's first start walks every `ESP_` table inside `runMigrations`, which takes minutes on a large database. DEPLOYMENT.md:175 tells the operator to run `npm run migrate:legacy` (`docker compose exec api node dist/migrateLegacy.js`) to catch rows added since. If the operator runs it while that first walk is still going, both runners read `last_id = 0` (or the same value) for a table and both insert the same chunks. Every overlapping row ends up in `readings` twice, and the progress table can't detect it.
- **Smallest fix:** take a named lock around both entry points. In `runMigrations` and in `migrateLegacy.ts`, call `SELECT GET_LOCK('temperature_alarms_migrations', 600)` and refuse to proceed unless it returns 1, then `RELEASE_LOCK` in the `finally`. An alternative is to re-read `last_id` with `SELECT … FOR UPDATE` inside each chunk's transaction and continue from it.

### 3. Out-of-range temperature returns 500, and impossible humidity is stored
- **Where:** `backend/src/routes/readings.ts:32-44` (`isNumeric` only checks finiteness)
- **Ticket:** 06 ("422 on missing or non-numeric temp or humidity"; distinct statuses "so an installer can tell what went wrong")
- **Severity:** spec gap (validation)
- **Failure scenario:** reproduced. `{"device":"ESP_A1B2C3","temp":1e12,"humidity":40}` returns **500 Internal server error**, because MySQL rejects it with `ER_WARN_DATA_OUT_OF_RANGE` for `temp_f INT`. The installer gets the one status that tells them nothing. `{"temp":70,"humidity":250}` returns **201** and is stored. It then shows Mold risk high on the card and skews the History summary.
- **Smallest fix:** in `parseReading`, reject values outside sensible bounds with 422, for example `temp` between -40 and 200 °F and `humidity` between 0 and 100. Add those two rejections to the existing 422 test.

### 4. A `campusId` above `INT UNSIGNED` returns 500 on add and edit
- **Where:** `backend/src/deviceInput.ts:19-21` (`isCampusId` has no upper bound). Reached from `routes/devices.ts:50-56` (POST) and `:93-96` (PATCH).
- **Tickets:** 05 (validation), 15 ("validates as POST does … campus must exist")
- **Severity:** spec gap (validation)
- **Failure scenario:** reproduced. `POST /api/devices` with `campusId: 2**40` returns **500**, and so does `PATCH /api/devices/1` with the same value. Both should return the 422 "That campus does not exist".
- **Smallest fix:** `value <= 4_294_967_295` in `isCampusId`. Alternatively, map `ER_WARN_DATA_OUT_OF_RANGE` to the same 422 next to `isMissingForeignRow`.

### 5. The startup retention pass makes the deploy guide's legacy count check fail
- **Where:** `backend/src/index.ts:31` runs a retention pass immediately after `runMigrations`. DEPLOYMENT.md:177-184 says the copied count "should match the readings that carry a legacy timestamp".
- **Tickets:** 11 (deploy guide paragraph on verifying counts), 12
- **Severity:** spec gap (docs) *(by reading)*
- **Failure scenario:** a production database whose `ESP_` tables go back more than `RETENTION_DAYS`. The first start copies, say, 1,000,000 rows into `readings`, and seconds later the retention pass deletes every row older than 90 days. The operator runs the guide's query, sees `COUNT(*)` far below `legacy_readings_progress.copied`, and either distrusts a correct migration or drops the legacy tables believing nothing older was ever kept. Retention working is not a bug (ADR 0004). The problem is that the guide's check is wrong for any site with more than 90 days of history.
- **Smallest fix:** in DEPLOYMENT.md, bound the comparison by the retention window as well (`AND r.recorded_at >= <first start> - INTERVAL 90 DAY`, compared against the legacy rows in the same window). Or say plainly that older rows are copied and then removed by the first retention pass, so `copied` will exceed the count.

### 6. Oversized and other malformed bodies return 500
- **Where:** `backend/src/app.ts:50` only recognises `SyntaxError` with status 400.
- **Tickets:** 06 (distinct statuses), 03 (skeleton error handling)
- **Severity:** bug (low)
- **Failure scenario:** reproduced. A 200 KB JSON body to `POST /api/readings` returns **500** and logs `PayloadTooLargeError` as an unhandled error. Body-parser's 413 and 415 responses are lost the same way.
- **Smallest fix:** before the 500 fallback, honour body-parser's errors: `if (typeof err === 'object' && err && 'status' in err && 'expose' in err && err.expose) { res.status(err.status).json({ error: err.message }); return; }`.

### 7. `0001` and `0004` are not re-runnable after a partial failure
- **Where:** `backend/src/migrations/0001-initial-schema.ts:8,17,29` (bare `CREATE TABLE`), `0004-readings-recorded-at-index.ts:11` (bare `CREATE INDEX`), with recording at `migrations/index.ts:65-66`
- **Tickets:** 03 (versioned runner), 11 (re-runnable)
- **Severity:** standards (low) *(by reading)*
- **Failure scenario:** MySQL commits each DDL statement on its own. If the process dies or a statement fails after `campuses` is created but before `0001` is recorded, every later start fails with "Table 'campuses' already exists" and the backend never comes up without hand repair. `0004` behaves the same between `CREATE INDEX` and its `INSERT INTO schema_migrations`. On a large `readings` table that index build is the slowest DDL in the set, so a container stop during it is plausible.
- **Smallest fix:** `CREATE TABLE IF NOT EXISTS` in 0001. In 0004, guard with an `information_schema.statistics` check, the way `introspect.ts` already does for tables and columns.

### 8. History has no row limit
- **Where:** `backend/src/routes/readings.ts:251-257`
- **Ticket:** 10 (governed by ADR 0004: "History queries are always bounded by a date range and a row limit")
- **Severity:** spec gap (low) *(by reading)*
- **Failure scenario:** the day bound holds, but nothing caps the rows. The per-Device ingest limit allows 20 a minute, so one misbehaving board (or a mock device at 3 s) gives up to 28,800 Readings in a single response. That is ten times the 2,880 the History page was sized for.
- **Smallest fix:** add `LIMIT 30000` or similar to the query and return `truncated: true` when it is hit. Or record in ADR 0004 that the one-day bound is the limit.

## Per-ticket verdicts

| Ticket | Verdict |
|---|---|
| 03 Skeleton, config, schema, tests | Checklist met: modules with one job each, config read once with named errors, one pool pinned to UTC, versioned runner, ADR 0002 schema with unique keys, cascade and index, Compose test DB with `TEST_DATABASE_URL`, clean schema per test, health test, `.env.example` complete. Findings 6 and 7 only. |
| 04 Campuses + Admin token | **No findings.** `requireAdminToken` is the only token check. The compare uses `timingSafeEqual` behind a length check (standard; it reveals length only). 401, 404, 409 and 422 paths are all tested. |
| 05 Devices | Finding 4. Hostname regex, cascade and campus-in-use 409 verified. |
| 06 Reading ingest | Findings 1, 3 and 6. Token before limiter, hyphen normalisation, server UTC timestamp and integer storage all verified. `/api/write` is gone. |
| 08 Conditions | **No findings.** Pure module, thresholds in one object with config overrides and sanity checks, worst-first ordering, `online` derived from the Offline Condition. |
| 09 SSE | **No findings.** Shared CORS, no wildcard, 25 s heartbeat that runs only while clients exist, clients dropped on `close` (tested), `X-Accel-Buffering: no` plus nginx `proxy_buffering off`. No connection leak found. |
| 10 History by day | Finding 8. DST-correct day cut, oldest-first order, summary, and Admin-only reset scoped to one Device all verified. |
| 11 Legacy migration | Findings 2, 5 and 7. The table-name whitelist (`/^ESP_[0-9A-F]{6}$/i`) keeps the one interpolated identifier safe. Bad rows are logged and skipped, and legacy tables are left in place. |
| 12 Retention | Finding 5 (docs side). Batched `DELETE … LIMIT` over `ix_readings_recorded`, a 100 ms pause between batches, no overlapping passes, and a log line on every pass. Lock scope is short; new inserts land far above the cutoff's gap. |
| 15 Edit a Device | Finding 4. Hostname edits are refused with 422 and the explanatory message. A no-op edit returns 200 (verified; mysql2 sends `FOUND_ROWS`). Only constant column names enter the dynamic `SET`. |
| 17 Per-Device limit | Finding 1 is the remaining hole in "trust proxy stays as it was". The per-Device key, token-before-limit order, and the general-limiter skip are correct. The firmware and mock device post the exact `/api/readings` path that the skip matches. |

**SQL injection:** none found. Every value is parameterised. The only interpolations are constant fragments (`SELECT_DEVICES`, the dashboard `WHERE`, PATCH's `SET` list) and the whitelisted legacy table name.

## Fixed (2026-10-04, task_069023b1c0b2)

Test-first: the new and changed tests failed before the fixes (16 failures out of 171) and pass after. Final run under PowerShell: `npm test` **171 pass, 0 fail** (38 suites), and `npm run typecheck` and the build config `tsc -p tsconfig.json --noEmit` are both clean.

- **1. Fixed.** `src/app.ts` sets `trust proxy` to `1`, trusting nginx's hop only. New `test/rateLimit.test.ts`: 500 requests through the proxy with a rotating client-claimed XFF and a fixed proxy-seen address, then the 501st is 429 and a different proxy-seen address still gets through.
- **2. Fixed.** New `withMigrationLock` in `src/migrations/index.ts` takes a MySQL named lock, `GET_LOCK('temperature_alarms_migrations:<db>')`, which waits up to 600 s and then throws `MigrationLockError`. It wraps `runMigrations` and a new `runLegacyMigrations`, which `src/migrateLegacy.ts` now calls. Tests in `test/migrations.test.ts`: a second runner waits for the first and then runs, a second runner gives up after its wait, and the lock is released after a failing migration. Tests in `test/legacyMigration.test.ts`: two concurrent legacy runs copy each new row once, and a run by hand while the lock is held gives up and copies nothing.
- **3. Fixed.** `parseReading` returns 422 for `temp` outside -40..200 °F and `humidity` outside 0..100. Cases were added to the existing 422 test, plus a test that the edges are accepted.
- **4. Fixed.** `isCampusId` caps at 4,294,967,295 (INT UNSIGNED). `2 ** 32` and `2 ** 40` were added to the POST and PATCH unknown-campus 422 tests.
- **5. Not touched.** DEPLOYMENT.md belongs to another worker.
- **6. Fixed.** The error handler passes through any exposed 4xx http-error (body-parser's 413, 415 and others) with its own status and message. New readings test covers 413 for a 200 KB body and 415 for an unsupported charset.
- **7. Fixed.** 0001 uses `CREATE TABLE IF NOT EXISTS`. 0004 skips when `ix_readings_recorded` exists, using a new `indexExists` in `introspect.ts`. New test deletes the 0001 and 0004 records and re-runs cleanly.
- **8. Fixed.** History returns at most `HISTORY_ROW_LIMIT` (30,000, which is a 25-hour day at the ingest limit) Readings, oldest first, plus an additive `truncated: boolean`. The summary covers the Readings sent. Tests cover a day of 30,001 Readings and a day under the limit. Frontend: `frontend/src/types.ts` and `pages/History.tsx` don't read `truncated`, so nothing breaks, but the page shows no sign a day was cut short. The History page should add a note when `truncated` is true (frontend owner's call).

## Fixed (finding 5, docs; 2026-10-04, task_9359923275e3)

- **5. Fixed.** DEPLOYMENT.md's verification under "Upgrading a database from the old per-Device tables" now says the startup retention pass deletes copied Readings older than `RETENTION_DAYS` seconds after the copy, so `copied` exceeding a Device's `readings` count is expected. The count check is now taken inside the retention window: Readings from a `CUTOFF_DAY` (first start minus 89 days) up to `FIRST_START`, against legacy rows dated from `CUTOFF_DAY` (`STR_TO_DATE(DATE, '%m/%d/%Y')`, both writers' format). The tolerance is the window's skips and one hour at the cutoff from the fixed `-06:00` offset, and the doc says when to drop the `FIRST_START` bound. The SQL was written against `legacyTimestamp.ts`'s formats and not run against a legacy dump.
