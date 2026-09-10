# 19 — Flash and check a batch of Devices from the bench

**What to build:**
A technician with a box of NodeMCU boards, a USB hub, and the inventory spreadsheet runs one watcher on Windows, plugs boards in, and each one comes out identified against the sheet, registered, flashed with the one exported binary, and bench-checked against the live server, with a log that reconciles the box to the sheet. Decided in the grilling of 2026-09-10 for the batch of 98 boards; the sheet is `device_log - device_log.csv` (92 boards with hostname and MAC, no Campus or Closet, so at least six boards are off the list).

**Blocked by:** 18 — Run the whole system with Docker Compose

**Status:** ready-for-agent

- [ ] `arduino/bench.py`, Python 3 on Windows, needs only `esptool` and `pyserial` (stated in its docstring); takes `--server http://<host>`, `--inventory <csv>`, `--bin` (default: the IDE's exported `TemperatureAlarms.ino.bin` under `build/` in the sketch folder), and the Admin token from the `ADMIN_TOKEN` environment variable, never a flag
- [ ] It refuses to start when the binary is missing or older than any source file in the sketch folder, when `ADMIN_TOKEN` is unset, or when the server's `/api/health` does not answer
- [ ] It is a watcher: started once, it polls the COM ports and handles each newly appeared port on its own thread, so a hub works several boards at once; Ctrl-C stops it after the boards in progress finish
- [ ] Identify: esptool reads the MAC; the hostname is `ESP_` plus the MAC's last six hex digits upper-cased (what `network.cpp` derives from the chip id); the inventory row is looked up by MAC, and a board that is not on the sheet proceeds, flagged `not on list`
- [ ] Register: a Campus named Bench with shortcode `BENCH` is created once if missing; the Device is registered under it with closet `Unassigned`; a 409 reads as already registered and is not a failure
- [ ] Flash: the one binary at 921600 baud, falling back to 460800 when the handshake fails; the sheet is the operator's and is never modified
- [ ] Bench check: pulse reset, read serial at 115200 for 70 seconds (two report attempts). PASS needs a `device:` line matching the derived hostname, `wifi: connected`, a `sensor:` line with numbers, and `report: 201 created`. No numeric `sensor:` line is FAIL bad sensor; no `device:` line is FAIL did not boot; both keep the batch going and leave the Device registered
- [ ] Batch stops, loudly, on `report: 401` (the token in the binary), on no `wifi: connected` on the first board of the run (SSID or password), and on `report: failed` (the server is unreachable from the bench); the reason names which of the binary, the WiFi, or the server to fix
- [ ] Log: one row per board seen, appended to `<inventory>.bench.csv` next to the sheet, with time, port, sheet row or blank, hostname, MAC, `registered` / `already`, `flashed`, verdict, and reason; replugging a board runs it again and adds a row. On stop it prints the sheet rows never seen and the boards seen that the sheet lacks
- [ ] The one-line verdict per board on the terminal reads like the firmware's log, e.g. `COM7  row 12  ESP_7AED5B  registered  flashed  PASS` and `COM9  not on list  ESP_1234AB  already  flashed  FAIL bad sensor`
- [ ] README firmware chapter gains a "Flashing a batch" subsection: install `esptool` with pip, export the binary once (one board type per batch, so one `DHT_PIN`), set `ADMIN_TOKEN`, run the watcher, read the log; and `CONTEXT.md` defines Bench
- [ ] Tested without hardware: the sheet lookup, hostname derivation, binary staleness check, serial verdict parsing (PASS, each FAIL, each batch stop) and the reconciliation lists have unit tests on Python's own `unittest`, run with `python -m unittest arduino/test_bench.py`; the esptool and serial layers are behind one seam the tests fake. A real board is the acceptance test on the bench
