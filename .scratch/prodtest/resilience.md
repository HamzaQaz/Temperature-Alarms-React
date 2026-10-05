# Resilience: how the production stack fails and recovers, and the district's upgrade path

Agent: resilience. Stack: `compose.yaml` as shipped, project `ta-res`, port 8096. Scratch env and clones lived in the session scratchpad and are deleted. Host: Docker Desktop on Windows 11 (WSL2, 5.8 GB, shared with other agents' stacks). The drills ran against the working tree of `HamzaQaz/prod-hardening` at 25a5de2 as built at 18:45Z on 2026-10-05, before the in-flight 0006/MonotonicStore edits landed. The upgrade path ran fa39159 → 91288a5 (origin/master) → 25a5de2 (branch tip) from a git clone, exactly as a district server would. **No product code was changed.** Scripts: `.scratch/prodtest/resilience/`. Raw logs: `.scratch/prodtest/runs/res/` (gitignored). **Nothing is left running:** no `ta-res` containers, volumes, networks, or images; toxiproxy and alpine images removed; the fleet, the Chromium watcher, and their browsers have exited.

Load during every drill: 50 Devices posting every 30 s, as the firmware does (one attempt per interval, a 10 s HTTP timeout, nothing retried or buffered). Five dashboards behaved like `useReadingStream`: EventSource retries after 3 s, the hook reopens 5 s after a non-200, and the page reloads `/api/dashboard` on reopen. One real headless Chromium sat on the Dashboard, was never reloaded, and was sampled every second (LiveStatus label and every card's latest Reading time).

## Pass/fail

| # | Check | Result |
|---|---|---|
| 1 | api killed mid-ingest: data consistent, browsers recover without reload | **PASS**, with a 30 s stream gap (S3) |
| 1 | api crash (SIGKILL of node): restart policy brings it back | **PASS**, 3.4 s, 0 Readings lost |
| 2 | db crash: api stays up and recovers when the db returns | **PASS**, 5.0 s, 4 Readings lost |
| 2 | db away 90 s: api reports unhealthy, then recovers | api **PASS**. Devices **FAIL: blocker B1**: locked out for 13 min. Dashboard **FAIL: should-fix S1**: stuck on its error screen |
| 3 | web (nginx) restart with streams open | **PASS**, 2.6 s, streams back in 3 s |
| 4 | `docker compose restart` | **PASS**, 6.3 s; no false Offline incidents |
| 4 | Reboot (`down`, 120 s, `up` without -v): data intact, migrations a no-op | **PASS** |
| 4 | Offline sweep after downtime | **FAIL: should-fix S2**: 11 of 50 Devices got Offline incidents backdated into the server's own downtime |
| 5 | Disk full | Survives and recovers in 0.8 s. **FAIL: should-fix S4**: health stays green while every Reading fails |
| 6 | DST: Overnight, Today, overview days, History day across 2026-11-01 and 2027-03-14 | **PASS**, 8/8 checks in each of 6 zones |
| 7 | Slow api↔db network (toxiproxy): no pool leak, recovers | **PASS**: the pool peaks at 10 and is idle 1.6 s after the fault ends. Timeouts at 1 s RTT trip B1 again |
| U1 | Deploy fa39159, seed 50 Devices and 2 days (288,000 Readings) | **PASS** |
| U2 | Upgrade with `deploy/deploy.sh deploy --pull` | **PASS**, 32.6 s; Devices saw 6.4 s of downtime |
| U3 | 0005 applied, data intact, incidents recording | **PASS** |
| U4 | Roll back to fa39159 with the new tables present, then forward | **PASS** both ways. No documented rollback (N6) |
| U5 | Backup before, `deploy.sh restore` after | Data **PASS**. **FAIL: should-fix S5**: tables the dump lacks survive the restore |
| U6 | Legacy per-Device tables → `deploy.sh migrate-legacy`, end to end | **PASS** |

## Failure drills

The windows run from the drill's first action to 30–60 s after recovery. "Lost" means POSTs a Device saw fail. The firmware drops each one: `reporter.cpp` makes one attempt per Report interval with a 10 s timeout and has no retry or buffer, so every failed POST is a Reading that never exists. "Health" is `/api/health` through `web`.

| Drill | Recovery (health 200) | Devices saw | Readings lost | Streams / Chromium | Data and incidents |
|---|---|---|---|---|---|
| 1a `docker kill api` | 17.9 s. `unless-stopped` does **not** restart a killed container (Docker treats `kill` as a manual stop), so it was started by hand at +7.2 s | 10 s **timeouts**, not 5xx: nginx's connect to the vanished address hangs | 11 | Streams reopened after **29.7 s** (a retry hung about 21 s in nginx, then got a 502, and the hook waited 5 s). Chromium: "Reconnecting" within 1 s, "Live" at +30 s, reloaded `/api/dashboard` once, **0 cards behind**, 0 page reloads | 0 acknowledged Readings missing; incidents consistent |
| 1b api crash (SIGKILL node from the VM) | **3.4 s** (policy restart) | requests waited about 1 s | **0** | Reopened after 3 s; Chromium Live again in 3 s, 0 behind | consistent |
| 2a db crash (SIGKILL mysqld) | **5.0 s** (policy restart) | fast 500s for 1.9 s | 4 | No drop; stayed Live | consistent. 2 later requests got "Can't add new command when connection is in closed state" (N3) |
| 2b db stopped 90 s | api stayed up. Health timed out (the db address vanished, and mysql2's connect timeout is 10 s), Docker marked api unhealthy at +74 s, health was 200 again **2.3 s after the db started** | 13 × 500 and 100 × 10 s timeouts, **then 429 from every Device for 11 more minutes** (B1) | **1,303 in 13.0 min** (1,190 of them 429s); the outage alone cost 113 | Streams never dropped. Chromium fired 33 `/api/dashboard` reloads in 100 ms as the db returned; all got 500 and the **page stayed on its error screen for 13+ min** with Readings streaming (S1) | 50 Offline incidents opened, backdated into the outage; open up to **747 s** because of the lockout (S2). No duplicates, no lost closes |
| 3 `compose restart web` | **2.6 s** | 5 connection resets | 5 | Reopened in 3 s; Chromium Live in 3 s, 0 behind | consistent |
| 4a `docker compose restart` | **6.3 s** | 502s, resets, and 10 s timeouts over 14.4 s | 10 | Reopened after 29 s (as in 1a); Chromium caught up, 0 behind | api crash-looped 3 times waiting for the db (N4), then healed. **No Offline incidents** |
| 4b `down`, 120 s, `up -d` (no -v) | 143 s from `down` (18.4 s after `up`) | ECONNREFUSED throughout | 230 (all downtime) | Retried every 3 s throughout; Live 3 s after web returned, 0 behind | Rows 962 → all kept, migrations unchanged (6 rows, no "Applied"). **11 false Offline incidents** (S2), each about 91 s, all closed |
| 5 db volume full (700 MB tmpfs, filler to 0 bytes) | mysqld never stopped; **0.8 s** after space came back | 500 "The table 'readings' is full" from +47 s, for 2 m 16 s | 230 | No drop. Cards went stale, then Offline | **Health 200 and Docker "healthy" the whole time** (S4). 50 Offline incidents opened and all closed. 601 acknowledged = 601 rows |
| 6 DST | n/a | n/a | n/a | n/a | 8/8 checks in America/Chicago, New_York, Denver, Phoenix, Europe/London, UTC (see below) |
| 7a +100 ms each way (200 ms RTT) | stayed healthy | ingest p50 1.24 s, p99 3.3 s | 0 | no effect | Pool grew to 10 connections, never stuck |
| 7b +500 ms each way (1 s RTT) | stayed 200, but health took 1–6.6 s (pool queue) | ingest 6–10 s; 10 s timeouts | 22 | no effect | Pool at 10, all returned afterwards |
| 7c black hole 60 s (toxiproxy `timeout` 0) | 1.6 s after removal | 80 × 10 s timeouts, **then 429 from every Device** (B1) until the api was restarted 2 min later | 219 | no drop | **83 Readings written after the Device had given up** (stored, stamped up to 60 s late; N5). Pool idle again at once |

Data integrity across all drills (3,535 POSTs): **0 acknowledged Readings missing**. The 83 rows the Devices never got a 201 for are all from 7b/7c. Incident tables: 0 duplicate open incidents, 0 open incidents without an open segment, 0 closed incidents with an open segment, 0 overlapping same-Condition incidents, and the dashboard's warning-or-worse Conditions matched the open incidents exactly (3 = 3) at the end (`runs/res/drills/global-final.json`).

**Drill 6 detail** (`dst.mjs`, run in Linux Node with `TZ=<zone>`. Windows Node ignores `TZ` for anything but UTC, so a Windows run silently tests the host zone). Fall-back night 2026-10-31 in Chicago is 18:00 CDT → 08:00 CST, 23:00Z → 14:00Z, **15 h**. Spring-forward night 2027-03-13 is **13 h**. At 07:30 on 2026-11-01, and at 01:30 in the repeated hour, Overnight names the night of the 31st and Today is the 1st. The browser's Today and the server's History day agree to the millisecond (25 h and 23 h). The overview's 7 days ending 2026-11-02 tile with no gap (24,24,24,24,24,25,24). `todayIn` flips at local midnight on both sides of the change. A UTC server (the containers) still cuts Chicago days right, because every endpoint gets `?tz=` (History, overview) or explicit instants (incidents) from the browser. Phoenix (no DST) and London (changes a week earlier) pass too. A Device has no clock; recorded_at is the server's UTC second.

## Upgrade path (fa39159 → master → branch tip, from a git clone)

| Step | How | Time | Devices saw | Result |
|---|---|---|---|---|
| U1 Deploy fa39159 | its own `deploy/deploy.sh deploy -p ta-res --web-port 8096 --no-pull --yes` | 44 s | | healthy; 50 Devices via the admin API, 288,000 Readings (2 days × 30 s), 3 hot an hour a day |
| U5a Backup | `deploy.sh backup` | 1.6 s | none | 1.8 MB gz |
| U2 Upgrade to 91288a5 | upstream master moved; `deploy.sh deploy --pull --yes` (fast-forward, re-execs the new script) | **32.6 s** | **6.4 s** of failures, 13 lost; streams back in 9 s | `Applied migrations: 0005-incidents` |
| U3 Verify | fingerprint | | | Campuses/Devices CRCs and all 288,000 pre-upgrade Readings (count and sums of temp, humidity, timestamps) identical. Tables gained `incidents`, `incident_segments`. **3 Hot incidents opened** from live Readings. No Offline incidents. 0005 does not backfill history (by design) |
| U4a Roll back to fa39159 | `git checkout fa39159`, `deploy.sh deploy --no-pull` | 18.2 s | 5.1 s, 12 lost | Old code starts on the newer schema without complaint (it ignores the unknown migration row and the new tables). Dashboard 200, data identical |
| U4b Forward to 91288a5 | `git checkout master`, `deploy.sh deploy --pull` | 20 s | 6.2 s, 15 lost | no migration to run; incidents resume |
| U4c Forward to 25a5de2 (prod-hardening) | upstream moved; `deploy.sh deploy --pull` (now `build --pull`) | 2 m 17 s (fresh base images) | **19.1 s**, 32 lost (db recreated too: new cap_drop and security_opt) | healthy, data identical |
| U5b Restore the pre-upgrade backup | `deploy.sh restore --file <U5a> --confirm ta-res --yes` | **21 s** | 11.3 s (10 s timeouts), 26 lost; streams 29 s | 288,075 rows = the dump exactly; `schema_migrations` back to 0004, then 0005 re-applied as a no-op. **But `incidents`/`incident_segments` (not in the dump) kept 3 Hot incidents from after the backup point, and 15 false Offline incidents opened** (S5, S2) |
| U6 Legacy tables | the documented sequence: `compose down -v`, `install --set LEGACY_TIME_ZONE=America/Chicago --reconfigure`, `up --wait db`, `mysql < old.sql`, `deploy.sh deploy`, then the old writer adds rows and `deploy.sh migrate-legacy --yes` | | | See below. **PASS** |

**U6 detail.** `legacy-dump.mjs` builds 3 locations (one shortcode lower-case), 6 device rows (one on an unknown campus), 5 `ESP_` tables of 576 rows each (every 5 min for 2 days, Chicago strings like `10/5/2026` `2:30:00 PM`, half without HUMIDITY), 3 unreadable rows, and an orphan `ESP_0A0099`. The first start copied 3/3 campuses and 5/6 devices (`NOPE` logged). It copied 576 rows per table, logged and skipped the 3 bad rows, and skipped the orphan. Timestamps came out exactly right: 2:35 PM CDT on Oct 3 → `2026-10-03 19:35:00` and 2:30 PM CDT on Oct 5 → `19:30:00` UTC, with `oms` matched to `OMS` and humidity NULL where the table had none. After 4 rows were added to `ESP_0A0002`, `deploy.sh migrate-legacy` backed up and then copied exactly those 4 (580 in total). A second run copied 0. The documented check reconciles: `legacy_readings_progress` copied 580 + skipped 0 = `COUNT(*)` of `ESP_0A0002` 580 = rows in `readings` 580.

## Findings, by production impact

### B1. Blocker: a server-side stall locks every Device out of ingest for up to 15 minutes

**What happens.** In drill 2b the db was away for 90 s. Every Device behind one address then got `429 Too many requests with a wrong Device token from this address` for **11 more minutes**, with the correct token. That cost 1,303 Readings, where the outage alone cost 113, and kept 50 Offline incidents open for up to 747 s. The 60 s black hole in drill 7c did the same; only an api restart cleared it. In the district, every board on a campus shares its NAT address, and behind a TLS proxy without `TRUST_PROXY` every board shares one, so one event takes out a campus or the whole district.

**Cause.** `backend/src/routes/readings.ts`, `authFailureLimiter`: `requestWasSuccessful: (_req, res) => res.statusCode !== 401` with `skipSuccessfulRequests: true`. express-rate-limit 8.7 counts every request first and decrements only on `finish` when the request was "successful" (`dist/index.cjs` around line 1037). A request whose client gives up before the response is written never finishes. The board's 10 s timeout closes the socket, and nginx closes upstream, so it stays counted as a wrong-token failure. Whenever ingest stalls past 10 s (db away, the db's address vanished so connects hang 10 s, a pool queue under a slow disk, or load.md B1's overview starving the pool), each hung POST counts against `DEVICE_AUTH_FAILURE_LIMIT` = 100. After 100 the limiter refuses even the right token for the rest of the 15-minute window. In this run, drill 1's 11 timeouts at 18:47 were still counted in the window that locked out at 18:53. Present in the committed code and in the uncommitted MonotonicStore edit, which keeps the same options.

**Reproduce.** `drills.sh <env> <out> db-stop-long 90` with `fleet.mjs` running. Then `analyze.mjs --drill db-stop-long`: 100 `error:timeout`, then `429` with `RateLimit-Policy: 100;w=900`.

**Fix (exact).** In `readingsRouter`, invert the sense so that only a finished 401 stays counted. With `skipFailedRequests`, the library decrements on a non-"successful" finish, on `close` before the response, and on `error`:

```ts
const authFailureLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: DEVICE_AUTH_FAILURE_LIMIT,
  store: new MonotonicStore(),
  standardHeaders: true,
  legacyHeaders: false,
  // "Successful" here means "counts": only a finished 401 (a wrong or missing token) stays counted.
  // Anything else, including a request the board gave up on before the answer, is taken back.
  requestWasSuccessful: (_req, res) => res.statusCode === 401,
  skipFailedRequests: true,
  message: { error: 'Too many requests with a wrong Device token from this address, please try again later.' },
  validate: false,
});
```

**Test first** (`backend/test/readings.test.ts`): make ingest hang with a stub pool whose `getConnection` never resolves, or a held `SELECT … FOR UPDATE` on the Device row. Send `DEVICE_AUTH_FAILURE_LIMIT + 1` POSTs with the right token, each aborted by the client (`AbortSignal.timeout(50)`). Then release the lock and assert the next right-token POST returns 201, not 429. Keep the existing test that 101 wrong tokens are refused. Also set `connectTimeout: 3000` in `createPool` (`backend/src/db.ts`), so a vanished db fails fast (500, not counted either way) instead of hanging requests for 10 s.

### S1. Should-fix: the Dashboard can sit on its error screen indefinitely while Readings stream in

**What happens.** When the db came back in drill 2b, the sweep and the queued ingests broadcast a burst of events. `Dashboard.tsx` called `reload()` for every Reading that moved a card: 33 `/api/dashboard` requests in 100 ms, all 500 while the db finished starting. The last one set `state.status = 'error'`. The stream never dropped, so `onReconnect` never fired, and in the error state `shown.current` is undefined, so no Reading triggers a reload. A wall screen showed "Could not load …" with a Try again button for 13+ minutes, until the watcher was restarted. A drop of the stream itself (drill 4b) does recover.

**Fix (frontend/src, accessibility agent).** In `Dashboard.tsx` (and the same pattern in `Incidents.tsx` and `Campuses.tsx`): while `state.status === 'error'`, retry, either on a timer:

```ts
useEffect(() => {
  if (state.status !== 'error') return;
  const timer = setInterval(() => void reload(), 15_000);
  return () => clearInterval(timer);
}, [state.status, reload]);
```

or by calling `reload()` from `onReading`/`onIncident` when nothing is shown. Also coalesce reloads: one in flight plus at most one queued, instead of one per moving Reading. **Test:** a hook test with a fake `EventSource` and a `load` that fails once then succeeds. Advance timers and assert the state reaches `ready` without `onReconnect`.

### S2. Should-fix: the Offline sweep blames closets for the server's own downtime

**What happens.** After any outage longer than the Offline window (3 × 30 s), the first sweep that succeeds opens Offline incidents for every Device that has not yet posted again, with `started_at = last Reading + 90 s`, which falls inside the server's downtime. Drill 2b: 50 of 50 Devices. Drill 4b (a reboot of a little over 2 min): 11 of 50, about 91 s each. The restore in U5b: 15 of 50. Disk full: 50 of 50, which is arguably right, since nothing could be recorded. The one-interval delay before the first pass (`startOfflineSweep`) is shorter than the Offline window. `web` only starts after `api` is healthy, about 10–20 s later, so Devices get only 10–20 s to report before the first pass. After a db outage, the sweep keeps running in a process that never restarted, so there is no delay at all. The incident log ("50 closets Offline overnight") then reports a server event as a closet event. Is it right? The server truly heard nothing, but those Devices were fine and could not have been heard, so the record should not say they went Offline then.

**Fix (backend/src/offlineSweep.ts and incidentStore.ts).** Measure silence from when the server could last hear the Device: `silentSince = max(lastReading, availableSince)`. Open an incident only when `now − silentSince > offlineAfterSeconds`, starting at `silentSince + offlineAfterSeconds`. `availableSince` is the process start, reset to now by the first successful pass after a failed one. Pass it from `startOfflineSweep` into `sweepOffline`. A Device that is genuinely dead still gets its incident one Offline window after the server comes back. **Test** (`offlineSweep.test.ts`): last Reading at T−300 s, `availableSince` at T−60 s, so no incident. At `availableSince + 91 s` an incident opens, starting at `availableSince + 90 s`. Also: a failed pass followed by a successful one resets `availableSince`.

### S3. Should-fix: nginx holds requests for up to ~20 s while the api is down, delaying browser reconnects to ~30 s

**What happens.** In drills 1a and 4a the api was healthy again after 6–18 s, but every stream took **29–30 s** to come back. The EventSource retry made while the api was down hung about 21 s in nginx before its 502. The hook then waited 5 s. Devices saw 10 s timeouts instead of fast 502s. **Cause:** `frontend/nginx.conf` sets no `proxy_connect_timeout`, so the default is 60 s. A stopped or restarting container's address answers nothing, so the connect waits for SYN retransmits rather than failing.

**Fix (CT test agent).** In both `/api/` locations of `frontend/nginx.conf`, add `proxy_connect_timeout 2s;`. The api is on the same bridge, so a healthy connect takes well under a millisecond. **Check:** rerun `drills.sh … api-kill` and `stack-restart`. Expect stream reopen at about health-recovery plus 5 s, and Devices seeing 502 instead of `timeout`.

### S4. Should-fix: a full disk leaves the stack "healthy" while every Reading fails

**What happens (drill 5, measured, not reasoned).** With the db volume at 0 bytes free, InnoDB could not extend `readings.ibd`. Every ingest got `500 The table 'readings' is full` for as long as the disk stayed full. mysqld did not crash, the binlog did not abort the server, and once space returned ingest recovered in 0.8 s with no restart. But `/api/health` (`SELECT 1`) stayed 200, Docker said "healthy", and `deploy.sh status` showed everything fine. Only the dashboards going Offline showed it. load.md sizes 90 days at ~3 GB of Readings plus ~3 GB of binlog on a 16–24 GB CT, so this is a realistic way to fail.

**Fix.** (a) `backend/src/routes/health.ts`: have the readings router record the outcome of the latest ingest (a server error versus a 201). Health returns 503 `{status:'error', ingest:'failing'}` when the latest ingest within the last 2 Report intervals failed with a server error, and the api's healthcheck then turns unhealthy. **Test:** stub `pool.getConnection` to throw `ER_RECORD_FILE_FULL` on insert, POST once, expect `/api/health` 503. (b) `deploy/deploy.sh status` (CT test agent): print free space for Docker's data root and warn under 15%.

### S5. Should-fix: `deploy.sh restore` leaves tables that are not in the dump

**What happens (U5b).** Restoring a backup taken before the upgrade replaced `campuses`, `devices`, `readings`, and `schema_migrations` exactly, but `incidents` and `incident_segments` survived. They held 3 open Hot incidents that began after the backup point and pointed at Readings that no longer exist. The api then re-ran 0005 (`CREATE TABLE IF NOT EXISTS`, a no-op) and recorded it. The same holds for any table a later version adds. **Cause:** `do_restore` pipes the dump into the existing database; mysqldump only drops the tables it contains.

**Fix (deploy.sh and deploy.ps1, CT test agent).** After `dc stop api` and before the import, recreate the database. The `temperature` user's database-level grant survives a DROP DATABASE:

```bash
dc exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -e "DROP DATABASE \`'"$DB_NAME"'\`; CREATE DATABASE \`'"$DB_NAME"'\`"'
```

**Check:** the U5b sequence. After restore, `SHOW TABLES` lists exactly the dump's tables, then the api's migrations recreate the rest empty.

### Notes

- **N1. Firmware drops, never retries.** Each failed POST is a lost Reading (`TemperatureAlarms.ino`: "nothing retries"). Measured cost per event: api crash 0, db crash 4, web restart 5, stack restart 10, upgrade 13–32, restore 26. That is fine for a 30 s cadence. One retry 5 s after a connection failure or 5xx would recover most of these. Optional.
- **N2. `docker kill` / `docker stop` by hand is not undone by `unless-stopped`** (Docker semantics). A real crash is restarted in 2–3 s (drills 1b, 2a). Operators should restart with `deploy.sh deploy` or `docker start`. Worth one line in DEPLOYMENT.md's troubleshooting.
- **N3. Dead pooled connections after a db restart.** A few requests got "Can't add new command when connection is in closed state" or "Connection lost" (500s) right after recovery, 2 in drill 2a and 8 in 7c. Optional: retry idempotent reads once on `PROTOCOL_CONNECTION_LOST`, or set the pool's `idleTimeout` low.
- **N4. api exits when the db is not ready at start.** During `compose restart` it crash-looped 3 times (`depends_on: service_healthy` applies only to `up`), then healed in seconds. Optional: retry the first connection for about 60 s in `index.ts` before exiting.
- **N5. Slow db, no deadline.** At 1 s RTT, ingest took 6–10 s; requests queue on the pool without limit and commit even after the board has given up. 83 Readings were stored that the boards counted as failed, some stamped up to 60 s late. No pool leak: it peaked at 10 and was idle within 1.6 s of the fault ending. With B1 fixed, these timeouts are harmless. Optional: reject with 503 if a Reading waited more than ~8 s for a connection.
- **N6. Rollback is safe but undocumented.** Old code (fa39159) runs on the newer schema. Incidents are not recorded while on it, and a Condition that starts and ends during the rollback never appears in the log. Add a "Rolling back" paragraph to DEPLOYMENT.md: back up, `git checkout <previous>`, `deploy.sh deploy --no-pull`, forward again with `git checkout master && deploy.sh deploy --pull`.
- **N7. No graceful shutdown.** `docker stop` on the api exits 137 (SIGKILL): node runs as PID 1 with no SIGTERM handler. Each deploy or restart resets in-flight connections (3–7 socket errors per event above). Optional: `init: true` on `api` in `compose.yaml` plus a SIGTERM handler that stops accepting, ends the SSE responses, and drains the pool.
- **N8. dotenv advertises in the api log at every start** (`[dotenv@17.2.3] injecting env (0) from .env -- tip: …`; no `.env` is in the image). `dotenv.config({ quiet: true })`.
- **Downtime the district should expect** on an upgrade: 6–20 s of failed POSTs (13–32 Readings across 50 Devices; double that at 100), streams back in 9–17 s, no page reload needed.

## Fixes made and tests

None. The brief said not to change product code. Each fix above names its owner, its exact change, and the test that should come first.

## Scripts (`.scratch/prodtest/resilience/`)

`fleet.mjs` (Devices plus emulated dashboards, JSONL logs), `chrome.mjs` (headless Chromium watcher), `drills.sh` (drills 1–4: kill, crash, db-stop-long, web-restart, stack-restart, down-up), `toxi.sh` + `toxi.override.yaml` (drill 7), `disk.sh` + `disk.override.yaml` (drill 5), `dst.mjs` (drill 6), `analyze.mjs` (per-window and global integrity checks), `seed.mjs`, `fingerprint.mjs`, `legacy-dump.mjs` (upgrade path). They reuse `../load/lib.mjs` and `../load/devices.mjs`.
