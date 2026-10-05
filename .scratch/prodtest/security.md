# Production security review

Scope: the stack as `compose.yaml` runs it behind nginx. That covers backend/src, frontend/src, frontend/nginx.conf, both Dockerfiles, compose.yaml, deploy/, and the firmware's use of the Device token.

Evidence is under `.scratch/prodtest/runs/security/`. The live checks ran on a `ta-sec` stack on :8098, built from this worktree with my backend fixes, and was torn down afterwards (`down -v --rmi local`). The backend tests ran against the shared test DB on :3307. I started that DB because it was down, and left it up for the other agents.

## Pass/fail

| Area | Check | Before | After | Evidence |
|---|---|---|---|---|
| Tokens | Constant-time comparison (`timingSafeEqual`, length checked first) | PASS | PASS | `src/auth.ts:10` |
| Tokens | Never logged (api/web/db logs searched for both tokens, DB password, 600 guesses) | PASS | PASS | 0 hits; `runs/security/http-checks.txt` |
| Tokens | Never echoed in errors (401 is always `{"error":"Not authorised"}`) | PASS | PASS | test `a refused token is never echoed` |
| Tokens | Admin token ≠ Device token enforced | FAIL | PASS (fix 4) | config test |
| Tokens | Admin token in localStorage: XSS exposure | NOTE | NOTE, mitigated by CSP once routed | finding S3 |
| Tokens | Device token over plain HTTP | NOTE (by design) | NOTE | finding N1 |
| Rate limit | Per Device: 20/min keyed by hostname | PASS | PASS | existing readings test |
| Rate limit | General /api/: 500/15 min, `trust proxy 1`; rotated X-Forwarded-For does not escape it | PASS | PASS | `rateLimit.test.ts`; live: XFF rotated, first 429 at request 501 |
| Rate limit | Admin token brute force | 2,000 guesses/h/host | same, acceptable | finding N2 |
| Rate limit | Device token brute force on POST /api/readings | **FAIL: unlimited** | PASS: 100/15 min/address | fix 2; live: 401×100, then 429 |
| Rate limit | IPv4-mapped IPv6 bypass of express-rate-limit (GHSA-46wh-pxpv-q5gq) | FAIL | PASS (bumped) | fix 5 |
| Input | SQL injection: every query param (campus, order, tz, from, to, date) and path id | PASS | PASS | test `SQL in every query parameter…`; all statements parameterised |
| Input | Names with SQL, markup, emoji, RTL stored verbatim; 50-emoji closet refused 422 (not a 500) | PASS | PASS | tests; columns are utf8mb4 |
| Input | XSS via Closet/Campus names in the UI | PASS | PASS | headless Chromium: payload shown as text on every page, 0 injected elements, 0 alerts |
| Input | Oversized body | PASS (api 413 at 100 KB, nginx 413 at 1 MB) | PASS | test; live |
| Input | Header injection (CRLF) | PASS | PASS | no response header echoes input; Node rejects CRLF in header values |
| HTTP | CSP, nosniff, Referrer-Policy, frame-ancestors, Permissions-Policy | **FAIL: none set** | route nginx diff | `http-checks.txt`; finding S1 |
| HTTP | Server version hidden | FAIL: `Server: nginx/1.28.2`, also on error pages; `X-Powered-By: Express` | api fixed (fix 1); nginx: route diff | |
| HTTP | CORS | PASS | PASS | foreign Origin → 403, no ACAO; same origin → ACAO echoed; preflight from a foreign origin → 403 |
| HTTP | Error pages leak stack traces | PASS | PASS | 500 is generic (test); malformed JSON → 400 generic |
| HTTP | SSE open streams per IP | **FAIL: unlimited** | PASS: 20/address, 400 total | fix 3; live: 20×200, then 429; a slot frees on close |
| Secrets | .env permissions | PASS | PASS | deploy.sh `lock_env` chmod 600; `umask 077` writes |
| Secrets | Nothing secret in images (`docker history`, image fs, .dockerignore) | PASS | PASS | 0 hits; `.env*` ignored in both contexts; no .env in /app |
| Secrets | Backups' file permissions | PASS | PASS | dir 700, `umask 077` dump; cron log in the same 700 dir |
| Secrets | deploy.sh token handling (`info --reveal`) | PASS | PASS | masked by default; full only with `--reveal` or an interactive yes; generated with `openssl rand -hex 32` and never printed |
| Deps | `npm audit --omit=dev` backend | **FAIL: 4 high, 2 moderate** | PASS: 0 | fix 5 |
| Deps | `npm audit --omit=dev` frontend | **FAIL: 8 high** | PASS: 0 | fix 5 |
| Deps | Base images | NOTE | NOTE | finding S5 |
| Containers | Non-root | PASS (api `node`, web uid 101; db entrypoint drops to mysql) | PASS | `docker inspect` |
| Containers | Read-only root fs | FAIL (not set) | feasible, proven; route compose diff | finding S4 |
| Containers | cap_drop / no-new-privileges | FAIL (not set) | feasible, proven; route compose diff | finding S4 |
| Containers | MySQL not published | PASS | PASS | no port bindings on db or api |

## Findings, by production impact

No blockers.

### Should fix

**S1. nginx sends no security headers and shows its version.** (Infra; diff below.)
Repro: `curl -sD- -o /dev/null http://host/`. The response has `Server: nginx/1.28.2` and none of CSP, X-Content-Type-Options, Referrer-Policy, X-Frame-Options/frame-ancestors or Permissions-Policy. Error pages print `nginx/1.28.2`.
Impact: the page can be framed (clickjacking the Settings page), and there is no second line of defence against XSS. That matters more here than usual because the Admin token sits in localStorage (S3).
Proven: I ran the proposed conf on the `ta-sec` stack. Every header lands on the page, the assets and `/api/`. Headless Chromium visited `/`, `/campuses`, `/incidents`, `/settings`, `/history/1` and a 404 with **0 CSP violations and 0 console errors** (`runs/security/csp-browser.txt`).
Gotcha the diff handles: `add_header` inside a location replaces every server-level one. The two locations that set Cache-Control therefore repeat the block.

**S2. POST /api/readings let anyone guess the Device token without limit.** (Fixed: fix 2.)
The general /api/ limiter skips this route, and the per-Device limiter sits after the token check. Wrong-token requests were therefore never counted.
Repro before the fix: 110 wrong tokens from one host all came back 401. After the fix, 100 come back 401 and the rest 429, even with X-Forwarded-For and the hostname rotated (`runs/security/rate-limits.txt`). Once an address is over the limit, the right token is refused too; otherwise the 429 would tell a guesser which guess was right.
A campus of boards with the *right* token behind one NAT is never counted (test with 105 boards on one address). Trade-off: boards with a *wrong* token retry 30 times per 15 minutes each, so four of them behind one NAT would lock out their good neighbours for up to 15 minutes. That is a misconfiguration the operator would see as 401s on those boards anyway.

**S3. Admin token in localStorage: any XSS takes it.** (Note on design; S1 is the mitigation.)
Today there is no XSS sink:
- React renders every name as text.
- The only `dangerouslySetInnerHTML` (shadcn `ChartStyle`) takes the static `chartConfig` in History.tsx, never API data.
- There are no inline scripts, `eval`, or user-controlled `href`s.
I proved this with `<img src=x onerror=alert(1)>` and `<script>` names on every page.
The residual risk is a future XSS or a compromised dependency, which could read the token and send it anywhere. With the routed CSP (`script-src 'self'`, `connect-src 'self'`), a payload can neither run inline nor exfiltrate cross-origin by fetch.
Further options, not taken: sessionStorage (forces re-entry per tab) or an HttpOnly cookie (needs CSRF handling; ADR 0003 chose bearer tokens). The token's power is bounded: it adds and deletes Campuses and Devices and resets history. It cannot read anything that isn't already public.

**S4. Containers run with default capabilities and a writable root fs.** (Infra; diff below.)
All three services keep Docker's default capability set and can gain privileges through setuid binaries.
Proven on `ta-sec`, with a fresh volume (`down -v`, then up):
- api and web run `read_only: true` with a `/tmp` tmpfs, `cap_drop: [ALL]` and `no-new-privileges`.
- db runs `cap_drop: [ALL]` plus CHOWN, DAC_OVERRIDE, FOWNER, SETGID and SETUID.
- With that set, the database initialised, all three containers were healthy, and `mysqldump` (deploy.sh backup) completed.
- A 60 KB admin POST went through nginx's client-body temp file under /tmp.
- SSE delivered a live Reading, and history read back (`runs/security/hardened-functional.txt`).
The one log line this adds is harmless: `10-listen-on-ipv6-by-default.sh: can not modify default.conf (read-only file system?)`. The conf already sets `listen 8080` without IPv6.

**S5. Base images: tags float, and a stale local cache is reused.** (Infra / deploy.)
Both Dockerfiles use `node:22-alpine` and `nginxinc/nginx-unprivileged:1.28-alpine`; compose uses `mysql:8.4`. All are maintained lines: Node 22 is maintenance LTS to April 2027, nginx 1.28 is stable, MySQL 8.4 is LTS.
The problem: `docker compose up --build` reuses whatever base is cached locally. On this machine `node:22-alpine` was from 2026-06-23, so it was 3½ months behind.
Recommendation (CT owns deploy.sh): `deploy` and `upgrade` should build with `--pull` (`docker compose build --pull` before `up`). That way each upgrade picks up Alpine and Node security patches. Pinning by digest is the stricter alternative, but it needs someone to bump it.

**S6. Dependency advisories that ship in the images.** (Fixed: fix 5.)
Backend (runtime):
- express-rate-limit: the IPv4-mapped IPv6 bypass of per-client limits.
- mysql2: auth-plugin downgrade leaking the password in cleartext, and an inflate bomb.
- path-to-regexp: ReDoS.
- ip-address: several advisories.
- body-parser and qs: DoS.

Frontend:
- react-router: open-redirect XSS.
- Build-time only: vite, rollup, postcss, picomatch, nanoid, lodash.

All were fixed in-range by `npm audit fix` (lockfiles only; no package.json range changed). `npm audit` now reports 0 in both, dev dependencies included.

### Notes

**N1. The Device token over plain HTTP (ADR 0001/0003).**
On a school LAN, anyone who can see a board's traffic can read the token and the readings. That includes the same Wi-Fi SSID with client isolation off, a mirrored switch port, or a compromised host on the VLAN. With the token they can post false Readings for any registered hostname. They could hide a hot closet by posting cool values, which would be overwritten by the real board's next post within 30 s, or raise false alarms.
The token cannot change Campuses or Devices (fix 4 now guarantees it differs from the Admin token) and cannot read anything that isn't public.
What TLS in front already covers:
- The firmware sends over TLS when `SERVER_URL` is `https://` (`reporter.cpp:18`).
- Browsers' Admin token then travels encrypted too.
- Behind a TLS proxy, `trust proxy 1` still resolves the right client address as long as the proxy is the one hop in front of nginx. If TLS terminates in a separate proxy *in front of* this nginx, there are two hops. Every client would then appear as that proxy's address and share one rate-limit allowance, so `trust proxy` would have to become 2. Worth a line in DEPLOYMENT.md (CT).
Cheapest mitigation without TLS: put the boards on their own VLAN/SSID with client isolation.

**N2. Admin brute force is acceptable.**
One host gets the general allowance of 500 requests per 15 minutes, which is 2,000 guesses an hour (live: first 429 at request 495 after 5 setup calls). Against deploy.sh's 64-hex-character token (256 bits) that is never. Against a hand-set short token it would matter, so the backend now logs a startup warning for any token under 32 characters (fix 4).
I didn't make that a hard refusal, because the README's dev flow uses `--token dev-device`. A refusal is a one-line change if the coordinator prefers it.
Side effect: a host that is guessing also loses its dashboard reads for 15 minutes, because the allowance is shared.

**N3. MySQL root password = DB_PASSWORD** (compose `MYSQL_ROOT_PASSWORD: ${DB_PASSWORD}`). The root account is reachable only inside the db container, which isn't published, so this is defence in depth only. A separate `DB_ROOT_PASSWORD` would let deploy.sh backups avoid root entirely (CT).

**N4. Secrets are visible to `docker inspect`** (environment variables). Anyone in the docker group is root-equivalent on the host anyway. Note it in DEPLOYMENT.md: don't add technicians to the docker group.

**N5. The SSE cap and NAT.** The per-address cap is 20 streams. A browser opens at most 6 HTTP/1.1 connections per origin, so one technician never hits it. A district web filter that presents every browser as one address would cap dashboards at 20 there, and the 429 says why. The total cap of 400 keeps nginx under its 1024 worker connections, since each stream uses two (client and upstream).

**N6. Validation messages echo input** (for example `No device is registered with the hostname <input>`, `…got <value>`). The responses are JSON, and with nosniff routed a browser won't sniff them as HTML. The echo is bounded by the 100 KB body limit. No action needed.

**N7. Flake seen once:** `readings.test.ts › rounds fractional temperature…` failed once out of four full runs, then passed three times in a row. That test doesn't touch anything I changed. I'm flagging it for the resilience/load owners in case it's a timing race on the shared test DB.

**N8. One slip on my side, recovered.** `npm audit fix --omit=dev` pruned devDependencies from both shared `node_modules` for about a minute. I reinstalled them with `npm install` (lockfile unchanged from the fix), and every suite then ran green. Any agent whose build failed with `tsc not found` around 16:50 can just rerun.

## Fixes made (backend/src, test-first)

Each fix's test was written first and seen failing: 6 red, in `runs/security/` and the test log.

1. **`X-Powered-By` removed.** `src/app.ts`: `app.disable('x-powered-by')`. Test: `security.test.ts › no response names the framework`.
2. **Device-token guessing limited.** `src/routes/readings.ts`: `DEVICE_AUTH_FAILURE_LIMIT = 100` per 15 min per address. It runs before the token check, counts only 401s (`skipSuccessfulRequests` with `requestWasSuccessful: status !== 401`), and refuses even the right token once an address is over the limit. Tests: `guessing the Device token is limited…` and `a Device with the right token is never counted…` (105 boards on one address).
3. **SSE stream caps.** `src/sse.ts`: `maxStreamsPerAddress` (20) answers 429; `maxStreams` (400) answers 503. Both are counted per `req.ip`, which is trust-proxy aware, and a slot is released on close. Tests: `one address may hold a few streams…` and `the server holds no more than its total…`.
4. **Token config.** `src/config.ts` refuses ADMIN_TOKEN equal to DEVICE_TOKEN, naming neither value. `tokenWarnings()` names any token under 32 characters without printing it, and `src/index.ts` logs it at startup. Tests: `config.test.ts › refuses an Admin token equal…` and `warns about a token too short…`.
5. **Dependency advisories.** `npm audit fix` in backend and frontend (package-lock.json only). mysql2 3.15→3.24 retyped the pool's `connection` event as the promise connection. At runtime it is still the callback one, which I verified against the test DB, so `src/db.ts` casts to the core type and `test/retention.test.ts` types its recording pool's `values`.

Also new: `security.test.ts` locks in the parts that already passed:
- SQL injection on every query param and path id, with nothing dropped.
- SQL, markup, emoji and RTL names round-trip verbatim.
- A 50-emoji closet is a 422.
- A 413 with no stack trace.
- A generic 500 that hides SQL and the stack.
- CORS refusal sets no ACAO.
- 401 bodies never echo the token.

Suites (final run): backend `npm test` 226/226, `typecheck` ok, `build` ok. Frontend `lint`, `typecheck`, `test` (42/42) and `build` all exit 0.

## Infra changes to route

The CT agent owns these files. Every hunk below ran on `ta-sec` as shown, and the results are cited in S1/S4. Raw diffs: `runs/security/nginx.diff` and `runs/security/compose.diff`.

### frontend/nginx.conf

```diff
--- a/frontend/nginx.conf
+++ b/frontend/nginx.conf
@@ -1,11 +1,30 @@
 # The web service of the root compose.yaml: the built frontend plus the /api/ proxy, on
 # plain HTTP. Put TLS in front of the stack, not inside it (DEPLOYMENT.md).
+# One zone for the stream's per-address connection cap (location = /api/dashboard/stream).
+limit_conn_zone $binary_remote_addr zone=sse_per_addr:1m;
+
 server {
     # 8080, not 80: the image runs nginx as a non-root user, which cannot bind below 1024.
     # compose.yaml publishes it on WEB_PORT (80 by default), so operators see no change.
     listen 8080;
     server_name _;
 
+    # No version in the Server header or on nginx's own error pages.
+    server_tokens off;
+
+    # Security headers. add_header in a location replaces every one set here, so the two
+    # locations below that add their own repeat this block (nginx < 1.29.3 has no add_header_inherit).
+    # style-src needs 'unsafe-inline': Radix and Recharts set style attributes, and the chart
+    # writes a <style> element. No inline script exists, so script-src stays 'self'.
+    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;
+    add_header X-Content-Type-Options "nosniff" always;
+    add_header Referrer-Policy "no-referrer" always;
+    add_header X-Frame-Options "DENY" always;
+    add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()" always;
+
+    # The API refuses more than 100 KB; nothing here needs nginx's 1 MB default.
+    client_max_body_size 128k;
+
     root /usr/share/nginx/html;
     index index.html;
 
@@ -14,6 +33,22 @@
     resolver 127.0.0.11 valid=10s ipv6=off;
     set $api http://api:3001;
 
+    # The live stream holds a connection open for hours; cap them per address at nginx as well
+    # as in the api (sse.ts), so one host cannot use up worker_connections (1024 a worker).
+    location = /api/dashboard/stream {
+        limit_conn sse_per_addr 20;
+        limit_conn_status 429;
+        proxy_pass $api;
+        proxy_http_version 1.1;
+        proxy_set_header Host $http_host;
+        proxy_set_header X-Real-IP $remote_addr;
+        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
+        proxy_set_header X-Forwarded-Proto $scheme;
+        proxy_buffering off;
+        proxy_cache off;
+        proxy_read_timeout 86400s;
+    }
+
     # Backend API, including the SSE stream. ^~ so no asset rule below can outrank it.
     location ^~ /api/ {
         proxy_pass $api;
@@ -41,12 +76,22 @@
     # fallback above redirects here internally, so every route gets this header.
     location = /index.html {
         add_header Cache-Control "no-cache";
+        add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;
+        add_header X-Content-Type-Options "nosniff" always;
+        add_header Referrer-Policy "no-referrer" always;
+        add_header X-Frame-Options "DENY" always;
+        add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()" always;
     }
 
     # Hashed build assets can be cached forever
     location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf)$ {
         expires 1y;
         add_header Cache-Control "public, immutable";
+        add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;
+        add_header X-Content-Type-Options "nosniff" always;
+        add_header Referrer-Policy "no-referrer" always;
+        add_header X-Frame-Options "DENY" always;
+        add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()" always;
     }
 
     gzip on;
```

Notes:
- `nginx -t` passes on nginx 1.28.2.
- If TLS goes in front, add `Strict-Transport-Security` at *that* proxy, not here, because this server is plain HTTP.
- The `limit_conn` zone keys on `$binary_remote_addr`, the address nginx saw. Behind a TLS proxy that is the proxy, so drop or raise that limit there (the api's own per-address cap uses the trusted X-Forwarded-For).

### compose.yaml

```diff
--- a/compose.yaml
+++ b/compose.yaml
@@ -21,6 +21,10 @@
       MYSQL_ROOT_PASSWORD: ${DB_PASSWORD}
     volumes:
       - db-data:/var/lib/mysql
+    # The entrypoint chowns the data directory and drops to the mysql user; nothing else is needed.
+    cap_drop: [ALL]
+    cap_add: [CHOWN, DAC_OVERRIDE, FOWNER, SETGID, SETUID]
+    security_opt: ["no-new-privileges:true"]
     # Not published: only api reaches it. Use `docker compose exec db mysql ...` from the host.
     healthcheck:
       test: ["CMD-SHELL", "mysqladmin ping -h 127.0.0.1 -uroot -p\"$$MYSQL_ROOT_PASSWORD\" --silent"]
@@ -55,6 +59,11 @@
     depends_on:
       db:
         condition: service_healthy
+    # It writes nothing to disk: the image is read-only and holds no capabilities.
+    read_only: true
+    tmpfs: [/tmp]
+    cap_drop: [ALL]
+    security_opt: ["no-new-privileges:true"]
     # Not published: web proxies /api/ to it.
     healthcheck:
       test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3001/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
@@ -73,6 +82,11 @@
     depends_on:
       api:
         condition: service_healthy
+    # nginx-unprivileged keeps its pid and temp files under /tmp.
+    read_only: true
+    tmpfs: [/tmp]
+    cap_drop: [ALL]
+    security_opt: ["no-new-privileges:true"]
     healthcheck:
       test: ["CMD", "wget", "-q", "--spider", "http://127.0.0.1:8080/"]
       interval: 10s
```

compose.demo.yaml's `demo` service runs `scripts/demo.mjs`, which writes nothing to disk, so the same api lines should apply to it. I didn't test that.

### deploy/deploy.sh (S5)

Build with a fresh base on `deploy`/`upgrade`: run `dc build --pull` before `dc up -d --build …`, or add `--pull always` to the `up` (Compose ≥ 2.22). `docker compose build --pull` is the portable form.

### DEPLOYMENT.md (N1, N4)

- One sentence on `trust proxy` when TLS terminates in a separate proxy in front of this nginx: the api then needs 2 hops.
- Keep technicians out of the `docker` group.
- Put boards on their own VLAN/SSID with client isolation when TLS isn't used.

## Files modified

- backend/src/app.ts, backend/src/config.ts, backend/src/db.ts, backend/src/index.ts, backend/src/routes/readings.ts, backend/src/sse.ts
- backend/test/security.test.ts (new), backend/test/config.test.ts, backend/test/retention.test.ts
- backend/package-lock.json, frontend/package-lock.json
- .scratch/prodtest/security.md

## Infra hardening applied

By the infra agent. The routed changes above are applied and were proven on the production deploy path. The test was a fresh Debian 12 CT stand-in (`.scratch/ct/`) running a git bundle of HEAD 88f02b7 plus these changes: `deploy.sh bootstrap`, then `deploy --yes`. Raw output is in `.scratch/prodtest/runs/infra/`. Afterwards the stack was uninstalled with `--wipe` and the CT, its image and its volumes were removed.

### Pass/fail

| Check | Result | Evidence |
|---|---|---|
| shellcheck 0.9 on deploy.sh; deploy.ps1 parses | PASS | 0 findings; 0 parse errors |
| `bootstrap` then `deploy --yes` on a fresh CT | PASS | `bootstrap.log`, `deploy.log`; the `build --pull` step ran, then `up --build` was fully cached |
| Headers from the host on `/`, `/api/health`, an asset, the SPA fallback, an API 404 | PASS | `headers.txt`: CSP, nosniff, Referrer-Policy, X-Frame-Options, Permissions-Policy on all of them; `Server: nginx` with no version, also on the 404 page; 200 KB POST → 413 |
| `node frontend/e2e/walk.mjs` from Windows against the CT (:8090) | PASS, 36/36 | `walk.txt`; its final check (no console errors) passes, and a CSP violation would appear there as a console error |
| CSP probe in Chromium: every page, Settings with the token, a live update, framing | PASS: **0 CSP violations**, 0 console errors, framing blocked | `csp-probe.txt` (new `.scratch/ct/csp-probe.mjs` listens for `securitypolicyviolation` events and "Refused to" console lines) |
| The same probe on the demo's populated data | PASS: 0 violations | `csp-probe-demo.txt` |
| SSE through nginx delivers a Reading | PASS | `sse-limits.txt`: `data: {"type":"reading",...}` within 2 s of the POST; the stream carries every security header |
| 25 streams from one address | PASS as designed: 1–20 → 200, 21–25 → 429 (nginx); a slot frees on close | `sse-limits.txt` |
| 25 streams across two addresses | PASS: the host holds 20 and the CT itself opens 5 more, all 200 | `sse-limits.txt` |
| The limits agree | PASS: nginx `limit_conn` is 20 and the api's own cap is 20. With nginx bypassed (25 straight at api:3001), 1–20 → 200 and 21–25 → 429 with the api's JSON message | `sse-limits.txt` |
| Hardened compose applied | PASS: api and web have `ReadonlyRootfs=true`, `CapDrop=[ALL]`, no-new-privileges and a `/tmp` tmpfs; db has `CapDrop=[ALL]` plus the 5 caps and no-new-privileges | `backup-restore.txt` |
| Backup and restore under read_only/cap_drop | PASS | `backup-restore.txt`: backup ok (dir 700, file 600); a Campus added after the backup is gone after `restore --file … --confirm`; the earlier Reading is back; api healthy |
| Demo (`deploy.sh demo --web-port 8091`) under the new compose | PASS | `demo-check.txt`: 4 Campuses and 24 Devices, 478,715 history rows, live loop, a read-only `demo` container with 0 restarts, headers on :8091, live SSE; `demo --down` removed it all |
| Redeploy is a no-op | PASS | `redeploy.log`: `deploy --yes` again recreated 0 containers, so `build --pull` keeps the "unchanged checkout, same image" property |
| CT restart, planned (`docker restart ta-ct`) | PASS: healthy within 9 s, data kept, CSP and stream ok | `restart.txt` |
| CT restart, unplanned (the host's Docker engine went down, see I3) | PASS: healthy 13 s after `docker start ta-ct`, data kept | `restart.txt` |
| `uninstall --wipe --confirm`, then the CT removed | PASS | `uninstall.txt`: 0 containers, volumes or images left in the CT, no crontab; `run.sh down` removed ta-ct, its image, and ta-ct-docker/ta-ct-containerd |

### Changes applied

1. **frontend/nginx.conf**: `server_tokens off`, `client_max_body_size 128k`, the `sse_per_addr` zone, and `location = /api/dashboard/stream` with `limit_conn 20` / `limit_conn_status 429`. One deviation from the routed diff: the five headers live in a new **frontend/security-headers.conf**. It is included at server level and again in the two locations that add their own `add_header`, so the CSP is written once instead of three times and the copies can't drift. The header values are exactly the routed ones.
2. **frontend/Dockerfile**: copies `security-headers.conf` to `/etc/nginx/snippets/`.
3. **compose.yaml**: the routed diff as written (db: cap_drop ALL plus 5 caps and no-new-privileges; api and web: read_only, a `/tmp` tmpfs, cap_drop ALL and no-new-privileges).
4. **compose.demo.yaml**: the api's lines on the `demo` service, now tested.
5. **deploy/deploy.sh** and **deploy/deploy.ps1**: `deploy` (and so `upgrade`) runs `docker compose build --pull` before `up -d --build`. If the pull fails (no registry), it warns and the next step builds from the local cache, so an offline upgrade still works. The demo doesn't pull, because its images are throwaway.
6. **DEPLOYMENT.md**: `build --pull` in the by-hand upgrade. The TLS section now says which two limits all browsers share behind a host proxy, and what it takes to count them per browser. A new **Security** section covers what the stack hardens and what it needs from the operator: keep technicians out of the docker group, put the boards on their own VLAN/SSID with client isolation, and upgrade with `--pull`.
7. **README.md**: the deployment paragraph's list of DEPLOYMENT.md topics now includes the security section.

Nothing in the app needed changing. The CSP broke nothing.

### Findings, by production impact

No blockers.

**Should fix: I1. Behind the documented TLS proxy, every browser shares one address, so at most 20 dashboard tabs can be live district-wide.** The Caddy setup in DEPLOYMENT.md puts a host proxy in front of the stack's nginx. Both nginx's `limit_conn` (keyed on `$binary_remote_addr`) and the api's cap (`trust proxy` 1) then see the proxy's address for everyone. Tab 21 gets a 429 and shows Reconnecting, retrying every 5 s. With technicians plus IT leadership, wall screens included, 20 is reachable. The same was already true of the general 500/15 min API allowance. This is now documented, but the fix belongs to other owners:
- backend (security agent): make `trust proxy` configurable, e.g. `TRUST_PROXY` (default 1, 2 behind a host proxy), in `backend/src/app.ts`.
- nginx (infra, after that): when the stack sits behind a host proxy, take the client address from it with `set_real_ip_from <docker bridge gateway>; real_ip_header X-Forwarded-For;`, so `limit_conn` keys on the browser. The conf is baked into the image and the container is read-only, so making this switchable needs a small design choice. One option is a second conf selected by a build arg. The other is to raise the nginx cap and rely on the api's.

Repro: the 25-stream test above shows the cut at 20 for one address. Behind a host proxy, every browser is that one address.

**Note: I2. The 21st stream's 429 comes from nginx, not the api.** Both caps are 20, so nginx always refuses first, with its HTML 429 page. The api's explanatory JSON ("close a tab and try again") is never seen through nginx. EventSource can't read either body, so users see the same Reconnecting state. If the message matters, set nginx's cap a little above the api's (e.g. 24). nginx would then remain the backstop for worker connections, and the api would give the answer.

**Note: I3. The host's Docker engine restarted mid-run (17:15:33Z).** Docker Desktop's backend log shows the WSL pipes closing across every distro, followed by an engine shutdown. Every container exited 255, including the shared `backend-test-db-1` and `ta-a11y-db`. Nothing in this stack caused it: the only commands running at the time were `docker stats` and exec calls into the CT. I restarted both DBs, which were up before, and told the coordinator. `ta-load` came back on its own restart policy.

**Note: I4. Assets send two Cache-Control lines.** `expires 1y` adds `max-age=31536000`, and `add_header` adds `public, immutable`. This predates these changes and browsers merge the two. Left as is.

**Note: I5. The accessibility agent's uncommitted frontend/src was not in the CT build.** The bundle is HEAD plus infra only. A grep of their diff and new files found no inline script, `eval`, `dangerouslySetInnerHTML` or external URL, so the CSP should hold. Rerun `node .scratch/ct/csp-probe.mjs` (with WEB, ADMIN_TOKEN and DEVICE_TOKEN set) against any stack built after their merge to confirm.

**Note: I6. For the commit: deploy/deploy.sh shows `old mode 100755 / new mode 100644` in this worktree.** That mode change was already there before this task (a Windows checkout artifact). Commit it as 100755: the bundle I tested was 100755, and `bootstrap` needs the executable bit.

### Files modified

frontend/nginx.conf, frontend/security-headers.conf (new), frontend/Dockerfile, compose.yaml, compose.demo.yaml, deploy/deploy.sh, deploy/deploy.ps1, DEPLOYMENT.md, README.md, .scratch/ct/csp-probe.mjs (new), .scratch/prodtest/security.md (this section).

## TRUST_PROXY

Fixes should-fix I1 (behind the documented TLS proxy, every browser and Device shares the proxy's address), plus the coordinator's addition: a read limit that an office of tabs behind one address stays under. Evidence: `.scratch/prodtest/runs/trust-proxy/` (logs, gitignored). Scripts: `.scratch/prodtest/trust-proxy/` (streams.mjs, devicefail.mjs, clients.sh, tab-requests.mjs, both Caddyfiles). Stack `ta-tp` on 127.0.0.1:8099, with `caddy:2-alpine` on the same Docker network (published on 127.0.0.1:8100 for the walk). All torn down at the end, images included.

### Pass/fail

| Check | Result | Evidence |
| --- | --- | --- |
| TRUST_PROXY empty: two clients behind Caddy share one cap of 20 (today's behaviour) | pass: A 13 + B 7 = 20, rest 429 from nginx | runs/trust-proxy/01-default-empty.log |
| TRUST_PROXY = both Caddy addresses: two clients, 25 streams each at once | pass: each gets 20 ok + 5 × 429 | 02-per-client.log |
| Spoof through default Caddy (fixed XFF, or a new XFF per stream) | pass: still 20 each | 03-spoof-caddy.log |
| Spoof through a misconfigured Caddy that passes the client's XFF on (`trusted_proxies private_ranges`) | pass: still 20 each; nginx stops at the rightmost untrusted entry | 04-spoof-lax.log |
| Spoof straight to nginx, skipping Caddy (rotating XFF, or claiming Caddy's own address) | pass: still 20 each | 05-spoof-direct.log |
| The api keys on the real client too (Device-token failure cap of 100, which nginx does not duplicate) | pass: client A, over the cap and rotating XFF through the lax Caddy, stays 429; clients B and C still get 401 (own allowance), via Caddy and direct | 06-device-fail-cap.log |
| nginx access log shows the clients (172.22.0.7/.8/.9) and the host browser via the gateway (.1), never Caddy (.5/.6) | pass | log tally in this session |
| `TRUST_PROXY=gateway` resolves the container's default gateway (172.22.0.1); host curl via the gateway is trusted, a container client's XFF is not | pass | 08-gateway-and-validation.log |
| Invalid values (`0.0.0.0/0`, `::/0`, `1.2.3.4; evil`, `caddy`) stop the container with a `real-ip:` line; a list with stray commas and spaces, and IPv6 CIDR, work and pass `nginx -t` | pass: the real entrypoint exits 1 | 08-gateway-and-validation.log |
| Still non-root (uid 101), read-only root filesystem, only /tmp tmpfs | pass: the file renders to /tmp, no new mount needed | `docker inspect` in this session |
| `node frontend/e2e/walk.mjs` through Caddy (WEB=http://127.0.0.1:8100) | pass: 38 of 38 | 07-walk-via-caddy.log |
| deploy.sh / deploy.ps1: `--set TRUST_PROXY=...` (valid, /0 refused, empty clears, unknown key named); the install prompt asks only after "Is a TLS proxy in front?" is answered yes, defaults to `gateway`, re-asks on a bad value, and clears on no | pass, both scripts, same results | this session (scratch copies; prompt driven with mocked input) |
| shellcheck 0.9 (deploy.sh, frontend/real-ip.sh, clients.sh) | pass: clean | koalaman/shellcheck:v0.9.0 |
| compose.yaml + compose.demo.yaml `config` | pass | |
| Read limit: per-tab measurement, then test-first split limiter | pass | 09-tab-requests.log, backend/test/rateLimit.test.ts |
| backend `npm test` / `typecheck` | pass: 228/228, clean | backend-test-final.log |
| frontend `lint` / `typecheck` / `test` / `build` | pass, all exit 0 (worktree incl. the accessibility agent's uncommitted src) | frontend-*.log |

### Findings, by production impact

**Should fix (now fixed): I1. Behind the TLS proxy every client was one address.** That meant 20 live tabs district-wide and one shared 500-request allowance. It also meant one shared Device-token failure cap. That last one is worse than the report first said. Past 100 wrong-token posts in 15 minutes, *every* Reading from that address is refused, even with the right token. So about four boards left on an old token (posting every 30 s) would stop every Device behind the proxy from recording. Repro: 01-default-empty.log for the streams. For the Device cap, the arithmetic is from `routes/readings.ts`.

**Should fix (now fixed): the general /api/ allowance blanked pages behind one NAT.** Measured on the demo stack (24 Devices live, 5 minutes, scaled to 15), one open tab makes:

| Page | /api requests per 15 min | What |
| --- | --- | --- |
| Campuses | 93 | `GET /api/campuses/overview`, at most every 10 s while the stream is busy, plus the stream |
| History | 36 | the Device's history, 2 s after each of its Readings |
| Dashboard | 30 | `GET /api/dashboard` refetches (8 in 5 min), campuses once, the stream |
| Incidents | 6 | once, then in place from the stream |

So 30 tabs behind one address make about 1,200 to 2,800 reads: more than twice the old 500 even at the low end. Reads now have their own allowance of 6,000 per address per 15 minutes, which leaves more than 2× headroom for a wall of 30 Campuses tabs. Everything that is not a GET or HEAD keeps today's 500, counted separately. Readings stay exempt, with the per-Device write limit and the Device-token failure cap unchanged.

**Note: T1. 30 tabs behind one NAT still meet the 20-stream cap.** TRUST_PROXY fixes the proxy case, but an office NAT is genuinely one address. Tab 21 there shows Reconnecting. Raising the cap (nginx `limit_conn` and `sse.ts`, both 20) is a capacity decision: each stream holds two nginx worker connections of 1024. If it matters, 40 in both still leaves nginx headroom at 1024 workers for about 12 such offices. I did not change it.

**Note: T2. With TRUST_PROXY empty, nginx and the api keep working exactly as before.** The include renders a comment-only file.

**Note: T3. Caddy (2.5 and later) drops an untrusted client's X-Forwarded-For.** It sends only the address it saw. So the brief's "distinct X-Forwarded-For values sent to Caddy, which appends them" does not happen with the documented Caddyfile. The two simulated clients are two containers with their own addresses instead. A deliberately lax Caddy covers the "proxy passes the header on" case.

**Note: T4. I could not read or edit `.env.example`.** This session's permission settings deny every path matching `.env*`. Functionally nothing is missing: compose defaults `TRUST_PROXY` to empty, and `deploy.sh`/`.ps1` append the key when it is set. For the coordinator to add, after `WEB_PORT`:

```
# Behind a TLS proxy (DEPLOYMENT.md, TLS in front of the stack): the proxy's address(es),
# comma-separated, or `gateway` for a proxy on this host. Empty: no proxy in front.
TRUST_PROXY=
```

### Changes applied

- `frontend/real-ip.sh` (new) is copied to `/docker-entrypoint.d/15-real-ip.sh` with mode 0755. From `TRUST_PROXY` it writes `/tmp/real-ip.conf`: `set_real_ip_from` for each entry, plus `real_ip_header X-Forwarded-For` and `real_ip_recursive on`. Entries are comma- or space-separated IPs and CIDRs. `gateway` means the default route's gateway from /proc/net/route, which is where a proxy on the Docker host arrives from. When `TRUST_PROXY` is empty, the file holds only a comment. The script refuses `/0` and anything that is not an address, so nginx config cannot be injected and the container fails loudly. It writes to /tmp because envsubst templates cannot loop over a list, and conf.d is read-only. The existing tmpfs covers /tmp.
- `frontend/nginx.conf` includes `/tmp/real-ip.conf` in the server block, so `$remote_addr`, `limit_conn`, the access log, and the forwarded X-Forwarded-For all carry the browser's address.
- `frontend/Dockerfile` copies the script.
- `compose.yaml`: `web` gets `TRUST_PROXY: ${TRUST_PROXY:-}`. The demo overlay inherits it.
- The backend keeps `trust proxy` at 1. nginx forwards `$proxy_add_x_forwarded_for`, whose last entry is now the real client, and the api believes only that entry (06-device-fail-cap.log).
- `backend/src/app.ts`: two `/api/` limiters. `READ_LIMIT` is 6000 for GET and HEAD. `WRITE_LIMIT` is 500 for the rest, with POST /readings skipped as before. `backend/test/rateLimit.test.ts` was written first and seen red, then green. It covers: rotating XFF still capped for changes, reads allowed past 500 and capped at 6000 per address, another address keeping its own allowance, and reads and changes counted apart.
- `deploy/deploy.sh` and `deploy/deploy.ps1`: `TRUST_PROXY` is a managed key with validation, accepted by `--set` and listed in the help. The interactive install asks "Is a TLS proxy (Caddy, nginx) in front of this stack?" and only then asks for the addresses (default `gateway`).
- `DEPLOYMENT.md` adds "Client addresses behind the proxy: `TRUST_PROXY`" under TLS in front: what is shared without it, which value to use where, the deploy flags, the `real-ip:` log line, why spoofing fails, and what never to list. It also mentions TRUST_PROXY in the settings paragraph and the split limits. `README.md` covers the rate-limit paragraph.

### Files modified

frontend/real-ip.sh (new), frontend/nginx.conf, frontend/Dockerfile, compose.yaml, deploy/deploy.sh, deploy/deploy.ps1, DEPLOYMENT.md, README.md, backend/src/app.ts, backend/test/rateLimit.test.ts, .scratch/prodtest/trust-proxy/ (new: test scripts and Caddyfiles), .scratch/prodtest/security.md (this section). Not changed: compose.demo.yaml (inherits from compose.yaml), frontend/security-headers.conf, and .env.example (T4).
