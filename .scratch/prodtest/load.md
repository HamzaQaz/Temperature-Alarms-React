# Load test: production stack (compose.yaml) under district load, 3× and 5× headroom, 90 days of data

Agent: load. Stack: `compose.yaml` as shipped, project `ta-load`, port 8095, scratch env file outside the repo (deleted after). Host: Docker Desktop on Windows 11 (WSL2 VM, 12 CPUs, 5.8 GB, shared with four other agents' stacks). Scripts: `.scratch/prodtest/load/`. Raw results: `.scratch/prodtest/runs/` (`load-*.json`, `bigdata-*.json`, `*.log`). No product code was changed. The stack is down (`down -v`; 0 containers, 0 volumes left).

## Pass/fail

| # | Check | Result | Evidence |
|---|---|---|---|
| 2 | Baseline 100 Devices / 30 streams / 15 min: no errors, no 429 | **PASS** | 2,996 posts, all 201; 89,880 deliveries, 100% delivered |
| 2 | Baseline ingest p99 under 1 s | **FAIL (host disk, not the app)** | p99 1,495 ms. Every slow request is `COMMIT` fsync on the shared Docker Desktop disk (avg 49 ms, max 1.55 s); quiet minutes are 31 ms. See N1 |
| 2 | API p95s at baseline | **PASS** | dashboard 28 ms, overview 26 ms, incidents 7 d 22 ms, History day 19 ms |
| 3 | Headroom 300 Devices / 60 streams / 10 min | **PASS** (apart from S3) | 5,859/5,859 posts from the other 292 Devices returned 201. The 141 429s all came from 8 Devices locked out by the clock step (S3) |
| 3 | Breaking point under 1,000 Devices | **None found up to 1,500** | 500 / 700 / 1,000 / 1,500 Devices with 60 streams: 0 errors, 0 429s, 100% delivered, ingest p99 98 / 274 / 329 / 107 ms |
| 4 | Load 90 days, 100 Devices (26.2 M rows) in minutes | **PASS** | 26,219,291 rows in 194 s (135 k rows/s) |
| 4 | /api/dashboard, incidents 7 d, History day on 90 days | **PASS** | p50 15 / 30 / 16 ms; cold DB 38 / 55 / 31 ms |
| 4 | Overview (Campuses page) on 90 days | **FAIL: blocker B1** | as shipped (128 MB pool): cold 28 s, cold cache 22 s, **cached 8.7 s**; 4 open Campuses pages pushed ingest p99 to **26.8 s** |
| 4 | Retention pass and its effect on ingest | **PASS** | 288,412 Readings in 8.2 s; ingest p99 37 → 117 → 35 ms (before / during / after), 0 errors |
| 4 | Offline sweep, 100 Devices | **PASS** | pass opening 100 incidents: 658 ms; steady-state pass: 0–1 ms |
| 4 | Backup via `deploy.sh backup -p ta-load` | **PASS** | 31.4 s, 145 MB gzipped (1.07 GB of SQL) |
| 4 | Restore via `deploy.sh restore -p ta-load` | **PASS** (note N4) | import 4 m 23 s; api down 4 m 31 s; 6 m 05 s end to end; all 25,626,144 rows back |
| 5 | Per-Device limit behind one IP (NAT), 100 Devices | **PASS** | 2,797 posts from one address, 0 429s |
| 5 | Browsers behind one IP | **FAIL: should-fix S1** | 8 Campuses pages behind one address used up the 500/15 min allowance in about 9 minutes; 220 of 680 overview reloads got 429 |

## Measured tables

### Baseline: 100 Devices, 30 streams, 15 minutes (`load-baseline-*.json`)

| Metric | Value |
|---|---|
| Posts / statuses | 2,996, all 201; 0 errors, 0 429s |
| Ingest latency (POST to 201) | p50 23.6, p95 433, p99 1,495, max 5,126 ms |
| SSE fan-out (POST sent to arrival on each stream) | p50 24.9, p95 434, p99 1,495 ms; 89,880 deliveries, 100% |
| Fan-out cost beyond ingest | ~1–2 ms at every size tested |
| Devices in a Condition | 5.5% on average (simulator target 5%) |
| /api/dashboard | p50 21, p95 28, p99 34 ms (27 KB) |
| /api/campuses/overview | p50 16, p95 26, p99 68 ms |
| /api/incidents (7 days) | p50 15, p95 22, p99 35 ms (77 KB) |
| History, one day | p50 12, p95 19, p99 24 ms |
| CPU p95 / memory max | api 15% / 125 MiB; db 7% / 467 MiB; web 3% / 18 MiB |
| Per-address budget left at the end | 324 of 500 (poller every 12 s plus 30 stream opens) |

Ingest p99 by minute ranged from 31 ms to 4.2 s. It tracked the shared disk, not load (N1).

### DB growth extrapolated to 90 days of retention

| Item | Per hour (100 Devices) | 90 days |
|---|---|---|
| Readings | 11,709 measured (12,000 expected) | 25.9 M rows |
| readings.ibd | at 117 bytes per row (2,860 MB for 25.6 M rows measured) | **~3.0 GB at 100 Devices, ~9 GB at 300** |
| Binlog (enabled by default, kept 30 days) | 4.3 MB | **~3.1 GB** kept, more after a restore (S2) |
| Backup (gzipped) | | 145 MB |

### Headroom and ramp (60 streams; `load-headroom-*.json` for 300, `load-ramp-*.json` for the rest)

| Devices | Posts | Errors / 429s | Ingest p50 / p95 / p99 (ms) | Fan-out p99 (ms) | api CPU p95 / mem | db CPU p95 / mem | web CPU p95 |
|---|---|---|---|---|---|---|---|
| 300 (10 min) | 6,000 | 0 / 141 (S3 only) | 22 / 241 / 1,622 | 1,623 | 23% / 150 MiB | 10% / 471 MiB | 6% |
| 500 (3 min) | 3,004 | 0 / 0 | 22 / 35 / 98 | 101 | 52% / 80 MiB | 13% / 469 MiB | 36% |
| 700 (3 min) | 3,394 | 0 / 0 | 22 / 36 / 274 | 275 | 28% / 84 MiB | 12% / 471 MiB | 17% |
| 1,000 (4 min) | 6,838 | 0 / 0 | 21 / 40 / 329 | 331 | 22% / 88 MiB | 16% / 474 MiB | 15% |
| 1,500 (3 min) | 7,275 | 0 / 0 | 20 / 32 / 107 | 109 | 48% / 89 MiB | 19% / 476 MiB | 34% |

API p95 during the ramp (500–1,500 Devices): dashboard 95 ms (408 KB at 1,500 Devices), overview 88 ms, incidents 49 ms, History 25 ms.

**Breaking point:** none up to 1,500 Devices, 5× the district's 300-Device headroom target. Ingest p99 never stayed above 1 s for longer than a disk stall, and nothing errored. The ceiling is the db's fsync rate and, past 90 days of data, the overview (B1), not ingest or fan-out.

Discarded windows: the first 500/700/1,000 attempt (17:11–17:22) was discarded. My own 500-post probe (`probe429.mjs`) polluted its fan-out timings, and the Docker Desktop VM restart at 17:15:33Z killed every container, then left the host port forward for 8095 dead until `web` was recreated. That window was rerun from 17:22 with a fresh stack and appears above.

### Big data: 91 days × 100 Devices (26,219,291 Readings, 3,552 incidents)

Loaded straight into MySQL with `INSERT … SELECT`, one day of 288 k rows per statement in time order, in 194 s. The loader's session skipped the binlog. Measured under the shipped MySQL default (128 MB buffer pool) and under the coordinator's 1 GB cap. Each "cold DB" figure follows a restart of db and api.

| Request | 128 MB pool (as shipped) | 1 GB pool |
|---|---|---|
| /api/dashboard: cold DB / p50 / p95 | 38 / 15 / 51 ms | 20 / 15 / 20 ms |
| /api/campuses/overview: cold DB | **28.0 s** | **10.2 s** |
| overview: cold cache, warm DB | **21.9 s** | **5.5 s** |
| overview: cached (5-min cache warm), p50 / max | **8.7 s / 8.9 s** | **2.5 s / 3.2 s** |
| /api/incidents 7 days: cold / p50 / p95 | 55 / 30 / 44 ms (318 KB) | 60 / 27 / 32 ms |
| History, one full day (2,880 rows): cold / p50 / p95 | 31 / 16 / 102 ms (193 KB) | 28 / 17 / 34 ms |
| Retention pass, one day (288 k Readings) | 8.2 s under live ingest | 10.7 s for 304 k plus 33 incidents (api start, no ingest) |
| Ingest p99 before / during / after the pass | 37 / 117 / 35 ms, 0 errors | |
| Offline sweep, 100 Devices: opening pass / steady pass | 658 ms / 0–1 ms | |
| 4 Campuses pages + 100 Devices (4 min) | **ingest p99 26.8 s**, mean 5.3 s; each overview 11–58 s; db 2–5 cores busy | |
| Backup (`deploy.sh backup -p ta-load`) | 31.4 s, 145 MB gzipped | |
| Restore (`deploy.sh restore -p ta-load`) | import 4 m 23 s; api down 4 m 31 s; 6 m 05 s total | |

## Findings, by production impact

### B1. Blocker: the Campuses overview reads the whole readings index, so at 90 days it takes 9–28 s and starves ingest

**Cause (EXPLAIN ANALYZE, `bigdata-measure-*.json`).** `selectDayMaxima` in `backend/src/routes/campusOverview.ts` joins `devices d JOIN readings r FORCE INDEX (ix_readings_device_recorded) ON r.device_id = d.id AND r.recorded_at >= ? AND r.recorded_at < ?`. MySQL runs it as `Index lookup on r using ix_readings_device_recorded (device_id=d.id), with index condition: (recorded_at …)`, a `ref` on `device_id` with index-condition pushdown on `recorded_at`. It does not range-scan on `(device_id, recorded_at)`. Every Device's full 90 days of index entries are read (26 M entries) to keep 7 days (2 M). Each kept row then needs a primary-key lookup for `temp_f`. The 7 completed days are cached for 5 minutes, but **today's statement is never cached and scans the same 26 M entries**, so the cached overview still costs 8.7 s at 128 MB and 2.5 s at 1 GB. The overview's `Promise.all` takes up to 6 of the api pool's 10 connections. Every Campuses page reloads the overview every 10 s while its stream is busy, so a few open pages hold the pool, and ingest waits behind them: 26.8 s p99 with 4 pages open.

It grows with retained data: harmless in week one (26 ms at baseline), a blocker by month three.

**Timings of the rewrites** (1 GB pool, 26 M rows, run directly in mysql):

| Statement | 7 completed days | today (13 h) |
|---|---|---|
| Current: join with FORCE INDEX | 5.59 s | 2.57 s |
| No join, `device_id IN (…)` list, current index | 3.54 s | ~0.19 s |
| Join plus a covering index `(device_id, recorded_at, temp_f)` | 4.45 s (still `ref`) | |
| **No join, `device_id IN (…)`, covering index** | **0.75 s** | **0.03 s** |

**Recommended fix (security agent owns backend/src; test-first).**

1. In `selectDayMaxima`, drop the join and range-scan per Device on an explicit id list. The overview has the Devices already (its `SELECT_DEVICES` query), so query them first, or run `SELECT id FROM devices` first, and skip the statement when the list is empty:
   ```sql
   SELECT r.device_id AS deviceId, ${day} AS day, MAX(r.temp_f) AS maxTempF
   FROM readings r FORCE INDEX (ix_readings_device_recorded)
   WHERE r.device_id IN (?) AND r.recorded_at >= ? AND r.recorded_at < ?
   GROUP BY r.device_id, day
   ```
   with params `[deviceIds, ...dayBounds, from, to]`.
2. Add migration `0006-readings-covering-index`, guarded like 0004, that makes the index covering:
   `ALTER TABLE readings ADD INDEX ix_readings_device_recorded_temp (device_id, recorded_at, temp_f), DROP INDEX ix_readings_device_recorded, ALGORITHM=INPLACE, LOCK=NONE`.
   Point the `FORCE INDEX` and the comments at the new name. The prefix is unchanged, so the dashboard's latest-Reading subquery, ingest's previous-Reading query, History and the FK all keep their plans. The build took 32 s, online, on 26 M rows, and adds about 4 bytes per entry.
3. Coalesce concurrent misses. When the 5-minute cache expires, every open Campuses page runs the 7-day statement at once. Keep one in-flight promise per cache key in `pastDayMaxima`, so concurrent requests share it.
4. Test: on the test DB, seed two Devices with 30 days of Readings each, then assert that `EXPLAIN FORMAT=JSON` of both statements shows `access_type: "range"` and `using_index: true` on `readings`. This fails today: the plan is `ref` without a covering index.

Reproduce: `node bigdata.mjs load`, then `node bigdata.mjs measure --tag x` (overview timings and EXPLAIN), then `node run.mjs --label tabs --devices 100 --streams 3 --campus-tabs 4 --minutes 4 --no-poll` (ingest starvation).

### S1. Should-fix: one allowance of 500 requests per 15 min per address covers every GET, stream open and health check, so 8 Campuses pages behind one address lock out every browser there

`app.ts` puts the 500 per 15 minutes limit on all of `/api/` except POST `/readings`. Each Campuses page reloads the overview up to 6 times a minute (`REFRESH_EVERY_MS = 10_000` in `frontend/src/pages/Campuses.tsx`), so 8 pages behind one address (an office NAT, a VPN, or every browser behind the TLS proxy until `TRUST_PROXY` is set) use up the allowance in about 9 minutes. Measured: 220 of 680 reloads got 429, starting 9 minutes in (`load-nat-*.json`). After that, every browser at that address is refused for the rest of the window: stream reconnects, Dashboard reloads, and `/api/health` too (it returned 429 to `curl` during this test). `useResource` turns a failed reload into the page's error state, so a wall screen loses its data instead of keeping it, and the stream's reopen loop keeps spending requests.

Fix (backend: security agent; frontend: accessibility agent):
- `app.ts`: keep the 500/15 min limiter for writes only, adding `|| req.method === 'GET'` to its `skip`. Mount a separate, generous read limiter on `/api/` for GETs, e.g. `rateLimit({ windowMs: 15 * 60_000, max: 5000, skip: (req) => req.method !== 'GET' || req.path === '/health' })`. Test: 600 GETs to `/api/dashboard` from one address return 200, and 501 POSTs to `/api/campuses` from one address get 429.
- Frontend: when a reload fails and data is already showing, keep the data and show it as stale rather than switching to the error state (`useResource`'s catch). Consider a 30 s `REFRESH_EVERY_MS` on Campuses: the page is a summary, and the stream already carries the live Readings.

### S2. Should-fix: compose.yaml runs MySQL's defaults: a binlog nobody reads (two fsyncs per Reading, gigabytes on disk) and a 128 MB buffer pool

- **Binlog.** `log_bin=ON`, `sync_binlog=1`, `binlog_expire_logs_seconds=2592000` (30 days). There's no replica, and backups are `mysqldump`, so nothing reads it. Measured: 4.3 MB/h at 100 Devices, so ~3.1 GB kept at steady state. One restore wrote the whole dump into it (672 MB of binlog after a single restore), and each daily retention pass writes its deletes too. A/B with 100 Devices: `COMMIT` averaged 3.75 ms with the binlog and 1.72 ms without (`load-ab-*.json`), because each commit fsyncs twice.
- **Buffer pool.** 128 MB holds a fraction of the week the overview reads. At 90 days the overview was 3.5× slower than with 1 GB (cached 8.7 s vs 2.5 s). After B1 the working set is the covering index for 7 days (~100 MB at 100 Devices) plus the latest pages, so 512 MB covers 100 Devices with room to spare.
- **Fix (CT agent owns compose.yaml).** Add to the `db` service:
  `command: ["--disable-log-bin", "--innodb-buffer-pool-size=512M"]`
  Use 1G if the LXC has 4 GB or more. Mention both in DEPLOYMENT.md's sizing notes: disk use ~3 GB per 100 Devices at 90 days, plus backups at 145 MB each.

### S3. Should-fix: a server clock step freezes Devices for the length of the step: cards stuck "online", Offline never raised, and Readings refused

Observed: the Docker Desktop VM's clock jumped **+5 h (exactly 18,000 s) at 16:52:12Z for about 12 s**, then stepped back (`systemd-journald: Time jumped backwards` in the VM's dmesg). Every Reading ingested in those seconds was stamped 5 h ahead.
- **45 Devices' cards froze.** `/api/dashboard` showed each one's latest Reading at 21:52Z with `secondsSinceReading: 0, online: true`. Their real Readings sorted behind it, so the card stopped updating, and the Offline sweep could not see them go silent. That would have lasted 5 hours.
- **8 Devices were locked out by the per-Device limiter.** express-rate-limit's MemoryStore gives each key a reset time of `Date.now() + windowMs`. Keys created during the jump got reset times 5 h ahead, so those Devices received 429 on every post (`RateLimit-Reset: 16858` on a 60 s window) for the rest of the run: 16 refusals a minute, 141 in the 300-Device step. The general limiter showed the same skew (`RateLimit-Reset: 17718` on a 900 s window).

A Proxmox LXC shares the host's clock, so this happens only if the host steps its clock (an NTP step after drift or a resumed VM). The effect is silent and lasts as long as the step.

Fix:
- Deployment (CT agent, DEPLOYMENT.md): run chrony on the Proxmox host with `makestep 1 3`, so the clock is only stepped at boot and slews afterwards.
- Backend (security agent), test-first:
  - In the latest-Reading subqueries (`SELECT_DASHBOARD` in routes/readings.ts, `SELECT_DEVICES` in campusOverview.ts, `LATEST_READING` in incidentStore.ts) and in `recordReadingIncidents`' previous-Reading query, add `AND r2.recorded_at <= UTC_TIMESTAMP() + INTERVAL 5 MINUTE`. The index walk stays bounded. A test inserts a Reading 1 h in the future and checks that the dashboard shows the newest Reading not in the future, and that the sweep opens Offline when that one goes stale.
  - For the limiter, pass `writeLimiter` a small custom store whose windows are measured with `performance.now()` (monotonic) instead of `Date.now()`.

### Notes

- **N1. Ingest latency on this host is fsync, not the app.** 98% of ingest time sits in `COMMIT` (`performance_schema`: avg 49 ms, max 1.55 s in the smoke run). Four other agents' MySQL instances were writing to the same Docker Desktop disk, so per-minute p99 swung from 31 ms to 4.2 s at the same load. In quiet minutes ingest is 22 ms p50 and 30 ms p99 at every fleet size up to 1,500. Most of that is HTTP through Docker Desktop's port proxy: the SQL itself is under 5 ms. Before go-live, rerun `run.mjs --devices 100 --streams 30 --minutes 15` on the LXC to get the real number.
- **N2. Fan-out is cheap.** SSE delivery adds 1–2 ms over ingest at 60 streams × 1,500 Devices (3,000 messages/s), with 100% delivered and api CPU p95 at 48%. `broadcast` ignores `res.write` backpressure; a stalled client would buffer in memory. No issue at this scale.
- **N3. Payload sizes.** Dashboard: 27 KB at 100 Devices, 408 KB at 1,500. Incidents (7 days): 318 KB at about one incident per Device every 3 days. Both are gzipped by nginx and fine here.
- **N4. Restore takes the api down about 4.5 minutes at 90 days.** Readings posted in that window are refused. Budget for it in the runbook. `deploy.sh` reads `WEB_PORT` only from `.env`, so with `-p` and an env file kept elsewhere, its closing health check probed port 80 and reported `[FAIL]` after the restore had succeeded. That only matters for setups like this test's (CT agent: consider honouring an exported `WEB_PORT`).
- **N5. Recovery after the VM crash was clean.** db and api came back on `restart: unless-stopped`; api crash-looped on `ECONNREFUSED` for 4 s until db answered, then served. Docker Desktop also lost the host port forward for 8095 until `web` was recreated. That is a Desktop quirk and does not apply to an LXC.
- **N6. Retention and the sweep are fine at 90 days.** A daily pass of 288 k rows takes 8–11 s in 5,000-row batches. The retention DELETE uses `ix_readings_recorded` (`EXPLAIN`: range) and only moved ingest p99 to 117 ms. The sweep is index lookups (`uq_incidents_open` antijoin, then one latest-Reading step per Device).

## Fixes made and tests

None. Product code was out of scope for this agent. Every fix above is written out for the owning agent, with the test that should fail first: B1 (an EXPLAIN plan test), S1 (limiter split), S3 (a future-dated Reading). The existing suites were not touched.

## Scripts (`.scratch/prodtest/load/`, Node 20+, no dependencies)

| File | What it does |
|---|---|
| `lib.mjs` | options, env file, percentiles, `docker stats` sampler (10 s), mysql/node exec into the stack |
| `devices.mjs` | registers N Devices (admin API, or SQL beyond the per-address budget); posts every 30 s ± 2 s with drifting values; ~5% of boards in Hot, Hot critical, Cold or Dry excursions |
| `browsers.mjs` | M SSE streams timing POST to arrival per stream; `campusTabs` emulates Campuses pages (overview reload throttled to 10 s) |
| `poller.mjs` | dashboard, overview, incidents 7 d, History day: p50/p95/p99 and RateLimit-Remaining |
| `run.mjs` | one run: Devices + streams + poller + docker stats, fixed or ramped (`--ramp 700:3,1000:4`) |
| `bigdata.mjs` | `load` (INSERT…SELECT, 135 k rows/s), `measure` (cold/cached timings + EXPLAIN ANALYZE), `retention` (server code in the api container under live ingest), `sweep` |
| `probe429.mjs` | posts once per Device and lists refusals with their RateLimit headers |
| `ab-override.yaml`, `bigdata-override.yaml` | compose overrides for the A/B (binlog off + 1 GB pool) and the 1 GB cap; test-only |

Example: `node run.mjs --env <env> --label baseline --devices 100 --streams 30 --minutes 15 --poll-every 12`. Stack: `docker compose -p ta-load --env-file <env> -f compose.yaml up -d --build --wait` with `WEB_PORT=8095`. Tear down with `down -v`.
