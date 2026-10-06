Name: sec-firmware. Report: .scratch/prodtest/security-firmware.md.

Target: the security of everything that goes onto, or touches, a production board, before the district flashes about 100 NodeMCU boards with real production code.
- the firmware: arduino/TemperatureAlarms (config.example.h, network.cpp, reporter.cpp, sensor.cpp, the .ino)
- the bench watcher and its test: arduino/bench.py, test_bench.py
- the flashing docs: README's firmware chapter, "Flashing a batch", and DEPLOYMENT.md where it touches boards
- the ADRs about tokens and transport (0001, 0003)

Review, proving each point by reading the code and, where possible, running the bench tests or compiling (arduino-cli is not installed; the earlier compile used a portable arduino-cli under %TEMP%\ta-ard; reuse it if it is still there, or download it again to a temp directory outside the repo):
1. **Secrets on the board.** Every board's flash holds the WiFi password and the Device token, readable by anyone with the board and esptool (`read_flash`). State the real exposure, what an attacker can do with a stolen token (post fake Readings for any hostname? only for registered hostnames? create incidents?), and the mitigations that fit a school district. For example: the server already validates hostnames against registered Devices; per-Device rate limits; a documented token rotation procedure (reflash every board) and how bench.py supports a rotation batch; ESP8266 flash encryption is not available, so say so. Check that the firmware never prints the token or the WiFi password on serial (bench.py reads serial at 115200, and the bench log and sheet must not capture secrets).
2. **Transport.** Devices post over plain HTTP (ADR 0001). Assess spoofing and sniffing on a school LAN or VLAN. Does the firmware support HTTPS to the TLS front proxy (BearSSL on the ESP8266, with a certificate fingerprint or CA pin)? If not, what would it cost (RAM and flash on a NodeMCU, which is at 92% IRAM)? Recommend: keep HTTP on an isolated device VLAN, or add an optional HTTPS mode, as a decision for the owner. Check DEPLOYMENT.md's TLS section and that the plain-HTTP path for /api/readings still works there.
3. **Firmware robustness against a hostile network:**
   - a malicious server response (an oversized body, a slow loris, a redirect), so no buffer overflow or hang
   - the watchdog
   - a DNS rebinding or redirect to another host
   - what the board does with a 3xx (it must not follow to another host with its token)
   - HTTP timeouts
   - the open-network mode (an empty WIFI_PASSWORD) and its risk; it must be documented as needing a MAC-allowlisted SSID
4. **The bench pipeline:**
   - bench.py takes ADMIN_TOKEN from the environment only (never a flag)
   - it never logs the token
   - the exported .bin (which contains the Device token and the WiFi password) is never committed: check .gitignore for `arduino/**/build/`, any copied .bin, and `*.bench.csv`
   - the inventory sheet is written atomically, with no secrets in it
   - the subprocess calls to esptool are safe against odd COM port names or sheet contents (no shell=True, no injection from CSV fields)
   - registering Devices over HTTP sends the Admin token in clear: say so, and recommend running the bench against the server over the LAN or VLAN, or HTTPS through the proxy
5. **Supply chain:** pin the DHT library and the esp8266 core versions in the README, so production binaries are reproducible, and record the exact versions that compiled cleanly (core 3.1.2, DHT sensor library 1.4.7, Adafruit Unified Sensor 1.1.15).

Constraints: follow prod-common.md (below). Read-only, except: you may fix bench.py and its tests, and the firmware, but only for clear security bugs (test-first for bench.py), and the README firmware chapter and docs. Anything that changes product behaviour or needs an owner decision (HTTPS on boards, a token rotation design) goes in the report under "Decisions for the owner", with options and a recommendation. Another agent is reviewing the server at the same time and owns backend/, frontend/, deploy/, and compose. Never commit, push, stash, reset, or checkout.

Ownership: arduino/, README.md (the firmware chapter only), docs/adr/0001 and 0003 (clarifying notes only), and .scratch/prodtest/security-firmware.md.

Observable acceptance: worker_done with a severity-ranked table (blocker / should-fix / note), any fixes with their tests (`python -m unittest arduino/test_bench.py` green; the firmware compiled if you changed it), the decisions for the owner, a flashing-day security checklist (what to verify before and after flashing a batch), and --files-modified.
