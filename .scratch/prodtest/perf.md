# Perf: B1, S2, S3 and T1 from the load report, fixed and measured at scale

Agent: perf. Stack: `compose.yaml` as changed here, project `ta-perf`, port 8099, scratch env file outside the repo (deleted after). Same host as the load agent: Docker Desktop on Windows 11 (WSL2, 5.8 GB), with the resilience agent's `ta-res` stack and the shared test DB running alongside. Scripts: the load agent's `.scratch/prodtest/load/`, plus my `.scratch/prodtest/runs/perf-measure.mjs` (its `measure` EXPLAINs name the old index). Raw results: `.scratch/prodtest/runs/perf-*`, `load-perf-*`. The stack is down (`down -v --rmi local`; no ta-perf containers, volumes or images left).

Memory rule: I waited **6.1 minutes** (13:57–14:03Z, checked every 2 minutes) before the 90-day load, because free host RAM was 753–889 MB. The baseline ran after emptying the big tables and restarting db (Docker at 2.0 GB), so it ran as a normal check rather than a big-data one.

## Pass/fail

| # | Check | Result | Evidence |
|---|---|---|---|
| B1 | Overview at 90 days × 100 Devices (26.2 M Readings) | **PASS** | cold DB 28.0 s → **1.4 s**; cached 8.7 s → **60 ms** p50 |
| B1 | Ingest p99 with 4 Campuses pages open | **PASS** | 26.8 s (load report) → **46 ms**; overview reloads 79 ms p50; db CPU p50 240% → 4.7% |
| B1 | Migration 0006 index build at 26 M rows | **PASS** | 33 s at api start (api down meanwhile); 32 s online by hand with ingest 0 errors, p99 359 ms during it |
| B1 | Dashboard, History, incidents, ingest on the new index | **PASS** | all plans checked: no filesort, no table scan; ingest p50 30 ms, the same as before |
| B1 | Plan test (EXPLAIN on the test DB): range + covering | **PASS** | `campusOverview.test.ts`, failed before the fix |
| S2 | db runs with `--disable-log-bin`, `--innodb-buffer-pool-size=512M` | **PASS** | `@@log_bin=0`, pool 512 MB; compose.yaml (demo inherits it) |
| S2 | `deploy.sh backup` with the binary log off | **PASS** | 30 s, 150 MB gzipped, completeness check passed |
| S2 | `deploy.sh restore` with the binary log off | **PASS** | 4 m 32 s end to end, api healthy, 25.9 M rows back, 0 binlog files |
| S3 | Per-Device write limiter survives a 5 h step | **PASS** | `MonotonicStore` on all four limiters; fake-timer tests |
| S3 | Readings stamped in the future no longer freeze cards or hide silence | **PASS** | dashboard, overview, sweep and ingest pass over them; tests |
| S3 | Browser ages from the server's `secondsSinceReading` + `performance.now()` | **PASS** | Dashboard, hairline, Campuses; `elapsed.test.ts` with a mocked Date step |
| T1 | Stream cap 60 per address (api + nginx), 400 total | **PASS** | `security.test.ts` opens 60, the 61st gets 429; TRUST_PROXY check below |
| — | Backend `npm test` + `typecheck` | **PASS** | 245/245 |
| — | Frontend `lint`, `typecheck`, `test`, `build` | **PASS** | 45/45 tests |
| — | 15-minute baseline on the final build | **PARTIAL: 7 of 15 min** | Claude Code stopped it when the host ran critically low on memory; no regression in the 7 minutes |

## B1. Campuses overview: before and after

All at 90 days × 100 Devices, 26.2 M Readings, 3,035 incidents, loaded with the load agent's `bigdata.mjs load` (182 s).

| | Shipped, 128 MB pool (load report) | Shipped, 1 GB pool (load report) | Shipped code, **512 MB, binlog off** (here) | **Fixed, 512 MB, binlog off** (here) |
|---|---|---|---|---|
| Overview, cold DB | 28.0 s | 10.2 s | 11.8 s past days + 7.1 s today (SQL) | **1.42 s** |
| Overview, cold cache, warm DB | 21.9 s | 5.5 s | | **0.78 s** |
| Overview, cached (p50) | 8.7 s | 2.5 s | 5.7–8.2 s (two GETs) | **60 ms** (max 73 ms) |
| Past-days statement, warm | | 5.59 s | 9.3 s | **0.75 s** |
| Today's statement, warm | | 2.57 s | 6.5–7.1 s | **~30 ms** |
| 4 Campuses pages + 100 Devices, 4 min: overview reloads p50 | 11–58 s | | 6.5 s | **79 ms** |
| … ingest p99 | **26.8 s** | | 38 ms | **46 ms** (797/797 201) |
| … db CPU p50 | 2–5 cores | | 2.4 cores | **0.05 cores** |

The SQL figures from mysql include about 140 ms of `docker exec`, already taken off above. The "shipped code at 512 MB" column used the pre-fix api built from `git archive HEAD`, on the same data. At 512 MB with the binary log off, the old query still took 6.5 s per reload and kept 2.4 cores busy. Ingest held up only because this host's disk was quiet and the binlog's second fsync was gone (S2). With more pages open, or on the 128 MB default, it starved ingest as the load report shows.

**What changed** (`backend/src/routes/campusOverview.ts`, migration `0006-readings-covering-index`):
- `selectDayMaxima` names the Devices (`r.device_id IN (?)`) instead of joining `devices`. MySQL turned the join into a `ref` lookup over each Device's whole history; the IN list is one range per Device. Skipped when there are no Devices.
- Index `ix_readings_device_recorded_temp (device_id, recorded_at, id, temp_f)` replaces `ix_readings_device_recorded (device_id, recorded_at)`, so the statement reads the index alone (`Covering index range scan`).
  - **Deviation from the brief:** the column list is `(device_id, recorded_at, id, temp_f)`, not `(device_id, recorded_at, temp_f)`. Every latest-Reading query (dashboard, overview, sweep, ingest's previous Reading) orders by `device_id, recorded_at, id` and reads one index step. On the old index that was the index order, because InnoDB appends `id`. With `temp_f` before `id`, it would no longer be, and ties within a second would need a sort over each Device's Readings. With `id` named before `temp_f`, the order holds and the index is still covering.
  - One `ALTER … ADD INDEX …, DROP INDEX …, ALGORITHM=INPLACE, LOCK=NONE`. MySQL 8.4 accepts it online. Guarded per step (`indexExists`), so a run that died between the add and the drop finishes on the next start (tested). The new index also serves `fk_readings_device`.
- The 5-minute cache of completed days stays. It now holds the **promise**, so pages that miss together share one statement (test: 5 concurrent requests, 1 past-days read). A failed read is dropped from the cache, and a negative age (the clock stepped back) re-reads.
- Today's statement ends at now + 5 minutes (S3).

**Index build time (26.2 M rows):**
- Through the upgrade path (new api, 0006 pending): container start 19:13:54.5Z, `Applied migrations: 0006-readings-covering-index` at 19:14:27.8Z, so **33 s**. Migrations run before `listen`, so the api answers nothing for those 33 s, and each Device misses about one Reading.
- Online, by hand, while 100 Devices posted (`perf-measure.mjs online`): **32.2 s**, 104 posts during it, all 201, ingest p50 35 / p99 359 / max 486 ms (37 ms before and 36 ms after). DEPLOYMENT.md (Upgrades) now gives this ALTER as the zero-loss path for large installs; the migration then finds it done.

**Other queries on the new index** (EXPLAIN ANALYZE at 26 M rows, `perf-after-*.json`):

| Query | Plan | Time |
|---|---|---|
| Dashboard / overview / sweep latest Reading, 100 Devices | one `Limit: 1` step per Device on the new index, with the future bound as a filter | 6 ms |
| Ingest's previous Reading (`OFFSET 1`) | `Index range scan … (reverse)` | 8 ms |
| History, one day | `Index range scan` over (device_id, day), 2,880 rows | 4 ms |
| Incidents, 7 days | unchanged; does not touch readings | 15 ms p50 via the API |
| Retention batch | `ix_readings_recorded`, unchanged | |

None of them was hurt, and none besides the overview gains (they read `humidity` too, so no covering). Insert cost: the new index is 4 bytes wider per entry (761 MiB at 26 M rows, against PRIMARY 1,200 MiB and `ix_readings_recorded` 1,031 MiB). Ingest p50 was 30 ms before and after; the SQL is under 5 ms of it.

API p50 after, 90 days: dashboard 15 ms, incidents 7 d 15 ms, History day 16 ms; cold DB 37 / 29 / 133 ms.

## S2. MySQL settings

`compose.yaml`'s `db` gets `command: ["--disable-log-bin", "--innodb-buffer-pool-size=${DB_BUFFER_POOL_SIZE:-512M}"]`. `compose.demo.yaml` is an overlay that uses compose.yaml's `db`, so the demo inherits both (noted in its header; `docker compose config` with both files shows the flags).

- Binary log off: there is no replica and no point-in-time recovery, and the backups are `mysqldump --single-transaction` files, which need no binary log. Backup: 30 s, 150 MB gzipped, `Dump completed` check passed. Restore: 4 m 32 s including deploy.sh's own safety backup; api healthy after, 25,915,440 Readings (the 2,219 fewer than before are the retention pass that runs when the api restarts), `@@log_bin = 0`, no binlog files in the data directory, and the overview took 0.84 s straight after.
- Buffer pool 512 MB: MySQL used 470 MiB on a fresh install and **975 MiB–1.03 GiB** with the pool full at 90 days. That is more than the 640 MiB stack DEPLOYMENT.md quoted, so the LXC guidance changes. `DB_BUFFER_POOL_SIZE` is exposed for 1G at 300+ Devices.
- DEPLOYMENT.md: a new "Database settings and sizing" section (why each flag, what the binary log cost, how to undo it for a replica, a sizing table). The Proxmox LXC resources line now says **3 GiB memory and a 24 GB disk** for 100 Devices at 90 days (2 GiB and 16 GB for the first weeks), and 4 GiB, 1G pool and 32 GB for 300.
- Not changed, CT agent's call: `.env.example` could list `DB_BUFFER_POOL_SIZE` with the other tunables, and deploy.sh's `--set` would then accept it.

## S3. Clock steps

**Causes, both sides:**
1. **Limiters.** express-rate-limit's `MemoryStore` gives each key a reset time of `Date.now() + window` and starts a new window only when the wall clock passes it. A key that keeps posting never leaves the store. So a Device counted during a +5 h jump kept a 5 h reset and got 429 once it reached 20 posts, until the clock caught up. That is the `RateLimit-Reset: 16858` the load agent saw.
2. **Future-stamped Readings.** Ingest stamps Readings with the server clock, and the latest-Reading queries take the highest `recorded_at`. Readings stamped during the jump stayed "latest" for 5 h: cards froze, and the sweep could not see those Devices go silent.
3. **Browser ages.** The Dashboard did use the server's `secondsSinceReading`, but measured the time since the fetch with `Date.now()`. A browser clock stepped back froze every card (the clamp to zero); one stepped forward sent every card late at once. The Campuses page computed the worst closet's Offline age as `Date.now() − recordedAt`, mixing the browser's clock with the server's, and its 10 s reload throttle also ran on `Date.now()`, so a step back would stop reloads for the length of the step.

**Fixes:**
- `backend/src/monotonicStore.ts`: an express-rate-limit `Store` whose windows run on `performance.now()`. The reset time it reports for the headers is computed from the wall clock as it is at that moment. All four limiters use it (`app.ts` reads and changes; `readings.ts` per-Device writes and auth failures). Expired keys are swept once a window.
- `backend/src/latestReading.ts`: one `LATEST_READING_ID` subquery with `recorded_at <= now + 5 min`, used by the dashboard, the overview, the sweep (both queries), and ingest's previous-Reading query. Today's overview maximum is bounded the same way. The bound is a parameter from the api's `now()`, the same clock that stamps Readings, so tests that pin the clock still work.
- `frontend/src/lib/elapsed.ts` (`monotonicNow`, `ageSeconds`) and `useElapsedNow()`. The Dashboard's `asOf`, the cards' ages and the report hairline's anchor run on `performance.now()`. The overview now sends `worst.secondsSinceReading`, and Campuses ages it from the fetch on the monotonic clock. Campuses' reload throttle is also monotonic.
- DEPLOYMENT.md (Proxmox LXC): a Clock bullet; chrony on the host with `makestep 1 3`.

**Tests** (all failed before the fix, apart from the frontend lib, which is new):
- `backend/test/monotonicStore.test.ts`, using `node:test`'s `mock.timers` for `Date`:
  - a key counted 5 h ahead starts a new window one monotonic window later;
  - a step back neither stretches nor shortens a window;
  - through express-rate-limit, a Device refused after the step back is let through one window later, with `RateLimit-Reset` within the window.
- `dashboard.test.ts`: a Reading 1 h ahead is passed over, and a Device whose only recent Reading is in the future shows Offline.
- `incidents.test.ts`: the sweep opens Offline despite a future Reading.
- `campusOverview.test.ts`: the worst closet's `secondsSinceReading` with a future Reading passed over, today's high excludes it, and a clock stepped back re-reads the cached days.
- `frontend/src/lib/elapsed.test.ts`: the age is unchanged across a ±5 h `Date` step and keeps counting after one.
- One existing overview test changed: it counted a Reading 14 h past the pinned clock as today's high. That is now passed over by design, so the expectation is 77, not 95.

Not covered: the Incidents page's live durations still use `Date.now() − start`. Those spans are minutes to days, and a step only skews them while it lasts.

## T1. Stream cap 60 per address

- `backend/src/sse.ts`: `DEFAULT_MAX_STREAMS_PER_ADDRESS = 60`, total stays 400. `frontend/nginx.conf`: `limit_conn sse_per_addr 60`. DEPLOYMENT.md's TRUST_PROXY section is updated (60 per address, the 61st tab gets a 429).
- Test (`security.test.ts`): with the defaults, 60 streams from one address get 200, the 61st gets 429, and another address still gets 200.
- TRUST_PROXY, checked through nginx on the stack (`streams.mjs`: 61 streams claiming client A, then 1 claiming client B):
  - without TRUST_PROXY, A gets 60 × 200 and 1 × 429 (nginx's page), and **B gets 429**: every client is the one gateway address;
  - with `TRUST_PROXY=gateway` (`real-ip: client address taken from X-Forwarded-For on requests from: 172.23.0.1`), A gets 60 × 200 and 1 × 429, and **B gets 200**: the cap is per client.

  nginx refuses the 61st before the api sees it. The api's own cap at the same number is covered by the test above, and the api keys on the address nginx forwards (trust proxy 1).

## Baseline re-run (final build, 100 Devices, 30 streams, 15 minutes)

**Partial.** The run (`load-perf-baseline-*.log`, `perf-baseline.out`) was **stopped after 7 of 15 minutes**: Claude Code ends background commands when the host is critically low on memory (free host RAM was 541 MB just after). Per that notice it was not restarted. The coordinator can ask for a re-run when the host has room.

Final build, fresh database (the 26 M rows truncated first), 100 Devices, 30 streams, poller every 12 s:

| Minute (UTC) | Posts | Errors / 429 | Ingest p99 | Fan-out p99 | Deliveries (30 streams) |
|---|---|---|---|---|---|
| 19:32 | 200 | 0 / 0 | 34.6 ms | 38.5 ms | 6,000 (100%) |
| 19:33 | 199 | 0 / 0 | 28.4 ms | 29.2 ms | 5,970 |
| 19:34 | 198 | 0 / 0 | 38.6 ms | 41.1 ms | 5,940 |
| 19:35 | 200 | 0 / 0 | 25.3 ms | 26.8 ms | 6,000 |
| 19:36 | 201 | 0 / 0 | 23.7 ms | 25.1 ms | 6,030 |
| 19:37 | 198 | 0 / 0 | 24.3 ms | 25.2 ms | 5,940 |
| 19:38 | 198 | 0 / 0 | 26.1 ms | 27.3 ms | 5,962 |

1,394 posts, all 201, every Reading delivered to every stream. The load report's baseline had ingest p99 1,495 ms, all of it COMMIT fsync on the shared disk; here the worst minute was 38.6 ms, consistent with the binary log's second fsync being gone (S2), though the disk was also quieter. The poller's API p95s are written only at the end of a run, so they are missing. The 4-tab run and the after-measurement above give the API timings at 90 days (dashboard 15 ms, overview 60 ms cached, incidents 15 ms, History 16 ms p50).

## Findings left for others

- **Note (upgrade downtime):** migrations run before the api listens, so 0006 costs about 33 s of ingest at 90 days. Documented, with the online ALTER that avoids it. A general fix (index builds after `listen`) is a design change, not made.
- **Note (CT agent):** `.env.example` and deploy.sh's `--set` tunables could include `DB_BUFFER_POOL_SIZE`.
- **Note:** `run.mjs`'s `dbSize()` prints `ERROR 1381 … not using binary logging` now that the binary log is off. It is harmless (caught), but the load agent may want to quiet it.

## Files changed

Backend:
- `src/migrations/0006-readings-covering-index.ts` (new), `src/migrations/index.ts`
- `src/routes/campusOverview.ts`, `src/routes/readings.ts`, `src/incidentStore.ts`, `src/app.ts`, `src/sse.ts`
- `src/monotonicStore.ts` (new), `src/latestReading.ts` (new)
- Tests: `test/monotonicStore.test.ts` (new), `campusOverview`, `dashboard`, `incidents`, `migrations`, `legacyMigration`, `security`

Frontend:
- `src/lib/elapsed.ts` (new), `src/lib/elapsed.test.ts` (new)
- `src/hooks/use-now.ts`, `src/pages/Dashboard.tsx`, `src/pages/Campuses.tsx`, `src/components/ReportHairline.tsx`, `src/components/DeviceCard.tsx` (comment), `src/types.ts`
- `nginx.conf`

Deployment: `compose.yaml`, `compose.demo.yaml`, `DEPLOYMENT.md`.
