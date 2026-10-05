# Final: the last fixes, then one proof of the finished branch

Agent: final. Branch `HamzaQaz/prod-hardening` at HEAD b1179df plus the uncommitted fixes below (nothing committed). The proof ran in the CT stand-in (`.scratch/ct/`, debian:12 with systemd, privileged, under Docker Desktop on Windows 11 / WSL2). It used a git bundle of HEAD cloned inside the CT, with these changes laid over it (normalised to LF, as a Linux clone of the commit would be), driven as a new operator per DEPLOYMENT.md. Raw evidence is in `.scratch/prodtest/runs/final/` (gitignored). Nothing is left running: the stack was uninstalled with `--wipe`, and the CT, its image, and its volumes were removed. The host `ta-final` project used for the deploy.ps1 check was uninstalled too, along with the `.env` and `backups/` it created.

## Part B: pass/fail

| # | Step | Result | Evidence (`runs/final/`) |
|---|---|---|---|
| 1 | Fresh CT, operator `admin`: `apt-get install git` (as the doc says), clone, `deploy/deploy.sh bootstrap`, new login, `deploy/deploy.sh deploy --yes` | **PASS**. Bootstrap installed Docker, Compose, and cron and added admin to the docker group. Deploy took **136 s** (first build, `build --pull`). On the dirty checkout it said "local changes; not pulling" | `bootstrap.log`, `deploy.log` |
| 2 | Health from the host (`:8090` → CT :80) | **PASS**: 200 `{"status":"ok","database":"connected"}`, with CSP, nosniff, Referrer-Policy, X-Frame-Options, and Permissions-Policy. `@@innodb_buffer_pool_size` = 536870912, `@@log_bin` = 0 | `health.txt` |
| 3 | `frontend/e2e/walk.mjs` and `.scratch/ct/csp-probe.mjs` from the host | **PASS**: walk **38 of 38**. CSP probe: **0 CSP violations**, 0 console errors, live SSE update ok, framing blocked | `walk.txt`, `csp-probe.txt` |
| 4 | `frontend/e2e/a11y.mjs` (axe, Chromium + Firefox + WebKit) against the CT, which had 100 Devices and live data | **PASS: 0 serious or critical across 87 runs**. The first attempt could not inject axe because the production CSP rightly refuses it, so the tool now sets `bypassCSP` (see below) | `a11y.txt`, `a11y.json` |
| 5 | Resilience drill 2: db stopped **92.5 s** with 50 Devices posting every 30 s (fleet.mjs, firmware behaviour) and 5 emulated dashboards, plus one real Chromium on the Dashboard | **PASS**. **0 × 429** (no lockout) and 0 timeouts: 158 fast 500s during the outage, the last 2.0 s after the db started. Health was 200 **4.6 s** after `docker start db`. **All 50 Devices resumed** on their first post after health returned (max 31.8 s after the db start, 27.2 s after health; 0 failures from db+5 s on). **0 Offline incidents** opened. The Chromium page left its error screen by itself 4.2 s after the db start, without the stream dropping (S1) | `drill2/` (drills.log, posts.jsonl, analyze.txt, offline.tsv), `drill2-chrome/chrome.jsonl` |
| 6 | Backup and restore (S5) | **PASS**. With HEAD's deploy.sh, a table added after the backup **survived** the restore (the bug, red). With the fixed deploy.sh it was **gone**: tables = the dump's six, Readings = the dump's 658, the Campus added after the backup gone, safety backup taken, health 200. Restore took 17.5 s. The same check through **deploy.ps1** on the Windows host also passes | `restore.txt`, `ps1-restore.txt` |
| 7 | 15-minute baseline: 100 Devices, 30 streams, poller every 12 s (`load/run.mjs`, run inside the CT) | **PASS, the full 15 minutes**. Numbers below | `baseline.out`, `load-final-baseline-*.json/.log` |
| 8 | CT restart (`docker restart ta-ct`) | **PASS**: health 200 from the host **17 s** after the restart. Readings 3,653 and Devices 100 before = after. The api exited 3 times waiting for MySQL at boot, then came up by itself (known N4). **S2 live:** with every Device now silent, all 100 Offline incidents started at 20:43:31, exactly api start + 91 s, never inside the restart. The old rule would have backdated them to about 20:42:36 | `restart.txt` |
| 9 | `deploy.sh uninstall --wipe --confirm`, then `.scratch/ct/run.sh down` | **PASS**: containers, built images, and the db volume removed. `.env` and `backups/` kept, as documented. CT container, image, and both volumes removed | `uninstall.txt` |
| — | All suites inside the CT (Node 22.23.3) | **PASS**: backend typecheck, build, and **252/252** tests (its own test DB). Frontend lint, typecheck, **49/49** tests, and build. Python **53 OK**. **shellcheck 0.9.0: 0 findings** on deploy.sh and real-ip.sh | `suites-summary.txt`, `*-test.txt` |

### Baseline (step 7): 100 Devices, 30 streams, 15 minutes, in the CT

| | n | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| **Ingest** (POST /api/readings), all 201, 0 errors, 0 × 429 | 2,995 | 5.1 ms | 6.4 ms | **7.8 ms** | 15.9 ms |
| Fan-out to 30 streams (100% delivered, 89,850 deliveries) | 89,850 | 5.8 ms | 7.4 ms | 9.0 ms | 19.2 ms |
| GET /api/dashboard | 76 | 5.5 ms | **6.7 ms** | 7.8 ms | 7.8 ms |
| GET /api/campuses/overview | 76 | 6.2 ms | **8.8 ms** | 21.4 ms | 21.4 ms |
| GET /api/incidents (7 days) | 76 | 3.6 ms | **5.4 ms** | 6.5 ms | 6.5 ms |
| GET History (one day) | 76 | 2.5 ms | **3.9 ms** | 6.6 ms | 6.6 ms |

Worst single minute of ingest p99 was 12.5 ms. Containers: db 512 MiB (CPU p95 2%), api 38 MiB (CPU p95 4.5%), web 24 MiB. The load generator ran inside the same CT as the stack, so these numbers include it sharing the CPU. The database was small (a fresh install plus the drill's Readings); perf.md has the 90-day figures.

## Part A: fixes, each with its test

All test-first. Each new test was run red before the fix: B1 and S4 failed outright. For S2, I neutralised the fix and all 3 tests failed, then restored it. For S5, HEAD's script failed in the CT.

### B1 (blocker): a database stall locked every Device behind an address out of ingest. **Fixed.**

`backend/src/routes/readings.ts`, `backend/src/auth.ts`. I derived the behaviour from express-rate-limit 8.7's code (`dist/index.cjs` 1003–1048). It counts every request on arrival. With `skipSuccessfulRequests` it takes one back only on a finished "successful" response. With `skipFailedRequests` it takes one back on a finished "unsuccessful" one, on `close` before the response is written, or on `error`. The report's fix (`requestWasSuccessful: status === 401` plus `skipFailedRequests: true`) does take back abandoned requests, **but the test still failed with it**. A stall holds many right-token POSTs in flight at once, all counted on arrival. With 105 stalled boards behind one address, the 101st was answered 429 *during* the stall, before any had been taken back. Behind a TLS proxy without TRUST_PROXY, 100 Devices with a 10 s timeout put about 35 in flight at once, and a larger fleet or a slower stall reaches 100.

So the fix counts only what it should. The limiter has `skip: hasDeviceToken`, so a request with the right token is never counted at all, and wrong-token requests are answered 401 at once without touching the database. A small middleware in front (`refuseLockedOutAddress`) reads the address's count with `limiter.getKey()` and refuses a right-token request once the address has 100 refusals. That keeps the existing property: past the limit even the right token gets a 429, so the limit never tells a guesser which guess was right. Also `connectTimeout: 3000` in `createPool` (`backend/src/db.ts`), so a vanished db fails in 3 s instead of hanging 10 s.

Tests (`backend/test/security.test.ts`):
- **new:** "Readings a board gave up on while the database stalled are never counted as wrong tokens". 105 Devices with every row locked by another connection, 105 right-token POSTs each aborted by the client at 300 ms; afterwards a right-token POST is 201. It failed on the original code and on the report's option-only fix, and passes now.
- **new:** "a refusal other than a wrong token is never counted as one". 101 right-token 404s, none counted.
- **kept:** 100 wrong tokens, then the 101st and the right token are both 429, and another address is unaffected. Also kept: 105 right-token Devices behind one address are all 201.
- **In the CT:** drill 2 had 0 × 429 (before the fix: 1,190 × 429 over 11 minutes).

### S1: the Dashboard stayed on its error screen while Readings streamed. **Fixed.**

`frontend/src/lib/reload.ts` (new), `hooks/use-resource.ts`, `pages/Dashboard.tsx`, `pages/Incidents.tsx`.
- Reloads are **coalesced**: one in flight and at most one queued behind it. The burst of 33 `/api/dashboard` requests in 100 ms becomes 2, and the page ends on an answer from after the burst.
- On the error screen, **a Reading or incident from the stream reloads the page**, since the stream working means the server is back. These reloads are spaced at least 5 s apart, so 100 Devices reporting don't turn a tab into a few requests a second. A successful reconnect already reloaded, and still does.
- Campuses already recovered: it reloads on every Reading, throttled. History reloads on its Device's Readings.

Tests: `frontend/src/lib/reload.test.ts` (4 tests). A burst of 33 calls costs 2 runs. A queued reload still runs after a failed one. The page reloads on its error screen at most once per 5 s. A loaded or loading page is left to its own rules. **In the CT:** the never-reloaded Chromium page left its error screen 4.2 s after the db start, with the stream never dropped. In the resilience report it stayed 13+ minutes.

### S2: the Offline sweep blamed closets for the server's own downtime. **Fixed; recorded in ADR 0006.**

The report's rule, which meets both parts of the brief (at least one Report interval of grace after a start, and no incident starting before the server's own start). Fixing the sweep alone would not have been enough: ingest also records an already-closed Offline stretch when a Device comes back, so after a 90 s db outage most of the fleet would still have got a false incident.
- `backend/src/listening.ts` (new) holds since when the server could hear Devices: the process start (`index.ts`), reset to now by the first database success after a failure. A failure is a failed sweep pass or a failed Reading insert. A success is a pass that reaches the db (it runs `SELECT 1` first) or a Reading insert.
- `incidents.ts` measures silence from `max(last Reading, listening since)`, in both `offlineIncident` (the sweep) and `missedOffline` (ingest). So after a start or an outage every Device gets a whole Offline window (3 intervals, 91 s) to report, and no Offline incident starts before the server could hear it. A Device that is really dead still gets its incident one window after the server is back.
- `docs/adr/0006-incident-log.md` records the rule under **Offline**.

Tests (`backend/test/incidents.test.ts`, "the server's own downtime"):
- After a start, the sweep opens nothing at start + 90 s, then one incident at start + 91 s, starting then.
- A failed pass (a pool on an unreachable port) followed by a good one resets `since`, so a Device silent for 5 minutes gets nothing.
- After `lost()`, a Device's first Reading records no Offline stretch.

All 3 failed with the rule neutralised. **In the CT:** 0 false incidents in drill 2 (before: 50 of 50). After the CT restart, the 100 silent Devices' incidents started at api start + 91 s, not inside the restart.

### S3: nginx held requests about 20 s while the api was down. **Fixed.**

`frontend/nginx.conf`: `proxy_connect_timeout 2s` in both `/api/` locations. There is no `proxy_next_upstream` retry: there is one api, a Reading is a POST that nginx must not send twice, and the stream's retry is the browser's (EventSource 3 s, then `use-reading-stream.ts` reopens 5 s after a non-200). So a fast error is the retry. Checked with `nginx -t` (nginx:alpine). **In the CT** (`s3-api-stop.txt`), with the api stopped: `/api/health` gave 504 in 3.3 s, the stream 504 in 2.0 s, and POST /api/readings 504 in 2.0 s, where before they waited about 20 s. Health was 200 6.8 s after `docker start api`. A stream therefore reopens about 7 s after a restart rather than 30 s. The answer is a 504, not the report's predicted 502, because a vanished address times out rather than refusing.

### S4: health stayed green while every Reading failed. **Fixed.**

`backend/src/ingestHealth.ts` (new), `routes/health.ts`, `routes/readings.ts`, `app.ts`, `deps.ts`. I chose the brief's "error state from recent ingest failures" option over a write probe. A probe updating one row can succeed on a full disk, where InnoDB still has room in existing pages, while new Readings fail. Ingest itself is a write probe that 100 Devices run every 30 s at no cost. Health answers **503 `{status:'error', database:'connected', ingest:'failing'}`** while the latest Reading insert, within 2 Report intervals, failed with a server error. A single good Reading clears it, and on the monotonic clock a failure is forgotten after 60 s without any Reading. Tests: `health.test.ts` makes `readings` unwritable (RENAME), so a POST is 500 and health is 503 with that body. After renaming it back, a POST is 201 and health is 200. `ingestHealth.test.ts` covers the window. The disk-full drill itself was not rerun in the CT.

### S5: `deploy.sh restore` left tables the dump lacks. **Fixed in deploy.sh and deploy.ps1.**

After the typed confirmation, the safety backup, and stopping the api, both scripts run `DROP DATABASE IF EXISTS` then `CREATE DATABASE` before the import, in the same confirmed operation. The `temperature` user's grant is on the database name and survives the drop; in the CT the api reconnected as that user and was healthy. If emptying fails, the scripts bring the api back and print the restore command for the safety backup. The confirmation text now says it replaces the whole database. DEPLOYMENT.md's action table and its manual restore commands match, with the reason. Tests: the red/green restore checks in step 6 (deploy.sh in the CT, deploy.ps1 on the Windows host). There is no automated deploy test suite in the repo.

### From the perf report: `DB_BUFFER_POOL_SIZE`. **Done.**

`compose.yaml` already had `--innodb-buffer-pool-size=${DB_BUFFER_POOL_SIZE:-512M}`. Added:
- `.env.example`: `DB_BUFFER_POOL_SIZE=512M` with sizing guidance.
- deploy.sh and deploy.ps1: `--set DB_BUFFER_POOL_SIZE=…` (validated as MySQL size syntax, `^[1-9][0-9]*[KMG]?$`), also asked in the interactive thresholds prompt, where empty keeps the default.
- DEPLOYMENT.md: how to set it with `install --set … --reconfigure`, and the Proxmox RAM rule: MySQL ≈ pool + 400 MiB, api and nginx ≈ 150 MiB, plus about 1.3 GiB while an upgrade builds. 3 GiB for 100 Devices and 4 GiB with `1G` for 300 are unchanged.
- Verified in the CT: the pool is 512 MiB, and the db used 512–513 MiB under the baseline.

### Test tooling

`frontend/e2e/a11y.mjs`: `bypassCSP: true` on its browser contexts. The production nginx CSP (`script-src 'self'`) blocks the injected axe script, so every state errored. The CSP is proven separately by csp-probe.

## Findings left (notes, not blockers)

- **N4, seen again at the CT restart:** the api exits until MySQL accepts connections at boot (3 exits, then healthy within the 17 s). Harmless with `restart: unless-stopped`. Optional: retry the first connection for about 60 s in `index.ts`.
- **Dashboard reload chatter after recovery:** in the 28 s after the db came back, the Chromium page made 47 `/api/dashboard` reloads, one at a time thanks to the coalescing, as the 50 cards came back from Offline and moved under worst-first. That costs 47 of the 6,000-per-15-minute read allowance. Optional: debounce card-move reloads by about 1 s.
- **Health through web shows 000 for the first 3 s of a db outage** (the drill's curl allows 2 s, and the pool's connect timeout is now 3 s). Docker marked the api unhealthy at +64 s. `/api/health` through web was 200 again 4.6 s after the db started, and Docker's own status follows on its next checks (every 10 s).
- **Mode-only diffs** on `deploy/deploy.sh` and `frontend/real-ip.sh` (100755 → 100644) were in the worktree before this task: a Windows filemode artifact. deploy.sh also has real changes. The index keeps 100755, so commit only content (`core.filemode=false`), or the scripts lose their exec bit.

## Files modified

backend/src/app.ts, backend/src/auth.ts, backend/src/db.ts, backend/src/deps.ts, backend/src/incidents.ts, backend/src/incidentStore.ts, backend/src/index.ts, backend/src/offlineSweep.ts, backend/src/routes/health.ts, backend/src/routes/readings.ts, backend/src/ingestHealth.ts (new), backend/src/listening.ts (new), backend/test/health.test.ts, backend/test/incidents.test.ts, backend/test/security.test.ts, backend/test/ingestHealth.test.ts (new), frontend/src/hooks/use-resource.ts, frontend/src/pages/Dashboard.tsx, frontend/src/pages/Incidents.tsx, frontend/src/lib/reload.ts (new), frontend/src/lib/reload.test.ts (new), frontend/nginx.conf, frontend/e2e/a11y.mjs, deploy/deploy.sh, deploy/deploy.ps1, .env.example, DEPLOYMENT.md, docs/adr/0006-incident-log.md. Report: .scratch/prodtest/final.md.
