# Final security review (master 4d9397b)

Scope: everything changed since the first review ended (`git diff 88f02b7 4d9397b -- backend frontend deploy compose.yaml compose.demo.yaml .env.example DEPLOYMENT.md`, 73 files), plus a brief re-check of the whole surface against `security.md`. Live checks ran on one stack, `ta-sec2` on 127.0.0.1:8098, and the backend test DB, both torn down afterwards. Raw evidence is in `.scratch/prodtest/runs/security-final/` (gitignored).

Docker Desktop was off when this started. The question about it (msg_bb4700a56124) went unanswered for over an hour, so I started it (escalation msg_928d6374c049). It is still running, with none of my containers left.

## Pass/fail

| Area | Check | Result | Evidence |
| --- | --- | --- | --- |
| TRUST_PROXY | `0.0.0.0/0`, `::/0`, hostnames, `;`, `$(…)`, backticks, `*`, newlines refused, fail closed | **FAIL → PASS** (fix 1): `1.2.3.4/00` and `::/00` got through, and nginx reads them as "trust everyone" | `real-ip-nginx.txt`: old gate + nginx → client's own XFF `6.6.6.6` became `$remote_addr` |
| TRUST_PROXY | Raw value never reaches the nginx config | **FAIL → PASS** (fix 1): the value was echoed into a `#` comment, so a newline could start a second line (nginx then failed to start, so it failed closed, but only by luck) | `real-ip.test.sh` |
| TRUST_PROXY | Spoofing with TRUST_PROXY empty | PASS | 100×401 then 429 with a new XFF each time (`http-checks.txt`); `rateLimit.test.ts` |
| TRUST_PROXY | Spoofing with TRUST_PROXY set to a proxy | PASS (first review's 01–08 logs; unchanged code path) | `security.md` TRUST_PROXY table |
| TRUST_PROXY | `gateway` with WEB_PORT open to the network | **FAIL → PASS** (fix 3): Docker's userland proxy delivers IPv6 clients (web is IPv4-only) from the gateway, so they could set their own address | `deploy.test.sh`, `deploy.test.ps1` |
| TRUST_PROXY | IPv6 | PASS after fix 1: IPv6 CIDR validated (groups, `::`, embedded IPv4, prefix ≤128); busybox ash in the web image passes the suite | `real-ip-nginx.txt` |
| Limiters | Header case, `/api/readings/`, `/API/…`, `%72eadings`, `//api`, `/api//`, `%2F`, HEAD, PUT/PATCH/DELETE | PASS: every spelling that reaches a route is refused once the allowance is spent; HEAD spends the read allowance; `//api/…` reaches no route | new `limiterBypass.test.ts` (5 tests) |
| Limiters | OPTIONS | NOTE: answered 204 by CORS before the limiter; reaches no route and no DB | `limiterBypass.test.ts` |
| Limiters | Store memory bounded and keyed sanely | PASS / note: about 121 bytes per key, swept every window; IPv6 keyed per /56. 1 M distinct sources in 15 min ≈ 116 MiB | `store-mem.txt` |
| Limiters | Monotonic store across restarts | PASS as designed: in memory, so a restart forgets counts, as MemoryStore did; one api (ADR 0001) | `monotonicStore.test.ts` |
| Limiters | Wrong-token cap: right token never counted; 100 per 15 min per address | PASS | live: 100×401, then 429 even with the right token from that address; the right token from another address isn't refused (`http-checks.txt`); `security.test.ts` |
| Health | No writes | PASS: passive (`SELECT 1` plus the in-memory outcome of the latest ingest). No table, no row | `routes/health.ts`, `ingestHealth.ts` |
| Health | Cannot load the DB | PASS: one `SELECT 1`, under the 6,000/15 min read limit (test: `GET /api/health` → 429 once spent) | `limiterBypass.test.ts` |
| Health | No internal error text | PASS: 503 bodies are fixed strings; the error goes to the log only. `ingest.failed()` only runs behind the Device token | `health.test.ts` |
| deploy | Restore drop-and-recreate needs the typed confirmation, right project, safety backup | PASS: no `--confirm` → refused; `--confirm temperature-alarms` on project ta-sec2 → refused; confirmed → safety backup first, then restored, api healthy | `restore.txt` |
| deploy | Backup permissions 0600, dir 0700 | PASS on Linux (first review, CT); on Windows/NTFS Git Bash shows 644/755 because chmod is a no-op there | `restore.txt` |
| deploy | No secrets in process arguments | **FAIL → PASS** (fix 4): the db healthcheck ran `mysqladmin -p"$MYSQL_ROOT_PASSWORD"` every 5 s, visible in the host's `ps`. DEPLOYMENT.md's manual commands put `-p"$DB_PASSWORD"` on the host command line. deploy.sh/ps1 were already fine (`MYSQL_PWD` inside the container) | `compose.yaml`, `mysqladmin-ping.txt` |
| deploy | `info --reveal` | PASS: masked (first/last 4 hex of 64) unless `--reveal` or an interactive yes | `deploy.sh do_info` |
| deploy | `--host` / servers file: ssh option injection | **FAIL → PASS** (fix 2): `--host -oProxyCommand=…` or a servers-file line starting with `-` reached ssh as an option. OpenSSH 9.x happened to refuse the next argument as a hostname; 8.x (Ubuntu 22.04) would run the command locally | `deploy.test.sh`, `deploy.test.ps1` |
| deploy | Servers file quoting | PASS: one field per line, `#` comments; every pass-through argument is `squote`d for the remote shell | `remote_one` |
| deploy | bootstrap: HTTPS key fetch, no `curl \| sh` | PASS: key fetched with `curl -fsSL https://download.docker.com/…/gpg`, apt `signed-by`, `rpm --import` over HTTPS. No pipe-to-shell anywhere. Fingerprint not pinned (decision D4) | `deploy.sh` 781–803 |
| Containers | api/web read-only, cap_drop ALL, no-new-privileges, non-root | PASS: api uid 1000 `node`, web uid 101; db cap_drop ALL + 5 caps, no-new-privileges | `containers.txt` |
| Containers | MySQL: app user not root; root only for backups | **FAIL → PASS** (fix 5): `root@'%'` existed with the app's own password, so the api container logged in as MySQL root over the network. Now `root@localhost` only (new volumes); existing volumes need decision D1 | `containers.txt`, `root-host.txt` |
| Containers | MySQL and api not published | PASS: only web, on the WEB_PORT binding | `containers.txt` |
| Containers | Images pinned by tag; base images current | PASS / decision D3: `mysql:8.4`, `node:22-alpine`, `nginxinc/nginx-unprivileged:1.28-alpine`; deploy runs `build --pull`, so patches arrive on each deploy | |
| Deps | `npm audit --omit=dev` backend | **FAIL → PASS** (fix 6): critical GHSA-jqcg-44mw-7w3h, proxy-addr 2.0.7. Not exploitable here (`trust proxy` is a hop count, not a subnet), but bumped to 2.0.8 | `audit-backend.txt` |
| Deps | `npm audit --omit=dev` frontend | PASS: 0 | `audit-frontend.txt` |
| Frontend | CSP `style-src 'unsafe-inline'` removable? | NO, needed: the bundle creates `<style>` elements from Radix (react-remove-scroll-bar, behind Select/Dialog), motion (popLayout), React 19 style hoisting, and shadcn's `ChartStyle` (History). React/Radix/Recharts `style` props go through CSSOM, which CSP does not govern, and no `setAttribute("style")` exists. Decision D5 | bundle grep, `frontend/dist/assets` |
| Frontend | XSS sinks with the Admin token in localStorage | PASS: one `dangerouslySetInnerHTML`, `ChartStyle`, fed only from History's constant chart config; no `innerHTML`/`eval`/`document.write`; user strings render as text; script-src `'self'` | grep of `frontend/src` |
| Frontend | 404 page and skip link | PASS: NotFound renders `pathname` as React text; the skip link's href is the constant `#main`; `/no/such/<script>…` is served with the CSP | `http-checks.txt` |
| Frontend | Token never in a URL | PASS: only the `Authorization` header (`api.ts:56`) | |
| Logs | No tokens or bodies | PASS: 0 hits for any of the three secrets or `Bearer` in all three services' logs after wrong- and right-token posts | `http-checks.txt` |
| Logs | Rotation | PASS: json-file, 10m × 3 on db, api, web, demo | `containers.txt` |
| Migration 0006 | No input in DDL; online | PASS: constant identifiers, `ALGORITHM=INPLACE, LOCK=NONE` | |
| Regression vs. first review | Headers, Server version hidden, X-Powered-By, CORS, SQLi, CRLF, body limits, SSE caps 60/400 | PASS: still covered by `security.test.ts`; headers live | `backend-test.log` |
| Suites | backend `npm test` / `typecheck` | PASS: 257/257, clean | `backend-test.log` |
| Suites | frontend `lint` / `typecheck` / `test` / `build` | PASS: all exit 0 | `frontend-*.log` |
| Suites | shellcheck 0.10 (deploy.sh, deploy.test.sh, real-ip.sh, real-ip.test.sh) | PASS: 0 findings | `shellcheck.txt` |
| Suites | `real-ip.test.sh` (Git Bash and busybox), `deploy.test.sh`, `deploy.test.ps1` (pwsh 7 and PS 5.1) | PASS | |

## Findings, by production impact

No blockers.

### Should fix (all fixed here)

**S1. TRUST_PROXY `/00` trusts every address.** Both `real-ip.sh` and `deploy.sh`/`deploy.ps1` refused only the literal `*/0`. Repro: `TRUST_PROXY=1.2.3.4/00` passed the gate; nginx 1.28 loads `set_real_ip_from 1.2.3.4/00` with only a warning, and a client sending `X-Forwarded-For: 6.6.6.6` got `$remote_addr=6.6.6.6`. That spoofs every per-address limit: the SSE cap, the read and change limits, and the wrong-token cap. It needs an operator to type it, so it is a should-fix, not a blocker. Fix 1.

**S2. MySQL root reachable over the network with the app's password.** `MYSQL_ROOT_PASSWORD` is `DB_PASSWORD` and the image's default is `root@'%'`. Repro: from the api container, `mysql2.createConnection({host:'db', user:'root', password: DB_PASSWORD})` returned `root@%`. A code-execution bug in api would become full MySQL root (FILE, every schema, user management). Fix 5 covers new volumes; existing installs need D1.

**S3. `TRUST_PROXY=gateway` with WEB_PORT open.** web listens on IPv4 only, so Docker's userland proxy forwards IPv6 clients, and on hosts without iptables NAT all clients, from the network's gateway address. That is exactly the address `gateway` trusts, so such clients could write their own `X-Forwarded-For`. This is documented Docker behaviour; it was not reproduced on Docker Desktop, whose own VM networking differs. DEPLOYMENT.md already said to use `WEB_PORT=127.0.0.1:8080`, but nothing enforced it. Fix 3.

**S4. Root password in a process argument every 5 s.** The db healthcheck ran `mysqladmin -p"$MYSQL_ROOT_PASSWORD"`; container processes show in the host's `ps` to any user. The DEPLOYMENT.md commands did the same on the host itself, and in shell history. Fix 4.

**S5. ssh option injection through `--host` / servers file.** Repro: `deploy.sh status --host "-oProxyCommand=touch /tmp/x"` handed the value to ssh as an option. It is the operator's own input, but a shared `servers.txt` makes it a local code-execution path. Fix 2.

**S6. proxy-addr GHSA-jqcg-44mw-7w3h (critical).** Not exploitable with `trust proxy 1`; bumped anyway. Fix 6.

### Notes

- N1. OPTIONS preflights are answered by the cors middleware before any limiter. Cheap (no route, no DB), but uncounted.
- N2. The SSE total cap of 400 can be filled by 7 addresses × 60. That is the deliberate trade-off from the load review: a hard ceiling protects nginx's 1024 worker connections, at the cost of a denial-of-service path for anyone holding 7+ addresses.
- N3. Rate-limit store: about 121 B per key; memory grows only with distinct source addresses per 15 minutes. Behind nginx (IPv4-only, IPv6 collapsed to the gateway), not a practical memory exhaustion.
- N4. `npm audit` (dev dependencies included, backend): brace-expansion, braces, minimatch, picomatch, and diff advisories in nodemon and test tooling. Not in the image (`npm ci --omit=dev`).
- N5. TRUST_PROXY still accepts short prefixes like `/1`. Two `/1`s cover everything, but that is an explicit operator choice, and DEPLOYMENT.md says never to list ranges ordinary clients use.
- N6. A restore feeds an operator-chosen dump to MySQL as root; a hostile dump could touch other schemas. Only restore your own backups.

## Fixes made (test-first)

| # | Change | Test (red before, green after) |
| --- | --- | --- |
| 1 | `frontend/real-ip.sh`: strict IPv4 (octets ≤255) and IPv6 (group count, one `::`, embedded IPv4) validation; prefix numeric 1–32 or 1–128, so `/0` in any spelling is refused; `set -f`; the raw value no longer written into the config; `REAL_IP_CONF` override for tests | `frontend/real-ip.test.sh` (new): 10 failures before, 0 after; also passes under the image's busybox |
| 2 | `deploy.sh` `valid_host` / `deploy.ps1` `Test-SshHost`: a host may not start with `-` or carry characters outside `A-Za-z0-9_.@:%+-`; checked for `--host` and every servers-file line before any ssh | `deploy/deploy.test.sh`, `deploy/deploy.test.ps1` (new), including end-to-end `--host -oProxyCommand=…` and a servers file |
| 3 | `deploy.sh` `gateway_exposed` / `deploy.ps1` `Test-GatewayExposed`: preflight fails `TRUST_PROXY=gateway` unless WEB_PORT is `127.x`/`[::1]`/`localhost`; DEPLOYMENT.md TRUST_PROXY table says why | same test files, 7 cases each |
| 1b | `deploy.sh`/`deploy.ps1` TRUST_PROXY validation: the same algorithm as real-ip.sh, and one line only | same test files; the old deploy.ps1 fails 9 of them |
| 4 | `compose.yaml` db healthcheck: `mysqladmin ping -h 127.0.0.1 -uhealthcheck --silent`, no password (ping exits 0 on access denied and 1 with no server: `mysqladmin-ping.txt`); DEPLOYMENT.md's six manual MySQL commands now use `sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql…'` inside the container (and no longer need `.env` sourced) | live: db healthy on a fresh volume; backup and restore through deploy.sh ok |
| 5 | `compose.yaml` db: `MYSQL_ROOT_HOST: localhost` | live, fresh volume: users are `root@localhost` and `temperature@%`; root from api → `ER_ACCESS_DENIED_ERROR` (`root-host.txt`) |
| 6 | `backend/package-lock.json`: proxy-addr 2.0.7 → 2.0.8 | `npm audit --omit=dev`: 0; 257/257 tests |
| — | `backend/test/limiterBypass.test.ts` (new): path, case, method, and encoding variants; HEAD; OPTIONS; right token unaffected | 5/5 (no code change needed) |

## Decisions for the owner

- **D1. Existing installs keep `root@'%'`.** `MYSQL_ROOT_HOST` applies only when the volume is first created. To close S2 on a running install, run once: `docker compose exec db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -e "DROP USER IF EXISTS \`root\`@\`%\`"'`. deploy.sh could do this on every `deploy`; it is safe, since nothing in the stack uses root over TCP and deploy.sh uses the socket. Say if you want it automated.
- **D2. Separate root password.** Root and the app share `DB_PASSWORD`. A fourth secret (`DB_ROOT_PASSWORD`, generated by `install`) would remove the shared secret entirely. It changes `.env` and both deploy scripts; not done.
- **D3. Digest pinning.** Images are pinned by tag (`mysql:8.4`, `node:22-alpine`, `nginx-unprivileged:1.28-alpine`), and `deploy` runs `build --pull`, so security patches arrive with each deploy. Digests would make builds reproducible and immune to a tampered tag, but then patches arrive only when someone bumps the digest (Renovate/Dependabot). For a district box deployed by hand, I recommend tags plus `--pull`, as now.
- **D4. Docker GPG key fingerprint.** bootstrap trusts the key it fetches over HTTPS (Docker's own instructions do the same). Pinning the fingerprint (`9DC8 5822 9FC7 DD38 854A E2D8 8D81 803C 0EBF CD88`) and checking it with `gpg --show-keys` would survive a compromised download host, but needs gnupg on minimal images.
- **D5. CSP `'unsafe-inline'` for styles.** Needed today (see the table). Removing it means nginx minting a per-request nonce (`sub_filter` into index.html, plus `__webpack_nonce__`/motion `nonce` wiring) and dropping `ChartStyle`'s inline `<style>`. Script injection is already closed (`script-src 'self'`, no HTML sinks), so I recommend leaving it.
- **D6. Docker Desktop on this host** was started by this review and is still running (no containers of mine). Stop it if the host needs the memory.

## Files modified

- `frontend/real-ip.sh`, `frontend/real-ip.test.sh` (new)
- `deploy/deploy.sh`, `deploy/deploy.ps1`, `deploy/deploy.test.sh` (new), `deploy/deploy.test.ps1` (new)
- `compose.yaml`
- `DEPLOYMENT.md`
- `backend/package-lock.json`, `backend/test/limiterBypass.test.ts` (new)
- `.scratch/prodtest/security-final.md`

The mode-only changes on `deploy/deploy.sh` and `frontend/real-ip.sh` were already in the worktree when this review started.

## Owner decisions applied (2026-10-06)

Agent: decisions. The owner's choices from this review and `security-firmware.md`, applied before the production install and flashing day: firmware D1 (a), firmware D2 (b), server D1 and D2 together, S3's root `*.bin`, the firmware reviewer's two DEPLOYMENT.md notes, and D6. Live checks ran on one stack, `ta-dec` on 127.0.0.1:8098, torn down afterwards with its volume; the backend test DB was started for this and taken down. Evidence and drivers are in `.scratch/prodtest/runs/decisions/` (gitignored): `live.sh` and its logs, the suite logs, `shellcheck.txt`.

### Pass/fail

| Decision | Check | Result | Evidence |
| --- | --- | --- | --- |
| Firmware D1, final | HTTPS to `https://YOUR_DOMAIN` (the dashboard's own name, nginx and certbot), with the certificate checked against Let's Encrypt's roots and the hostname, so no server-side key change ever needs a reflash (the owner rejected a pinned key for that reason). Firmware: `roots.cpp`/`roots.h` (ISRG Root X1, X2, YE, YR in PROGMEM; X1 and X2 fingerprints checked against known values, YE and YR as published on letsencrypt.org), `setTrustAnchors` plus the time from the server's `Date` header (no time server needed), fail closed without roots or time; compiled with core 3.1.2 (IRAM 92%, unchanged; flash 370,824 B; static RAM 28,964 B). Docs: ADR 0001 and 0003 updates, README "Transport for production boards" checklist, DEPLOYMENT.md Security and TLS step 6, `config.example.h`; bench.py's server-unreachable stop now mentions the certificate and the time | DONE; not run on a board (no hardware) | `runs/decisions/fw/compile.log` |
| Firmware D2 (b) | Either token accepted; a third refused | PASS | `tokenRotation.test.ts`; live `rotate.log` |
| | Constant time, no early exit: both compared every time, as SHA-256 digests with `timingSafeEqual`, so not even length leaks | PASS (by construction; `auth.ts`) | |
| | Wrong-token cap counts only tokens matching neither: 105 boards on the previous token from one address all 201; 100 third-token guesses then 429, and then the current and previous tokens are 429 from that address too | PASS | `tokenRotation.test.ts` |
| | Log once per Device per hour, by hostname, never a token; unregistered hostnames neither logged nor listed | PASS | test with a pinned clock; live: api log names `ESP_0DEC0A`, no token in any service log |
| | `GET /api/devices/rotation` behind the Admin token: `{active, since, previous, unheard}`; Device tokens get 401 | PASS | tests; live list showed A on previous, C unheard |
| | Settings line listing those Devices (shown only with the Admin token, only while a rotation is active) | DONE; logic unit-tested, not looked at in a browser | `lib/rotation.test.ts`, `RotationLine.tsx` |
| | Refuses to start if `DEVICE_TOKEN_PREVIOUS` equals `DEVICE_TOKEN` or `ADMIN_TOKEN`, never printing it; short previous token warned about | PASS | `config.test.ts` (2 new tests + 1 extended) |
| | `rotate-device-token` in deploy.sh and deploy.ps1: moves the token, generates a new one, recreates the stack, prints the masked `config.h` line and the steps; refuses a second rotation; rolls `.env` back if api does not come back | PASS | `deploy.test.sh`, `deploy.test.ps1` (29 failures against HEAD's deploy.sh) |
| | `--finish`: refuses while api lists Devices (naming them), refuses when api cannot answer, clears and recreates once empty; `--force` needs the typed confirmation. The list is read inside api with api's own `ADMIN_TOKEN`, so no token is on any command line | PASS | same tests; live `finish-refused.log`, `finish.log` |
| | Live, bash: rotate, old and new both 201, third 401, finish refused naming A and C, reflash A and C, finish, old 401, new 201 | PASS | `live.sh rotate` |
| | Live, Windows PowerShell 5.1: `deploy.ps1 rotate-device-token` and `--finish` (the JS reached node intact through 5.1's argument passing) | PASS | `live.sh ps` |
| Server D2 + D1 | `DB_ROOT_PASSWORD`: generated by `install` in both scripts (CSPRNG, 64 hex, all four secrets different) | PASS | tests; live fresh install |
| | Used only by db's `MYSQL_ROOT_PASSWORD` (backup and restore use it inside db; the healthcheck uses no password); api's environment has none | PASS | `compose.yaml`; live `printenv` in api |
| | Compose refuses to start without it, naming it and the fix | PASS | `error while interpolating ... Set DB_ROOT_PASSWORD in .env (...)` |
| | `info` masks it (and `DEVICE_TOKEN_PREVIOUS`) | PASS | tests; live `fresh-info.log` |
| | Fresh install: users `root@localhost` and `temperature@%` only; root logs in inside db with `DB_ROOT_PASSWORD`, not with `DB_PASSWORD`; api cannot log in as root with either; backup and restore work | PASS | `live.sh fresh` |
| | Existing install, volume made by master (3d67145, `root@'%'` with the app password, and api logging in as root over the network, reproduced): `deploy` without `--confirm` explains and changes nothing; with it, backs up, drops `root@'%'`, sets the new root password (SQL and password on stdin, never argv), writes `.env`, deploys; data kept; api can no longer log in as root; a second deploy does nothing more | PASS | `live.sh master`, `live.sh migrate`, `migrate-deploy.log` |
| | Until that deploy, other actions (backups included) keep working on the old shared password, with a warning; `install` never generates a root password the volume does not have | PASS | tests |
| | MySQL refusing the change leaves `.env` as it was (only a login with the new password counts as success) | PASS | tests (fake db failing) |
| Loose ends | Root `.gitignore` `*.bin`; no tracked or needed `.bin` matched | DONE | `git check-ignore -v TemperatureAlarms.ino.bin`; `git ls-files '*.bin'` empty |
| | DEPLOYMENT.md: the open-SSID-on-the-same-VLAN note and the `bench.py --server https://` note | DONE | Security section |
| | D6: Docker Desktop left running | DONE | |
| Suites | backend `npm test` / `typecheck` | PASS: 266/266 (257 + 9 new), clean | `backend-test.log` |
| | frontend `lint` / `typecheck` / `test` / `build` | PASS: all exit 0, 52 tests (3 new) | `frontend-*.log` |
| | shellcheck 0.11.0 (deploy.sh, deploy.test.sh, real-ip.sh, real-ip.test.sh) | PASS: 0 findings | `shellcheck.txt` |
| | `deploy.test.sh` (Git Bash), `deploy.test.ps1` (pwsh 7 and PS 5.1) | PASS | `deploy-test-*.log` |
| | `python -m unittest arduino/test_bench.py` | PASS: 55 | `bench.log` |

### Findings, by production impact

No blockers.

**`.env.example` (follow-up, done).** Blocked at first by a permission rule on `.env*` files; after the user lifted it, `.env.example` now lists the four secrets and `DEVICE_TOKEN_PREVIOUS`, and `backend/.env.example` carries a commented `DEVICE_TOKEN_PREVIOUS`. The deploy tests pass again with it (Git Bash, pwsh 7, PS 5.1).

**Note: the rotation list is in api's memory.** After an api restart every Device is "unheard" until its next Reading (30 s), so `--finish` straight after a restart refuses. That is the safe direction, and DEPLOYMENT.md says so. A Device that is dead for good keeps `--finish` refusing until it is deleted in Settings or `--force` is used.

**Note: a lost board's token stays valid until `--finish`.** README and ADR 0003 say to keep the window as short as the reflash allows.

**Note (superseded by the HTTPS decision): the pre-flash health check behind a TLS proxy.** The coordinator's check "`curl http://the old production hostname/api/health` returns 200 with no redirect" holds with the stack on port 80. Behind DEPLOYMENT.md's TLS proxy, plain HTTP passes only `/api/readings` and redirects the rest (308), so the docs give the equivalent there: `curl -i -X POST http://the old production hostname/api/readings` answers 401, not a 30x.

**Note: the deploy skill** (`.claude/skills/deploy/`, not owned here) does not know `rotate-device-token` yet; the scripts' `--help` and DEPLOYMENT.md do.

**Not done by hand:** the manual root-password procedure in DEPLOYMENT.md mirrors what `deploy` runs (proven live), but its exact commands were not typed in on a stack.

### Changes

| File | Change | Covered by |
| --- | --- | --- |
| `backend/src/auth.ts` | Digest comparison for every token; `deviceTokenMatcher` (current, previous, or neither, without branching on which); `requireDeviceToken` records which in `res.locals`; `hasDeviceToken` takes either | `tokenRotation.test.ts`, `security.test.ts`, `limiterBypass.test.ts` |
| `backend/src/config.ts` | Optional `DEVICE_TOKEN_PREVIOUS`; refused when equal to either token; short-token warning | `config.test.ts` |
| `backend/src/tokenRotation.ts` (new), `deps.ts`, `app.ts` | Per-Device latest token since start, hourly log line by hostname | `tokenRotation.test.ts` |
| `backend/src/routes/readings.ts` | Notes the token after a Reading for a registered Device commits | same |
| `backend/src/routes/devices.ts` | `GET /api/devices/rotation` (Admin) | same |
| `backend/src/index.ts` | Logs at start that a rotation is under way | live |
| `frontend/src/api.ts`, `types.ts`, `lib/rotation.ts` (new), `components/settings/RotationLine.tsx` (new), `pages/Settings.tsx` | The Settings rotation line, an admin GET | `lib/rotation.test.ts` |
| `compose.yaml`, `compose.demo.yaml` | `MYSQL_ROOT_PASSWORD: ${DB_ROOT_PASSWORD:?...}`; api gets `DEVICE_TOKEN_PREVIOUS` | live |
| `deploy/deploy.sh`, `deploy/deploy.ps1` | Fourth secret; legacy-root detection and one-time migration with typed confirmation and a backup first; `rotate-device-token` with `--finish`/`--force`; `info` lines; menu entries; `Invoke-DcStdin` (PowerShell does not pass a function's pipeline input to a native command on its own) | `deploy.test.sh`, `deploy.test.ps1`, live |
| `deploy/deploy.test.sh`, `deploy/deploy.test.ps1` | End-to-end against a fake docker: install, info, rotate, finish (refused, forced, failing api, clean), the legacy migration (refused, MySQL refusing, done, idempotent), no secret on any docker command line | themselves |
| `README.md` | Quick start's four secrets; API table row and the Readings row; Flashing step 1; new "Transport for production boards"; rotation procedure | |
| `DEPLOYMENT.md` | Action table (install, deploy, info, rotate-device-token); setup table (four secrets); Upgrades note; new "Separate MySQL root password" (automatic and by hand); new "Rotating the Device token"; Security VLAN bullet as a prerequisite with the two firmware-review notes; manual-install env row | |
| `CONTEXT.md` | "Device token rotation" | |
| `docs/adr/0001`, `docs/adr/0003` | Update 2026-10-06 sections | |
| `.gitignore` | `*.bin` beside the firmware-secrets line | `git check-ignore` |
| `.env.example`, `backend/.env.example` | `DB_ROOT_PASSWORD` (four secrets), `DEVICE_TOKEN_PREVIOUS` | `deploy.test.sh`, `deploy.test.ps1` |
| `arduino/TemperatureAlarms/config.example.h`, `reporter.cpp`, `roots.h`, `roots.cpp` (new), `arduino/bench.py` | `SERVER_URL "https://YOUR_DOMAIN"`; certificate checked against Let's Encrypt's roots, fail closed; the bench stop message (at the owner's request; outside the original ownership) | compile with core 3.1.2; `test_bench.py` 55/55 |

### Over-the-air firmware (2026-10-06, the owner's follow-up)

So that no server-side change, and almost no firmware change, needs a visit to every closet, boards now update themselves (ADR 0007): an hourly `GET /api/firmware` over the certificate-checked HTTPS, with the Device token; only builds signed with the district's RSA key are installed (the core's signing: `public.key` in the sketch folder at build time, checked on the board). Publishing is the Settings Firmware tab or `deploy.sh publish-firmware`, staged to named Devices first. Tests: `backend/test/firmware.test.ts` (18 HTTP and CLI tests: 304/200, MD5, staging, older version refused, unsigned refused, Basic and Bearer Device token, shared wrong-token limit, 401 for Admin-only routes, 413 over 1 MB), `frontend/src/lib/firmware.test.ts` (3), deploy tests for the three actions in both shells. Firmware compiled unsigned and signed with core 3.1.2 (signed: IRAM 92%, flash 396,288 B; the server's image check accepts the real `.bin.signed` and refuses the unsigned `.bin`). Not yet run on a board: the first real update is the bench step of the README's procedure. The district's domain is out of the repo (`YOUR_DOMAIN` throughout); it lives only in each build's gitignored `config.h`.
