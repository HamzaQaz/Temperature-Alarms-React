# Security review: firmware, bench pipeline, flashing docs

Agent: sec-firmware. Scope: `arduino/TemperatureAlarms/*`, `arduino/bench.py`, `arduino/test_bench.py`, the README firmware chapter and "Flashing a batch", the board-facing parts of DEPLOYMENT.md, and ADRs 0001 and 0003. Date: 2026-10-06.

Evidence: `.scratch/prodtest/runs/sec-firmware/` (gitignored), with `unittest.log` (55 tests OK) and `compile-https.log`. The firmware was compiled with the portable arduino-cli in `%TEMP%\ta-ard` (esp8266 core 3.1.2, DHT sensor library 1.4.7, Adafruit Unified Sensor 1.1.15), on a copy of the sketch in a scratch directory, so no build output touched the repo.

## Pass/fail

| # | Check | Result |
| --- | --- | --- |
| 1 | Firmware never prints the Device token or WiFi password on serial | PASS (read every `Serial.print`; prints are SSID, URL, hostname, IP, status) |
| 1 | Server answer printed on serial is bounded and cannot forge a bench line | FAIL → **fixed** (`reporter.cpp`) |
| 1 | Secrets in flash protected | FAIL, inherent: plain text in `.bin` and flash, and the ESP8266 has no flash encryption (verified: `grep -a` finds the token and password in the exported `.bin`) |
| 1 | A stolen Device token is limited to Readings for registered hostnames | PASS (`routes/readings.ts`: 404 for unknown hostname, 20/min per hostname, admin routes need the other token) |
| 2 | Transport protects the token | FAIL by design over `http://`; partial over `https://` (`setInsecure`, no cert check). Owner decision D1 |
| 2 | Plain-HTTP `/api/readings` still passes through the TLS proxy configs in DEPLOYMENT.md | PASS (read: Caddy `handle /api/readings`, nginx `location = /api/readings`; not run live) |
| 3 | Firmware does not follow redirects | PASS (core 3.1.2 `HTTPClient::_followRedirects = HTTPC_DISABLE_FOLLOW_REDIRECTS`; sketch never changes it) |
| 3 | Oversized or trickled response body cannot hang or exhaust the board | FAIL → **fixed** (body read capped at 120 bytes and 2 s in total) |
| 3 | Trickled response *headers* cannot hang the board | FAIL, residual in the core (N3) |
| 3 | HTTP timeouts | PASS (10 s inactivity timeout on connect and read) |
| 3 | Watchdog | PASS for crashes and non-yielding loops (the core's hardware and software WDT); no app-level watchdog for a yielding stall (N3, D4) |
| 3 | Open-network mode documented as needing an isolated, MAC-allowlisted SSID | FAIL → **fixed** in README |
| 4 | `ADMIN_TOKEN` from the environment only, never a flag | PASS (`main`: `os.environ.get("ADMIN_TOKEN")`; argparse has no token flag) |
| 4 | bench.py never logs the Admin token | PASS (no print, sheet, or log path includes it; error messages carry URL and status only) |
| 4 | bench.py never sends the Admin token anywhere but `--server` | FAIL → **fixed**: urllib followed redirects with the `Authorization` header (S1) |
| 4 | `.bin` never committed | PASS for `arduino/**/build/`; a copied `.bin` elsewhere under `arduino/` was not ignored → **fixed** (`arduino/.gitignore`); repo root still open (S3) |
| 4 | `*.bench.csv`, sheet temp file, `config.h` ignored | PASS (`git check-ignore`) |
| 4 | Sheet written atomically, without secrets | PASS (`.tmp` + `os.replace`; columns are MAC, hostname, verdict, date) |
| 4 | esptool subprocess safe from odd port names and sheet contents | PASS (list argv, no `shell=True`; ports come from pyserial, the binary is an absolute path; no CSV field reaches argv) |
| 4 | Sheet and log safe from formula injection | PASS (every written reason starts with fixed text: `PASS`, `FAIL`, `ERROR`, `registering`, `esptool`, ...) |
| 4 | Admin token sent in clear over `http://` | FAIL by design → documented (README step 2) |
| 5 | Exact core and library versions pinned in README | PASS (already pinned; README now says production binaries must use exactly these) |
| - | `python -m unittest arduino/test_bench.py` | PASS, 55 tests (53 before + 2 new) |
| - | Firmware compiles after the fix | PASS; IRAM 60,667 / 65,536 (92%, unchanged), flash 359,672 B (1,120 B smaller than before) |

## Findings, ranked

### Blocker (a decision before flashing, not a code defect)

**B1. Transport and token choices are baked into 100 binaries.** Whatever goes into `config.h` on flashing day (the URL scheme, any certificate pin, the token) can only change by reflashing every board by hand over USB: there is no OTA, which is good for attack surface but makes every later change a fleet visit. Today a board posts the one shared Device token over plain HTTP. Anyone on the boards' network path reads it with a packet capture, and with it can post false Readings for every registered hostname (hostnames are public on the dashboard), at up to 20 a minute each. That can open false incidents, or mask a real overheat by posting normal values over it. It cannot read data or change Campuses or Devices. This is acceptable **only** if the boards sit on an isolated device VLAN or SSID. The owner must confirm that, or choose HTTPS (D1), **before** flashing.
*Reproduce:* any `tcpdump -A port 80` on the server's segment shows `Authorization: Bearer <token>` every 30 s per board.

### Should-fix

**S1. bench.py resent the Admin token to any redirect target. Fixed.** urllib's default redirect handler copies the `Authorization` header to the `Location` URL, even on another host, and turns a redirected POST into a GET. The README tells technicians to use `--server http://<host>`, and DEPLOYMENT.md's TLS proxy answers that with 301 or 308. So the Admin token went in clear to the first hop, then on to wherever `Location` pointed. Under nginx's `return 301`, a POST to `/api/campuses` came back as a GET with 200 and a campus list, which the watcher misreported as "could not create the Bench Campus: 200".
*Reproduce (before the fix):* a loopback server answering `POST /api/campuses` with `301 Location: /evil` logged `('GET', '/evil', 'Bearer SECRET-ADMIN')`.
*Fix:* `http_transport` uses an opener whose redirect handler never follows. A 3xx becomes a `BenchError` naming the status and the Location, and saying to pass that URL as `--server`.
*Tests:* `HttpTransport.test_a_redirect_is_refused_naming_where_it_pointed_and_the_token_goes_nowhere_else` (301, 302, 303, 307, 308 against a real loopback server: exactly one request arrives, and the error names the Location but not the token), and `test_a_get_is_not_redirected_either`. Both were red before the fix and are green after it.

**S2. Firmware read the whole response body with only an inactivity timeout. Fixed.** `http.getString()` reads until the server closes, and the core's `sendGeneric` resets its 10 s timeout on every byte (`StreamSend.cpp`, `timedOut.reset()`). A hostile server, or anything spoofing it, that trickles one byte every 9 s holds `reportReading` forever. The loop yields, so the watchdog never fires and the board silently stops reporting. The body also went to serial verbatim, so a response containing `\r\nreport: 201 created` could forge a bench PASS.
*Fix (`reporter.cpp`):* on a 201 the body is not read at all. On any other status, `responseStart()` reads at most 120 printable ASCII bytes within 2 s in total. The serial format `report: <status> <text>` is unchanged, so bench.py's parsing is unaffected.
*Verification:* compiled clean; IRAM unchanged. Not exercised on a board (no hardware here): run the bench checklist on one board before the batch, which is on the flashing-day checklist below.

**S3. A `.bin` copied out of `build/` was not gitignored. Fixed under `arduino/`; still open at the repo root.** I added `arduino/.gitignore` with `*.bin`, `*.elf`, and `*.map`. **Route to the owner of `.gitignore`:** add `*.bin` to the root `.gitignore` next to the firmware-secrets line, so a copy dropped at the repo root is ignored too (`git check-ignore -v TemperatureAlarms.ino.bin` currently prints nothing).

**S4. Token rotation is a flag day (owner decision D2).** The backend holds one `DEVICE_TOKEN`. From the moment it changes, every board still on the old token is refused, and behind a proxy without `TRUST_PROXY` those boards also trip the 100-per-15-minutes wrong-token lockout for every board behind the same address. With about 100 boards in closets, that means hours to days of a dark fleet. The procedure is now documented (README, "Secrets on the board"). I checked that bench.py supports a rotation batch: `register` returns `already` for a registered hostname without moving its Campus or Closet, and a stale binary stops the batch at the first `report: 401`.

**S5. HTTPS mode does not check the certificate (owner decision D1).** `client.setInsecure()` stops passive sniffing but not an active attacker who answers for the server's name (DNS spoof, ARP spoof, rogue AP on an open SSID). ADR 0003 records that this was accepted.

### Notes

- **N1. Secrets readable from any board.** `esptool read_flash 0 0x100000 dump.bin` followed by `strings dump.bin` shows the SSID, the WiFi password, and the token. The ESP8266 has no flash encryption or secure boot (that is ESP32 territory), so this is a physical-custody problem. Mitigations that fit: an isolated device VLAN (the password opens nothing else), boards mounted in locked closets, rotation after a loss (S4), and per-Device tokens if the owner wants a lost board to expose only itself (D2).
- **N2. Serial is clean.** No `Serial.print` touches `DEVICE_TOKEN` or `WIFI_PASSWORD`. Serial shows the SSID, the full `SERVER_URL`, the IP, the hostname, sensor values, and report status. The backend's 401 body is a fixed `{"error":"Not authorised"}`. bench.py keeps serial lines in memory only; the bench log and sheet store the verdict and reason, never raw serial.
- **N3. A header-phase slow loris is still possible in the core.** `handleHeaderResponse` resets its timeout per header line and has no cap on the number of headers, so a hostile server can still stall a board by trickling headers. That cannot be fixed without patching or replacing `HTTPClient`. Only a party that already controls the server or the path can do it, and the server's Offline condition surfaces the stalled board. D4 offers an app-level backstop.
- **N4. DNS rebinding and redirects.** The board resolves `SERVER_URL` on every POST and never follows a 3xx (it logs `report: 30x` and records nothing), so a redirect cannot carry the token to another host. A spoofed DNS answer can, for `http://` and for `https://` without a pin. Flashing the server's IP address on the device VLAN removes DNS from the path.
- **N5. Timeouts and the watchdog.** Connect and read use a 10 s inactivity timeout; the boot WiFi wait is capped at 20 s, and the loop otherwise returns at once. The core's hardware and software watchdogs reset the board on a crash or a non-yielding loop. Nothing restarts a board that is stuck but still yielding (N3).
- **N6. Open-network mode** (`WIFI_PASSWORD ""`) calls `WiFi.begin(ssid)` with no passphrase. A MAC allowlist is weak (the MACs are on the inventory sheet and in every frame), and an open SSID lets a rogue AP with the same name capture every board's token. It is now documented as acceptable only on the isolated VLAN.
- **N7. Supply chain.** README pins esp8266 3.1.2, DHT sensor library 1.4.7, and Adafruit Unified Sensor 1.1.15, both in the table and in the `arduino-cli` commands. These compiled clean here (`arduino-cli core list` and `lib list` confirm the versions). README now says production binaries use exactly these, and that a version change goes through one bench board and a README update in the same commit.
- **N8. bench.py over HTTPS verifies certificates** (urllib's default context), unlike the firmware. An `https://` `--server` is therefore the safe way to run the bench through the proxy.
- **N9. Heap for HTTPS** has not been measured on hardware. BearSSL is linked in every build (the `http://` and `https://` builds are byte-identical in size, and the `.map` holds `br_ssl` symbols), so HTTPS costs no flash or IRAM, but a session needs roughly 20 to 25 KB of heap at run time. Static RAM is 28.8 / 80 KB. Print `ESP.getFreeHeap()` on one bench board before choosing D1(b) or D1(c).

## Fixes made

| File | Change | Covered by |
| --- | --- | --- |
| `arduino/bench.py` | `http_transport` never follows a redirect; a 3xx is a `BenchError` naming the Location | `HttpTransport` (2 new tests, red then green); full suite 55/55 |
| `arduino/test_bench.py` | `RedirectingServer` loopback fixture and the two tests | itself |
| `arduino/TemperatureAlarms/reporter.cpp` | Response body read only on non-201, capped at 120 printable bytes and 2 s | compiled with core 3.1.2 (IRAM 92%, unchanged); bench check on one board still to do |
| `arduino/.gitignore` (new) | `*.bin`, `*.elf`, `*.map` under `arduino/` | `git check-ignore -v arduino/TemperatureAlarms.ino.bin` |
| `README.md` (firmware chapter only) | Pinned-version policy; new "Secrets on the board" (what is in flash, what a stolen token allows, open network, serial, redirects, rotation, the `.bin`); bench step 2 (Admin token in clear over http, use https, redirects refused); new step 5 (clean up) | - |
| `docs/adr/0001`, `docs/adr/0003` | Clarifying notes: transport exposure and HTTPS cost; token in flash, one shared token, rotation is a flag day | - |

## Changes for other owners (please route)

1. **Root `.gitignore`:** add `*.bin` (S3).
2. **DEPLOYMENT.md, Security, "Put the boards on their own VLAN" bullet** (CT agent): add "If the SSID is open (Devices admitted by MAC allowlist), it must be that same isolated VLAN: MACs are easy to copy, and a rogue access point with the same name collects every board's token." Also add: "Run `arduino\bench.py` with `--server https://YOUR_DOMAIN` once TLS is in front: it sends the Admin token with every registration, and it refuses to follow the proxy's redirect from `http://`."
3. **Backend (security agent), only if the owner picks D2(b):** accept `DEVICE_TOKEN_PREVIOUS` alongside `DEVICE_TOKEN` in `requireDeviceToken`/`hasDeviceToken`, and log which token each Device used, so a rotation stops being a flag day.

## Decisions for the owner

**D1. Transport for production boards** (decide before flashing; changing it later means reflashing every board):
- (a) **Plain HTTP on an isolated device VLAN or SSID** that reaches only the server's port 80, with client isolation. No firmware change; anyone on that VLAN can read the token.
- (b) **HTTPS with no certificate check**, which works today with `SERVER_URL "https://…"`. It stops sniffing but not spoofing. No flash or IRAM cost; about 20 to 25 KB of heap (N9).
- (c) **HTTPS with a public-key pin** (`client.setKnownKey()`, with certbot `--reuse-key` so renewals keep the key). It stops both sniffing and spoofing, costs about 1 KB of flash, and needs no clock. The risk is that losing or rotating the key bricks reporting until a reflash. A certificate fingerprint pin would break at every 90-day renewal, so it is not recommended.

**Recommendation:** (a) now, as the precondition for flashing day, with the boards flashed to the server's **IP address** on that VLAN so DNS is out of the path. Revisit (c) only if the boards must share a network with untrusted clients.

**D2. Token rotation design:**
- (a) **Flag day** (today): documented. Expect a dark fleet until every board is reflashed.
- (b) **Dual token window:** the backend accepts the old and new tokens until every board reports with the new one. This is a small backend change (above), and makes rotation a rolling reflash with no outage.
- (c) **Per-Device tokens:** a lost board exposes only itself. This needs a per-board binary (bench.py would have to build or patch one per MAC), schema changes, and Settings UI. It is a project of its own.

**Recommendation:** (b), before the first rotation is ever needed. (c) is not worth it at one admin and 100 boards behind an isolated VLAN.

**D3. bench.py over HTTP.** Either run the bench only from a trusted network (a cable to the server's LAN, or the device VLAN), or always use `https://YOUR_DOMAIN` through the proxy. **Recommendation:** https whenever the proxy exists; the watcher now refuses the redirect, so a mistake fails loudly.

**D4. App-level stall backstop** (optional firmware change): restart the board if it has had no 201 for N report intervals (say 20, or 10 minutes) while WiFi is up. That closes N3 and recovers any stuck state, but a server outage would then make every board restart at intervals, which is harmless since state is not kept. **Recommendation:** defer. The Offline alarm already tells technicians, and a restart loop during a server outage adds noise to the bench and serial logs.

## Flashing-day security checklist

Before the batch:
1. The device VLAN or SSID exists and reaches only the server's Readings port. If the SSID is open, it is MAC-allowlisted **and** on that isolated VLAN (D1).
2. `DEVICE_TOKEN` and `ADMIN_TOKEN` in the stack's `.env` are deploy.sh-generated (long and random) and different (the backend refuses equal ones).
3. Build with exactly esp8266 3.1.2, DHT sensor library 1.4.7, and Adafruit Unified Sensor 1.1.15 (`arduino-cli core list`, `lib list`).
4. `config.h` has the production SSID, password, `SERVER_URL` (the scheme chosen in D1; the server's IP address on the VLAN is recommended), `DEVICE_TOKEN`, the interval, and `DHT_PIN`. `git status` must not list `config.h` or any `.bin`.
5. Export the binary; it lands under `arduino/TemperatureAlarms/build/`. Do not copy it anywhere else.
6. Run **one** board through the bench checklist by hand first, which exercises the S2 change on real hardware. On serial, check that no line contains the token or the WiFi password, and that the first POST is `report: 201 created`.
7. Set `$env:ADMIN_TOKEN` in a fresh PowerShell window, and use `--server https://YOUR_DOMAIN` if a TLS proxy is in front (D3).

During and after:
8. Watch for the batch-stop lines (`401`, no WiFi, server unreachable); never "fix" a 401 by editing the server's token mid-batch.
9. Open the `<sheet>.bench.csv` and sheet: check they contain MACs, hostnames, and verdicts only.
10. Delete the exported `.bin`, close the window that held `ADMIN_TOKEN`, and store the inventory sheet where only technicians can read it.
11. Count the boards: any board that leaves the district's custody (lost, stolen, sent for RMA without being erased) means a token rotation (README, "Secrets on the board"). Before an RMA or disposal, erase it with `python -m esptool --port COMx erase_flash`.
12. Over the following days, any Device on the dashboard posting impossible values, or Readings arriving for a board known to be unplugged, is the sign of a leaked token.
