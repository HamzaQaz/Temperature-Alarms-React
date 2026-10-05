# Review: firmware, bench watcher, containers, and docs

Scope: `arduino/` (sketch, `bench.py`, `test_bench.py`), `compose.yaml`, `backend/Dockerfile`, `frontend/Dockerfile`, `frontend/nginx.conf`, `.env.example`, `README.md` and `DEPLOYMENT.md` as of `HEAD` (254dba2), `CONTEXT.md`, `docs/adr/`. Reviewed against tickets 01, 13, 14, 18, and 19. Two axes: Standards (repo conventions and idiom) and Spec (each ticket's checklist and comments).

Commands run:

- `python -m unittest arduino/test_bench.py`: **52 tests, OK**.
- `docker compose --env-file <scratch>/stack.env config` resolves cleanly, and `WEB_PORT=127.0.0.1:8080` becomes `host_ip: 127.0.0.1, published: 8080`. A scratch env file with `DEVICE_TOKEN=` left blank is refused with `required variable DEVICE_TOKEN is missing a value: Set DEVICE_TOKEN in .env (openssl rand -hex 32)`.
- Throwaway containers, outside the stack: `nginx:1.24-alpine nginx -t` on DEPLOYMENT.md's manual server block, and `caddy:2-alpine` running DEPLOYMENT.md's Caddyfile with a plain-HTTP POST sent to it. Results are under findings 1 and 2.
- A scratch reproduction of `Inventory.record` followed by `reconcile` (finding 4).

Findings are ranked most severe first. Each one was verified by running something or by reading the code and its callers; the few verified only by reading say so.

---

## 1. Putting TLS in front of the stack, as documented, silences every Device flashed with `http://<host>`

- **Severity:** bug
- **Tickets:** 18 (TLS in front of the stack), 14 (an operator gets from a blank server to a Reading)
- **Where:** `DEPLOYMENT.md:151-165` at HEAD; `README.md:238` at HEAD
- **What goes wrong:** README Flashing step 1 tells installers to flash `SERVER_URL "http://<host>"` while the stack runs plain HTTP. Later the operator follows "TLS in front of the stack", which moves the stack to `WEB_PORT=127.0.0.1:8080` and puts Caddy on ports 80 and 443.
  - I ran the exact Caddyfile in `caddy:2-alpine`. A plain-HTTP `POST /api/readings` gets `HTTP/1.1 308 Permanent Redirect`, `Location: https://…/api/readings`.
  - `ESP8266HTTPClient` does not follow redirects by default, so each Device logs `report: 308` every interval and records nothing. Every card goes Offline.
  - A Device flashed with an IP address matches no Caddy site at all. Port 8080 is bound to loopback, so it can't reach the stack directly either.
  - Line 165 says the opposite: "Devices on the closet network can also keep posting to the stack's own port over plain HTTP if the host allows it." With `127.0.0.1:8080` the host does not allow it.
- **Smallest fix:** add a plain-HTTP site to the documented Caddyfile that proxies Readings and redirects everything else:

  ```
  http://YOUR_DOMAIN {
      handle /api/readings { reverse_proxy 127.0.0.1:8080 }
      handle { redir https://{host}{uri} 308 }
  }
  ```

  Then rewrite line 165 to say that Devices keep `http://YOUR_DOMAIN` only through that block, and that Devices must be flashed with the hostname, not an IP. Add a sentence to README Flashing step 1 saying the same.

## 2. The manual nginx template fails `nginx -t`, so step 5 never reaches step 6 (certbot)

- **Severity:** bug
- **Ticket:** 14 (nginx with a placeholder domain, certificate setup); the template dates from ticket 01
- **Where:** `DEPLOYMENT.md:297-303` and `:341` at HEAD
- **What goes wrong:** step 5 writes a `listen 443 ssl http2` server with the certificate lines commented out, then runs `sudo nginx -t && sudo systemctl reload nginx`. I ran that block through `nginx:1.24-alpine nginx -t` (1.24 is the version Ubuntu 24.04 ships). It fails with `[emerg] no "ssl_certificate" is defined for the "listen ... ssl" directive`. `certbot --nginx` in step 6 refuses to run on a config that fails the test, so an operator following the guide literally is stuck at step 5. The TLS section (`:163`) also points at this block.
- **Smallest fix:** in step 5, ship one `listen 80` server carrying the `root`, `/api/` and `/` locations, with no 443 block and no redirect. `certbot --nginx -d YOUR_DOMAIN` then adds the 443 server and the redirect itself. Change the step 6 note to match ("Certbot adds the HTTPS server and the redirect").

## 3. Migrating an old database after the first run breaks the stack

- **Severity:** spec gap
- **Ticket:** 18 (migrating an old database in: dump, restore into the volume, `LEGACY_TIME_ZONE`, `migrate:legacy`)
- **Where:** `DEPLOYMENT.md:127-140` at HEAD
- **What goes wrong:** the guide puts First run (`:40`) before "Migrating an old database in", and First run tells the operator to walk the whole path. That start applies every migration to the volume and records it in `schema_migrations`. Step 3 then restores `old.sql`:
  - `mysqldump` output disables foreign-key checks and drops each table before recreating it. So the new `devices` table is replaced by the legacy one, and `readings`' foreign key `fk_readings_device` (`backend/src/migrations/0001-initial-schema.ts:37`) now points at a table with the wrong shape.
  - Every migration is already recorded, so `0000-legacy-tables-aside` never runs and nothing is converted. The `api` then queries `devices.campus_id` on a legacy table.
  - The section says "restore the old dump into the volume first" but never says the volume has to be empty.
  - Verified by reading the migration runner and mysqldump's default output, not executed.
- **Smallest fix:** add a step 0: "If the stack has run before, start from an empty database: `docker compose down -v` (this deletes everything in it)." Also add one line under First run: "Migrating an old database? Skip this and go to Migrating an old database in."

## 4. The bench watcher's closing summary drops every board the sheet lacked once it is written back

- **Severity:** spec gap
- **Ticket:** 19 (Log: "On stop it prints the sheet rows never seen and the boards seen that the sheet lacks")
- **Where:** `arduino/bench.py:178-181` (`_append_row` adds the new row to `self.rows` and `self._by_mac`) and `arduino/bench.py:193-203` (`reconcile`)
- **What goes wrong:** a board not on the sheet gets a row through `record_on_sheet`, and that row is added to the in-memory inventory. `reconcile` then finds it with `inventory.find`, so "Boards seen that the sheet lacks" is always 0 when write-back succeeds.
  - I reproduced it on a scratch sheet: the line reads `COM9  added row 3  ESP_1234AB  -  flashed  PASS`, and `reconcile` returns `([row 2], [])`.
  - README `:288` promises "the boards the sheet lacked at start", and the docstring at `bench.py:8` says "at the start". The existing test (`test_bench.py:74`) never writes back, so it can't catch this.
  - In practice, the six-plus boards the 92-row sheet was known to be missing would be absent from the stop report.
- **Smallest fix:** keep a frozen copy of the starting MACs, e.g. `self._listed_at_start = frozenset(self._by_mac)` in `Inventory.__init__`. Have `reconcile` use it for `not_on_list`, and keep `never_seen` on the starting rows. Add a test that calls `record` for an unlisted MAC and then `reconcile`.

## 5. After more than 24.8 days without a report attempt, the Device stays silent for up to another 24.8 days

- **Severity:** bug (unlikely, but real)
- **Ticket:** 13 (survives WiFi drops without a reboot)
- **Where:** `arduino/TemperatureAlarms/TemperatureAlarms.ino:21-24`, `:42`
- **What goes wrong:** `reportDue()` checks `(long)(millis() - nextReportAt) >= 0`. That is correct only while less than 2³¹ ms (about 24.86 days) has passed since `nextReportAt`.
  - `nextReportAt` only advances while WiFi is up. If a closet's WiFi is down for 25 days (a switch left unplugged over winter break), the difference has gone negative by the time WiFi returns.
  - `networkEnsureConnected` logs `wifi: reconnected`, but `reportDue()` stays false until `millis()` wraps past it, up to about 49.7 days after the last attempt. The card stays Offline with WiFi up and no reboot.
- **Smallest fix:** track elapsed time instead of a deadline:

  ```cpp
  static bool reportedOnce = false;
  static unsigned long lastReportAt = 0;
  static bool reportDue() {
    return !reportedOnce || millis() - lastReportAt >= REPORT_INTERVAL_MS;
  }
  ```

  In `loop()`, set `reportedOnce = true; lastReportAt = millis();` in place of the `nextReportAt` line. Unsigned subtraction is correct at any age.

## 6. A WiFi drop triggers an immediate `WiFi.begin()`, which contradicts the module's own comments

- **Severity:** standards
- **Ticket:** 13 (WiFi reconnects in the loop)
- **Where:** `arduino/TemperatureAlarms/network.cpp:10-12`, `:78-82`; `network.h:8-9`
- **What goes wrong:** `lastReconnectAt` is only set by `startConnecting()`, so after hours of uptime it is old. On the first loop after a drop, `millis() - lastReconnectAt >= RECONNECT_EVERY_MS` is already true, and `begin()` fires right away. That restarts the core's auto-reconnect, which the comment says the code does "without racing it".
  - `network.h` says "at most once every few seconds", but the constant is 30 s.
  - The behavior still converges, so this is a mismatch between comment and code rather than an outage.
- **Smallest fix:** in the `if (wasConnected)` branch, set `lastReconnectAt = millis();` so the first manual `begin()` comes 30 s after the drop. Change `network.h` to "at most once every 30 seconds".

## 7. The README asks for Node.js 20, but the frontend's tests need 22.18 or newer

- **Severity:** spec gap
- **Ticket:** 14 (README describes local dev for both packages)
- **Where:** `README.md:80` at HEAD; `frontend/package.json:10`
- **What goes wrong:** `npm test` in `frontend/` is `node --test "src/**/*.test.ts"`. Glob arguments to `--test` arrived in Node 21, and running `.ts` without a flag arrived in 22.18 and 23.6. On Node 20, which the README allows, `npm test` fails, and the README says all three suites pass on a clean clone. Vite 7 also needs at least 20.19. Verified against Node's release history; this machine runs Node 24, so it was not executed on 20.
- **Smallest fix:** "You need Node.js 22.18 or newer". That also matches the `node:22-alpine` images.

## 8. Restore and migrate commands use `$DB_PASSWORD` without loading `.env`

- **Severity:** spec gap
- **Tickets:** 18 (backups and restore through `exec`, migrating an old database in), 14
- **Where:** `DEPLOYMENT.md:119-122`, `:135-138`, `:147` at HEAD
- **What goes wrong:** only the dump block (`:97`) runs `set -a; source .env; set +a`. An operator who opens a fresh shell to restore, the normal case after a failure, runs `mysql -uroot -p""`. The password is empty, MySQL can't prompt for one through `exec -T`, and the restore fails with access denied.
- **Smallest fix:** start each of those three code blocks with `set -a; source .env; set +a`.

## 9. The first-run walks never say which hostname to register

- **Severity:** spec gap
- **Tickets:** 14, 18 (the first-run walk)
- **Where:** `README.md:26-29`, `DEPLOYMENT.md:49-56` at HEAD
- **What goes wrong:** both say "add a Campus and a Device", then post as `ESP_000001` (README) or `ESP_A1B2C3` (DEPLOYMENT). An operator who registers any other hostname gets `report: 404` from the virtual Device, or a 404 instead of the commented `# 201` from curl. ADR 0005 even says "after registering the hostname in Settings".
- **Smallest fix:** "add a Campus and a Device with hostname `ESP_000001`", and the same with `ESP_A1B2C3` in DEPLOYMENT.md.

## 10. The bench watcher's rate limit can be dodged with a spoofed `X-Forwarded-For`

- **Severity:** standards
- **Ticket:** 18 (nginx proxying `/api/`)
- **Where:** `frontend/nginx.conf:23` with `backend/src/app.ts:15` (`app.set('trust proxy', true)`)
- **What goes wrong:** nginx appends to whatever `X-Forwarded-For` the client sent (`$proxy_add_x_forwarded_for`). With `trust proxy` set to `true`, Express takes the leftmost entry as `req.ip`. A client that sends a new random `X-Forwarded-For` on each request gets a fresh allowance from the 500-per-15-minutes `/api/` limiter (`app.ts:19-31`) every time. The 64-hex tokens make brute force pointless, which keeps this low, but the limiter does nothing as written.
- **Smallest fix:** `app.set('trust proxy', 'loopback, uniquelocal')` in `backend/src/app.ts`, outside this review's target. It trusts the stack's nginx and a host TLS proxy on the Docker bridge, and stops at the first public address. Leave `nginx.conf` as it is.

## 11. The README never mentions the open-network option from commit 3d67145

- **Severity:** standards
- **Tickets:** 13 (firmware README section), 19
- **Where:** `README.md:220`, `:238` at HEAD
- **What goes wrong:** `config.example.h:5-6` documents an empty `WIFI_PASSWORD` for an open, MAC-allowlisted network, but the README's config table and Flashing step 1 don't. An installer reading the README for a MAC-allowlist site has to find it in the header file.
- **The firmware change itself is correct.** `WIFI_PASSWORD[0] == '\0'` is well-defined on the string literal. Under core 3.1.2, `WiFi.begin(ssid)` passes a null passphrase, which selects the open-network auth threshold. The bench's `wifi: (re)?connected` check is unaffected.
- **Smallest fix:** in step 1, add "(leave the password `""` for an open network that admits Devices by MAC)".

## 12. `--inventory` help says "never modified", but the sheet is written back

- **Severity:** standards
- **Ticket:** 19 (reversed 2026-09-10: the sheet is the working record and is written back)
- **Where:** `arduino/bench.py:707`
- **What goes wrong:** `--help` tells the technician the sheet is never modified, while `Inventory.record` rewrites it after every board. A technician who trusts the help keeps the sheet open in Excel, and every row then reads `(sheet not updated: …)`.
- **Smallest fix:** `help="the inventory sheet (CSV with a MAC column); each board's outcome is written back to it"`.

## 13. `index.html` has no cache policy, so an upgrade can leave browsers on a blank page

- **Severity:** standards
- **Ticket:** 18 (nginx serving the built frontend)
- **Where:** `frontend/nginx.conf:32-41`
- **What goes wrong:** hashed assets are `immutable` for a year, but `index.html` goes out with only `Last-Modified`, so browsers may cache it heuristically. After `git pull && docker compose up -d --build`, the new image no longer has the old hashed bundle. A browser holding a stale `index.html` requests it and gets 404 from the asset location (no `try_files`), so the dashboard is blank until a hard reload.
- **Smallest fix:** `location = /index.html { add_header Cache-Control "no-cache"; }`. The SPA fallback's internal redirect lands on it too.

## 14. The database volume's name depends on the clone's folder name

- **Severity:** standards
- **Ticket:** 18 (persistent database; upgrades; moving to another machine)
- **Where:** `compose.yaml` (no top-level `name:`); `README.md:20-21` vs `DEPLOYMENT.md:24-25`, `:125` at HEAD
- **What goes wrong:** the volume is `<project>_db-data`, and the project name defaults to the folder name. The README clones into `Temperature-Alarms-React` and DEPLOYMENT into `temperature-alarms`. An operator who renames or moves the folder, or "copies the repo" as `:125` suggests, gets a silently empty database next to an orphaned volume.
- **Smallest fix:** add `name: temperature-alarms` at the top of `compose.yaml`, matching DEPLOYMENT.md's clone folder. Note in DEPLOYMENT.md's Upgrades section that a stack first started from a differently named folder keeps its old volume name, which `docker volume ls` shows.

## 15. The `web` container runs as root and has no healthcheck

- **Severity:** standards (ticket 18 only requires the backend to be non-root)
- **Where:** `frontend/Dockerfile:10`; `compose.yaml:67-75`
- **What goes wrong:** the `nginx:1.28-alpine` master process runs as root inside the published container. `docker compose ps` and `up --wait` treat `web` as ready as soon as it is running, even if nginx is failing every request.
- **Smallest fix (optional):** use `nginxinc/nginx-unprivileged:1.28-alpine` with `listen 8080` and `"${WEB_PORT:-80}:8080"`. Add `healthcheck: test: ["CMD", "wget", "-qO-", "http://127.0.0.1:8080/"]`. Leave it as it is if the ticket's scope is preferred.

## 16. The inventory sheet and the files the watcher writes next to it are not gitignored

- **Severity:** standards
- **Tickets:** 19, 01 (`.gitignore` covers secrets)
- **Where:** `.gitignore`; `README.md:277` at HEAD
- **What goes wrong:** the documented command runs from the repo root with the sheet beside it. `device_log - device_log.csv` (92 MACs), `device_log - device_log.bench.csv`, and a leftover `.csv.tmp` when Excel holds the file all show up as untracked, one `git add .` away from being committed.
- **Smallest fix:** add `*.bench.csv` and `*.csv.tmp` to `.gitignore`, and in README step 3 say "keep the sheet outside the repo".

## 17. CONTEXT.md's definition of Bench is narrower than what the watcher does

- **Severity:** standards
- **Ticket:** 19 ("`CONTEXT.md` defines Bench")
- **Where:** `CONTEXT.md:45`
- **What goes wrong:** "A Device on the Bench has passed its first Reading." But ticket 19 and README `:287` leave `FAIL bad sensor` and `FAIL did not boot` boards registered under Bench too. A reader of the glossary would wrongly treat everything on Bench as passed.
- **Smallest fix:** "…registered under between flashing and installation, whatever its bench verdict; the inventory sheet's `TESTED` column says which passed."

---

## Checked and found sound

- **DHT11 bad samples (13):** a NaN in either measure is skipped and logged with the exact text the README's bench checklist quotes. Calling `readHumidity` within 2 s of `readTemperature` returns the library's cached result, so the pair is always one sample. A failed read is never sent as zero.
- **HTTP timeouts (13):** `HTTPClient::setTimeout(10 s)` bounds both the connect and the read in core 3.1.2. `setReuse(false)` is set. No retry happens, because `nextReportAt` advances before the read. TLS uses `setInsecure()`, as ADR 0003 records.
- **`millis()` in `network.cpp`:** all of its comparisons use unsigned elapsed time, which is safe across the wrap. Only finding 5 is affected.
- **Bench watcher vs ticket 19:** the flags, the `ADMIN_TOKEN` environment variable, the start-up refusals (missing or stale binary, unset token, health, wrong token via the always-attempted Bench create), the polling and threads, the hostname derived from the MAC, the 409 read as `already`, the 921600 then 460800 fallback, the 70 s check, PASS and FAIL and STOP parsing against the firmware's actual serial strings (including `wifi: reconnected`), the log columns, and the replug path all match. The 52 tests pass.
- **Containers:** the backend image runs as `node` and contains no `.env` (`backend/.dockerignore`). The frontend build context excludes `.env*`, so no `localhost:3001` is baked in. Both images are two-stage on `node:22-alpine`, and the backend runtime installs `--omit=dev` only. The `db` and `api` healthchecks are sound, and neither service is published.
- **nginx SSE:** `proxy_buffering off`, `proxy_cache off`, `proxy_read_timeout 86400s`, HTTP/1.1, the backend's `X-Accel-Buffering: no`, a 25 s heartbeat (README `:181`), and `text/event-stream` left out of `gzip_types`. `^~ /api/` outranks the asset regex.
- **Same-origin CORS behind a TLS proxy:** `cors.ts` compares only the host, and both Caddy and the documented host nginx (`Host $host`) pass the public hostname through. Settings writes keep working once TLS is in front.
- **`.env.example` vs `compose.yaml`:** they match key for key. The three required secrets fail with a hint naming the missing one.
- **ADRs 0001–0005:** consistent with the files reviewed.

## Not covered

- **`backend/.env.example`:** this session's permission rules blocked reading it. I did not check README `:120`'s `--token dev-device` against it.
- **Image size:** I did not build the images, as instructed not to start the stack. Size was judged from the Dockerfiles only.

---

## Fixed

Fixed on 2026-10-04 by the reviewing worker; only `arduino/` and `CONTEXT.md` were touched. `python -m unittest arduino/test_bench.py`: 53 tests, OK, five runs in a row. **Firmware not compiled: arduino-cli is absent on this machine.** I re-read the diff instead: the new identifiers are file-static, the types are `bool` and `unsigned long`, and nothing else changes.

- **4 (fixed).** Test first: `SheetWriteBack.test_a_board_appended_to_the_sheet_still_counts_as_one_the_sheet_lacked_at_start` records an unlisted MAC, then reconciles. Before the fix it failed (`[] != ['ESP_1234AB']`).
  - `Inventory` now keeps `rows_at_start`, the boards as read before any write-back.
  - `reconcile` takes "never seen" and "not on list" against it, so an appended row neither hides its board from the summary nor shows up as a sheet row never seen.
  - `find()` still returns the appended row, so a replug reads `row N`.
- **5 (fixed).** `TemperatureAlarms.ino` drops the `nextReportAt` deadline and its signed comparison. It now uses `attemptedOnce` plus `lastAttemptAt` with `millis() - lastAttemptAt >= REPORT_INTERVAL_MS`.
  - Before the first attempt, a Reading is due as soon as WiFi is up, so the never-sent state never waits on the clock.
  - The other comparisons, in `network.cpp` (the boot wait and the reconnect interval), were already unsigned elapsed time. `lastReconnectAt` is always set before it is compared.
- **6 (fixed in code; the comments were right).** At the connected-to-lost transition, `network.cpp` now sets `lastReconnectAt = millis()`, so the first manual `WiFi.begin()` comes 30 s after a drop and the core's auto-reconnect gets the first try. After that it repeats at most once every 30 s.
  - `network.h` now says 30 seconds instead of "every few seconds".
  - The open-network branch in `startConnecting()` (3d67145) is untouched.
- **12 (fixed).** The `--inventory` help now reads "each board's outcome is written back to it".
- **17 (fixed).** `CONTEXT.md` Bench: a Device is held there between flashing and installation whatever its bench verdict. Failed boards stay registered too, and the sheet's `TESTED` column says which passed.

Still open: findings 1-3, 7-11, and 13-16 (docs, containers, `.gitignore`, backend), owned by other workers.

## Fixed (docs, `.gitignore`, deploy tooling; 2026-10-04, task_9359923275e3)

Only `DEPLOYMENT.md`, `README.md`, `.gitignore`, `deploy/`, and `.claude/skills/deploy/` were touched; `compose.yaml`, `backend/`, `frontend/`, and `arduino/` were not.

- **1 (fixed, reproduced before and after).** DEPLOYMENT.md's Caddyfile now has a `(plain_http)` snippet, imported by an `http://YOUR_DOMAIN` block and an `http://` catch-all. Each passes `/api/readings` through to `127.0.0.1:8080` and sends everything else to `https://YOUR_DOMAIN{uri}` with a 308.
  - Reproduction in `caddy:2-alpine` (`local_certs`, a stub upstream container in place of `127.0.0.1:8080`):
    - Old Caddyfile: a plain-HTTP POST to `/api/readings` got `308 → https://…/api/readings` by name, and `308` by IP.
    - New: 201 from the upstream by name and by IP. Browser GETs on HTTP got a 308 to `https://YOUR_DOMAIN/…`, including `/api/dashboard`. HTTPS GET and POST both reached the upstream.
  - A first attempt that listed `http://YOUR_DOMAIN, http://` in one block still redirected the domain: Caddy merged it into a catch-all and put its automatic redirect first. The doc now says to keep the two blocks apart.
  - The line about Devices "posting to the stack's own port" is rewritten: with the stack on loopback, the proxy is the only way in. README Flashing step 1 now says a Device flashed with `http://<host>` keeps reporting, by name or address, only through that route, because it cannot follow a redirect.
  - The nginx alternative in the TLS section points at manual steps 5 and 6, which give the same split.
- **2 (fixed, reproduced before and after).** Step 5 now uses a snippet, `/etc/nginx/snippets/temperature-alarms.conf` (root, `/api/`, `/`, assets), plus one `listen 80 default_server` server that includes it.
  - Step 6 runs `certbot certonly --nginx … --deploy-hook "systemctl reload nginx"`, so certbot never adds a redirect that would catch Devices. It then replaces the site with:
    - an HTTP server: `location = /api/readings` proxied, `location /` returning 301 to HTTPS;
    - a `listen 443 ssl http2` server with the two certificate lines and the same snippet.
  - Reproduction with `nginx:1.24-alpine`, using the blocks extracted from DEPLOYMENT.md:
    - The old template failed `nginx -t` with `[emerg] no "ssl_certificate" is defined for the "listen ... ssl" directive`.
    - The new step 5 passes `nginx -t`. The new step 6 passes too, with a self-signed pair at the letsencrypt paths.
    - Run live against a stub API on `localhost:3001`: HTTP POST `/api/readings` returned 201 by name and by IP; HTTP GET `/settings` and `/api/dashboard` returned 301 to HTTPS; HTTPS served `index.html` and proxied `/api/`.
  - `certbot certonly --nginx` itself was not run (it needs a public domain).
- **3 (fixed).** Migrating an old database in now opens by saying the conversion runs only on a first start against the database. A new step 0 runs `docker compose down -v` (back up first) when the stack has run before. First run gains "Migrating an old database? Stop here" before the first start. Step 4 also notes that a conversion longer than the healthcheck leaves `web` stopped once, and to rerun `up`.
- **7 (fixed).** README: "Node.js 22.18 or newer", with the reason.
- **8 (fixed).** The restore block and migration steps 3 and 6 (now a code block) start with `set -a; source .env; set +a`. The restore paragraph says why, and that `deploy/deploy.sh backup`/`restore` do it all.
- **9 (fixed).** README quick start: "add a Device with the hostname `ESP_000001`". DEPLOYMENT First run: "add a Device with the hostname `ESP_A1B2C3` (the commands below post as that hostname; any other gets a 404)".
- **11 (fixed).** README Flashing step 1: "leave the password `""` for an open network that admits Devices by MAC allowlist".
- **14 (fixed in docs and the deploy script, not in `compose.yaml`).** The coordinator ruled out a top-level `name:`, because existing installs would come up on a new, empty volume.
  - DEPLOYMENT.md (Docker Compose by hand, Upgrades, moving machines) explains `<project>_db-data`, the folder-name default, the orphaned volume `docker volume ls` shows, and pinning with `COMPOSE_PROJECT_NAME` in `.env`.
  - `deploy.sh` and `deploy.ps1` now write `COMPOSE_PROJECT_NAME` on first install: Compose's own pick (the folder name), or `-p`. A stack the script installed keeps its volume through a rename, and the script never rewrites the line.
  - README's quick start names its volume (`temperature-alarms-react_db-data`) and points here.
- **16 (fixed).** `.gitignore`: `/*.csv`, `/arduino/*.csv`, `*.bench.csv`, `*.csv.tmp`, checked with `git check-ignore` against `device_log - device_log.csv`, its `.bench.csv`, and its `.csv.tmp`. README Flashing a batch step 3: keep the sheet outside the repo.
- Also fixed with these, at the coordinator's request:
  - DEPLOYMENT.md notes that `web`'s nginx runs non-root on 8080 inside the container while the host port stays `WEB_PORT` (default 80).
  - The README API table gains the 422 ranges (-40..200 °F, 0..100 %) and History's 30,000-row cap with `truncated`.
  - README API and the TLS section explain `trust proxy` 1: behind a host proxy, every browser shares one 500-per-15-minutes allowance.
  - DEPLOYMENT.md Upgrades describes the migration lock (a second runner waits up to ten minutes, then gives up with `Another migration run still holds the lock`).

Still open from this report: 10 is fixed in the backend by `trust proxy` 1 (see backend.md finding 1). 13 and 15 belong to the container owner; 15 looks done in the working tree (unprivileged nginx on 8080, web healthcheck).
