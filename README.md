# Temperature Alarms

**Know a closet is in trouble before the equipment does.**

Live temperature and humidity monitoring for the network closets across a school district. A NodeMCU board with a DHT11 sensor sits in each closet and posts a Reading every 30 seconds. The backend works out which Conditions a closet is in (Hot, Cold, Dry, Mold risk, Offline) and pushes every Reading to every open dashboard the moment it arrives.

![The dashboard: five closets across two campuses, one Offline, two Hot, the rest Online and counting down to their next Reading](docs/images/dashboard.png)

- **Live, not polled.** Cards update over Server-Sent Events. A Device that goes quiet reads as late, then Offline, with no reload.
- **Decided once, on the server.** Thresholds, Conditions, and Online or Offline are computed in one place, so every browser shows the same truth.
- **A day of history per Device.** Min, max, and average for each measure, any day in the last 90.
- **Two shared tokens, no accounts.** One for the people who administer Campuses and Devices, one flashed into every board. No logins to run.
- **One command to run it.** A Docker Compose stack: MySQL, the backend, and nginx on a single port, the same on a laptop and on the district server.

## Quick start

You need Docker (Docker Desktop on a laptop, Docker Engine with the Compose plugin on a server).

```bash
git clone https://github.com/HamzaQaz/Temperature-Alarms-React.git
cd Temperature-Alarms-React
cp .env.example .env        # set ADMIN_TOKEN, DEVICE_TOKEN, DB_PASSWORD (openssl rand -hex 32 each)
docker compose up -d --build
```

Open `http://localhost/`. On **Settings**, paste the Admin token, add a Campus, and add a Device with the hostname `ESP_000001`. To see its card come alive without a board, run the virtual Device that ships in the stack as that hostname:

```bash
docker compose exec api node scripts/mock-device.mjs --hostname ESP_000001
```

The database lives on a named volume, so it survives `docker compose down`; `docker compose down -v` wipes it. The volume is named after the folder you cloned into (`temperature-alarms-react_db-data` here), so run the stack from the same folder, or pin the name with `COMPOSE_PROJECT_NAME` in `.env` as DEPLOYMENT.md explains. [`DEPLOYMENT.md`](DEPLOYMENT.md) covers upgrades, backups, migrating an old database in, TLS, and the manual install for a server that cannot run Docker.

## How it works

```
 closet                          server                              laptop
┌──────────────┐   POST /api/readings   ┌──────────────────┐   SSE /api/dashboard/stream   ┌───────────┐
│ NodeMCU      │ ─────────────────────▶ │ Express backend  │ ────────────────────────────▶ │ React     │
│ + DHT11      │   every 30 s,          │ one process      │   one message per Reading     │ dashboard │
│ (a Device)   │   Device token         │ Conditions here  │                               │           │
└──────────────┘                        └────────┬─────────┘                               └───────────┘
                                                 │ readings, devices, campuses
                                                 ▼
                                        ┌──────────────────┐
                                        │ MySQL 8          │  90 days of raw Readings
                                        └──────────────────┘
```

A Device identifies itself by hostname, `ESP_` plus the last six hex digits of its MAC, and that is what you register in Settings. There is no configuration on the board beyond WiFi, the server URL, and the Device token. The backend is a single process on purpose: the SSE fan-out and the per-Device rate limit live in memory, which keeps the whole thing simple enough to run anywhere.

The vocabulary used throughout the code and docs is defined in [`CONTEXT.md`](CONTEXT.md). The decisions behind the architecture are recorded as ADRs:

| ADR | Decision |
| --- | --- |
| [0001](docs/adr/0001-http-post-from-devices-sse-to-browsers.md) | HTTP POST from Devices, SSE to browsers, a single backend process |
| [0002](docs/adr/0002-single-readings-table.md) | One `readings` table instead of one table per Device |
| [0003](docs/adr/0003-shared-tokens-not-user-accounts.md) | Two shared tokens instead of user accounts |
| [0004](docs/adr/0004-ninety-day-raw-retention.md) | Ninety days of raw Readings, nothing rolled up |
| [0005](docs/adr/0005-docker-compose-runs-the-whole-system.md) | One Docker Compose file, built from the clone |

## Repository layout

```
.
├── arduino/       # ESP8266 sketch for the NodeMCU + DHT11 Device, its wiring diagram, and the bench watcher
├── backend/       # Express + TypeScript API, MySQL, the migration runner, the virtual Device
├── frontend/      # React + TypeScript + Vite, Tailwind, shadcn/ui; e2e/ holds the browser walk
├── deploy/        # deploy.sh and deploy.ps1: install, upgrade, back up, and remove the stack, here or over ssh
├── docs/adr/      # Architecture decision records
├── .claude/skills/deploy/  # The skill that lets a Claude agent drive the deploy scripts
├── compose.yaml   # The whole system: db, api, and web on one port
├── .env.example   # The stack's settings; copy to .env
├── CONTEXT.md     # Domain vocabulary
├── PRODUCT.md     # Who it is for and how it should feel
├── DESIGN.md      # Tokens, type, components
└── DEPLOYMENT.md  # Running it for real
```

## Working on the code

Run the two packages by hand when you are changing them; each reloads on save. You need Node.js 22.18 or newer (the frontend's tests run TypeScript on Node directly, which needs it; the images use Node 22 too) and a MySQL 8 the backend can use; the stack's `db` is not published, so it is not that one.

**Backend**

```bash
cd backend
npm install
cp .env.example .env   # fill in database credentials and the two tokens
npm run dev            # http://localhost:3001
```

The backend creates and upgrades the schema itself on start through its migration runner. It refuses to start without `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `ADMIN_TOKEN`, and `DEVICE_TOKEN`, naming whatever is missing. `backend/.env.example` lists every setting the server reads.

**Frontend**

```bash
cd frontend
npm install
cp .env.example .env   # VITE_API_URL points at the backend
npm run dev            # http://localhost:5173
```

`VITE_API_URL` is the only setting the frontend reads. Unset, every request goes to the page's own origin, which is how `frontend/Dockerfile` builds it for the stack; the dev server needs it set because Vite serves on its own port.

**Root shortcuts**

```bash
npm run install:all
npm run dev:backend
npm run dev:frontend
npm run build:all
npm run start:backend
```

**A virtual Device**

To watch the dashboard react without a board, run the virtual Device against your dev backend. It posts a Reading every interval with the Device token and logs in the firmware's style, so `report: 404` means the hostname is not registered yet:

```bash
cd backend
node scripts/mock-device.mjs --hostname ESP_000001 --token dev-device --interval 30
node scripts/mock-device.mjs --hostname ESP_000002 --count 3       # three Readings, then silence: watch the card go Offline
```

Against the stack, the same script runs inside the `api` container with `docker compose exec api node scripts/mock-device.mjs ...`, where the token and port are already set.

### Tests and checks

The backend suite runs every route through the Express app against a real MySQL, so it needs a database it can wipe. `backend/docker-compose.yml` provides one: MySQL 8.4 on `127.0.0.1:3307`, data in tmpfs, gone on `down`.

```bash
cd backend
npm run test:db        # docker compose up, waits for healthy
npm test               # node --test, one file at a time
npm run typecheck      # tsc over src and test
npm run test:db:down   # docker compose down -v
```

Without Docker, point the suite at any MySQL 8 you can spare with `TEST_DATABASE_URL=mysql://user:password@host:port/database`. The database name must contain `test`: the suite drops every table in it before each test.

The frontend has no component tests. Two of its pure modules, report timing (the countdown and the age of a Reading) and the API base address, have unit tests that run on Node's own test runner and type stripping, so there is nothing extra to install; lint and typecheck cover the rest, and `npm run build` runs the typecheck first.

```bash
cd frontend
npm test               # node --test over src/**/*.test.ts
npm run lint           # eslint
npm run typecheck      # tsc -b, including the tests
```

The bench watcher's logic has unit tests on Python's own runner, with the esptool and serial layer faked, so no board and no extra package is needed: `python -m unittest arduino/test_bench.py` from the repo root.

All three pass on a clean clone; run them before a commit. The dashboard card shows "Expected Ns ago" once a Device misses a report, and Offline once the server has declared it (three missed reports); the page asks the server again at that moment, since the browser never computes a Condition itself.

#### The browser walk

`frontend/e2e/walk.mjs` drives the whole system in a headless browser: the Admin token flow, Campus and Device changes with their refusals, a Reading going live on a card over SSE, the Campus filter, the rate limit, History, reset, phone width, and the deletes. Run it against an empty stack, never a live one (it adds and deletes Campuses and Devices, and resets a History), with Playwright installed once:

```bash
cd frontend && npm install --no-save playwright && npx playwright install chromium
ADMIN_TOKEN=... DEVICE_TOKEN=... WEB=http://localhost node e2e/walk.mjs          # the stack; API defaults to WEB
ADMIN_TOKEN=... DEVICE_TOKEN=... WEB=http://localhost:5173 API=http://localhost:3001 node e2e/walk.mjs   # dev servers
```

It prints one line per check and exits non-zero if any failed. A second argument names a folder for screenshots.

## API

Every response with a body is JSON. Errors carry `{ "error": "<message>" }` with the status: 400 for malformed JSON, 401 for a missing or wrong token, 403 for a browser origin that is not allowed, 404 for an unknown Campus or Device, 409 for a conflict, 422 for a body that failed validation, 429 when a rate limit is hit. Shortcodes and hostnames are stored upper-case, so `chs` and `CHS` name the same Campus.

| Route | Auth | Request and response |
| --- | --- | --- |
| `GET /api/health` | none | `{status, database}`; 503 when the database cannot be reached |
| `GET /api/campuses` | none | `[{id, name, shortcode}]` by name |
| `POST /api/campuses` | Admin | `{name, shortcode}` → 201 Campus; 409 when the shortcode exists |
| `DELETE /api/campuses/:id` | Admin | 204; 409 while the Campus still has Devices |
| `GET /api/devices` | none | `[{id, hostname, closet, campus}]` by Campus name, then closet |
| `POST /api/devices` | Admin | `{hostname, campusId, closet}` → 201 Device; hostname must be `ESP_` plus six hex digits; 409 when it exists; 422 when the Campus does not |
| `PATCH /api/devices/:id` | Admin | `{closet?, campusId?}` → the updated Device. The hostname never changes: a replaced board is a new Device, and a body carrying `hostname` is 422 |
| `DELETE /api/devices/:id` | Admin | 204; the Device's Readings go with it |
| `POST /api/readings` | Device | `{device, temp, humidity}` from the board (`device` is its hostname, `temp` in °F) → 201 `{device, reading: {tempF, humidity, recordedAt}}`; 404 when no Device has that hostname; 422 when a number is missing, `temp` is outside -40 to 200 °F, or `humidity` is outside 0 to 100 (a sensor fault, not a Reading). Limited to 20 Readings a minute per Device, then 429 |
| `GET /api/dashboard?campus=SHORTCODE` | none | `{reportIntervalSeconds, offlineAfterSeconds, devices}`: every Device (or only that Campus's), by Campus name then closet, each with `latestReading`, `online`, `secondsSinceReading`, and its `conditions` worst first |
| `GET /api/dashboard/stream` | none | Server-Sent Events: one message per Reading ingested, `{type: "reading", device, reading, online, conditions}`, plus a heartbeat comment every 25 seconds to keep proxies from closing the stream |
| `GET /api/devices/:id/history?date=YYYY-MM-DD&tz=America/Chicago` | none | One local day of Readings, oldest first, with `summary` min, max, and average for each measure. `date` defaults to today and `tz` to the server's zone. At most 30,000 Readings, more than a day at the ingest limit: past that, the first 30,000 are sent, `truncated` is true, the summary covers only those, and the History page says so |
| `DELETE /api/devices/:id/history` | Admin | 204; every Reading of that Device is gone |

Tokens are sent as `Authorization: Bearer <token>`. The Admin token is the one the Settings page keeps; the Device token is flashed into every Device. Neither works in the other's place. See ADR 0003 for why there are two and what that trades away. The Conditions the API reports are defined in [`CONTEXT.md`](CONTEXT.md); the thresholds behind them are the `HOT_`, `COLD_`, and `DRY_` settings in `.env.example`.

Browsers are accepted from the API's own origin, which is how the stack serves them, and from one more origin named in `CORS_ORIGIN` for a dev server on another port.

Apart from Readings, which have the per-Device limit above, `/api/` allows 500 requests per 15 minutes per client address. The address is the one the stack's nginx saw: the backend trusts exactly one proxy hop. With another proxy in front, such as the TLS proxy in DEPLOYMENT.md, that address is the proxy's, so every browser shares one allowance.

## Hardware

| Part | Notes |
| --- | --- |
| NodeMCU (ESP8266) | Identifies itself by hostname: `ESP_` plus the last six hex digits of its MAC |
| DHT11 | Temperature and humidity, data pin on GPIO 5 (D1) when wired separately, GPIO 4 (D2) on boards that carry it soldered on |

### Wiring

![NodeMCU wired to a DHT11: DATA on D1 (GPIO 5), VCC on 3V3, GND on GND](arduino/dht11-pinout.svg)

| DHT11 pin | NodeMCU pin |
| --- | --- |
| VCC | 3V3 (not VIN) |
| DATA | D1 (GPIO 5) |
| GND | GND |

A bare four-pin sensor needs a 10 kΩ pull-up between DATA and VCC or every read is NaN; its third pin stays unconnected. Three-pin modules carry that resistor already, so wire them the same way, but check the silkscreen because the pin order varies by module.

A NodeMCU sold with the DHT11 already soldered on needs no wiring at all, but its sensor sits on D2 (GPIO 4), so set `DHT_PIN 4` in `config.h`. Every read comes back NaN until the pin matches the board.

## Firmware

The sketch in [`arduino/TemperatureAlarms/`](arduino/TemperatureAlarms/) is the one firmware for every Device: a NodeMCU reads a DHT11 and posts a Reading every Report interval. It is a folder the Arduino IDE compiles together, one job per file:

| File | Job |
| --- | --- |
| `TemperatureAlarms.ino` | `setup` and `loop` only: when a Reading is due, read once and report once |
| `network.h/.cpp` | Join WiFi at boot, reconnect from the loop without a reboot, name the Device |
| `sensor.h/.cpp` | Read the DHT11, skip a NaN sample and say so on serial |
| `reporter.h/.cpp` | Build the JSON Reading and POST it with the Device token, log the HTTP status |
| `config.example.h` | Template for the gitignored `config.h`: SSID, password, server URL, Device token, interval, sensor pin |

There is no on-device web server, no retry loop, and no per-Device setting. Your router's DHCP list shows the same six digits as `ESP-xxxxxx`.

### Libraries and board settings

The sketch compiles clean against these versions; install them from the IDE's Boards Manager and Library Manager.

| Dependency | Version | Where |
| --- | --- | --- |
| esp8266 by ESP8266 Community | 3.1.2 | Boards Manager, after adding `https://arduino.esp8266.com/stable/package_esp8266com_index.json` under Preferences, Additional boards manager URLs |
| DHT sensor library by Adafruit | 1.4.7 | Library Manager |
| Adafruit Unified Sensor | 1.1.15 | Library Manager (the DHT library depends on it; accept the prompt to install it) |

Board settings, under Tools: board **NodeMCU 1.0 (ESP-12E Module)**, upload speed 115200, CPU 80 MHz, flash size 4MB (any FS split), everything else at its default. The serial monitor runs at 115200.

### Flashing

1. Copy `arduino/TemperatureAlarms/config.example.h` to `config.h` in the same folder and fill in the WiFi credentials (leave the password `""` for an open network that admits Devices by MAC allowlist), and the server URL without a trailing slash (the sketch appends `/api/readings`): `http://<host>` where the stack runs, with a port only if `WEB_PORT` was changed, or `https://YOUR_DOMAIN` once TLS sits in front of it. A Device flashed with `http://<host>` keeps reporting after TLS goes in front, by hostname or by address, but only through the plain-HTTP Readings route that DEPLOYMENT.md's TLS proxy keeps; the Device cannot follow a redirect to HTTPS. Then the `DEVICE_TOKEN` from the stack's `.env`, the interval, which must equal the backend's `REPORT_INTERVAL_SECONDS`, and the sensor pin (5 for a wired DHT11, 4 for an integrated one). `config.h` is gitignored.
2. Open `TemperatureAlarms.ino` in the Arduino IDE, choose the board setting above and the port the NodeMCU appears on, and click Upload.
3. Open the serial monitor at 115200 and watch the Device join WiFi.

The same build from the command line, with the sketch's dependencies installed once:

```bash
arduino-cli config init --additional-urls https://arduino.esp8266.com/stable/package_esp8266com_index.json
arduino-cli core update-index && arduino-cli core install esp8266:esp8266@3.1.2
arduino-cli lib install "DHT sensor library@1.4.7" "Adafruit Unified Sensor@1.1.15"
arduino-cli compile --fqbn esp8266:esp8266:nodemcuv2 arduino/TemperatureAlarms
arduino-cli upload  --fqbn esp8266:esp8266:nodemcuv2 -p /dev/ttyUSB0 arduino/TemperatureAlarms
arduino-cli monitor -p /dev/ttyUSB0 -c baudrate=115200
```

An `https://` server URL is sent over TLS without certificate checking, since a pinned certificate would need a reflash at every renewal. The Device token therefore trusts DNS on the closet's network; ADR 0003 records the trade-off.

### Bench checklist

Run through this once per Device, on a desk, before it goes into a closet.

1. **Hostname on serial.** After `wifi: connected` the log prints `device: ESP_xxxxxx`. Add that hostname as a Device in Settings; until it exists, every POST is refused with a 404 naming the hostname.
2. **First POST returns 201.** Within one interval the log shows a `sensor:` line with the temperature and humidity, then `report: 201 created`, and the Device's card updates on the dashboard. A `report: 401` means the token in `config.h` does not match the backend's `DEVICE_TOKEN`.
3. **Unplugged sensor yields skipped samples.** Pull the DATA wire: each interval logs `sensor: read failed (NaN), sample skipped` and nothing is posted, so the history never records a zero. Plug it back in and posting resumes at the next interval.
4. **Router reboot yields resumed posting.** Power-cycle the access point: the log shows `wifi: connection lost, reconnecting`, then `wifi: reconnected` with the new address, and the next Reading goes out without the Device restarting. The `report:` lines that fail in between are logged and not retried.

### Flashing a batch

For a box of boards, [`arduino/bench.py`](arduino/bench.py) does the checklist's first two steps for every board and writes what it found back to the inventory sheet. It runs on the Windows laptop next to a USB hub, needs Python 3.9 or newer, and only two packages:

```powershell
pip install esptool pyserial
```

1. **Export the binary once.** Fill in `config.h` as above, then in the IDE choose Sketch, Export Compiled Binary: it lands under `build/` in the sketch folder as `TemperatureAlarms.ino.bin`. One board type per batch, since `DHT_PIN` is in the binary; a batch of integrated boards is a second export.
2. **Set the Admin token**, from the stack's `.env`, in the environment and nowhere else: `$env:ADMIN_TOKEN = "..."` in PowerShell, `set ADMIN_TOKEN=...` in cmd.
3. **Run the watcher** against the live server and the inventory sheet, a CSV with a `MAC` column (`ID` and `HOSTNAME` columns are used when present). Close the sheet in Excel first, since an open sheet cannot be written. Keep the sheet outside the repo: it lists every board's MAC, and the watcher writes `<sheet>.bench.csv` and, while saving, `<sheet>.tmp` next to it (`.gitignore` covers CSVs at the repo root and in `arduino/` in case one lands there):

   ```powershell
   python arduino\bench.py --server http://<host> --inventory "device_log - device_log.csv"
   ```

   It refuses to start when the binary is missing or older than a source file in the sketch folder, when `ADMIN_TOKEN` is unset or not the server's, or when the server's `/api/health` does not answer. Once running, plug boards in; ports present at start are ignored. Each new port is handled on its own thread, so a hub works several boards at once. Per board: esptool reads the MAC, the hostname is derived (`ESP_` plus the last six hex digits), the sheet row is looked up by MAC (a board off the sheet proceeds and gets a row of its own), the Device is registered under the Bench Campus with closet `Unassigned` (an existing hostname reads `already`), the binary is flashed at 921600 baud (460800 if the handshake fails), and the board is reset and read over serial for 70 seconds, two report attempts. One line per board says what happened:

   ```
   COM7  row 12  ESP_7AED5B  registered  flashed  PASS
   COM9  added row 94  ESP_1234AB  already  flashed  FAIL bad sensor
   ```

   PASS needs `device:` with the derived hostname, `wifi: connected`, a numeric `sensor:` line, and `report: 201 created`. `FAIL bad sensor` and `FAIL did not boot` keep the batch going and leave the Device registered. A `report: 401` (the Device token in the binary), no `wifi: connected` on the first board of the run (SSID or password), or `report: failed` (the server is unreachable from the bench) stops the batch and names which of the binary, the WiFi, or the server to fix. Ctrl-C stops after the boards in progress finish.
4. **Read the sheet and the log.** After each board, its sheet row is updated in place: `FLASHED` becomes TRUE, `TESTED` becomes TRUE on PASS or FALSE on a FAIL, and a `BENCH` column holds the verdict and the date; the three columns are added to the header when the sheet lacks them, and a board the sheet lacks gets a new row with the next `ID`. Rows the watcher did not touch are written back as they were, so edits made between boards survive. `<sheet>.bench.csv` next to the sheet also gains one row per board seen (time, port, sheet row, hostname, MAC, `registered` or `already`, `flashed`, verdict, reason); replugging a board runs it again and adds a row. On stop, the watcher prints the sheet rows no board answered for and the boards the sheet lacked at start. A Device on the Bench stays there, Offline, until Settings moves it to its Campus and Closet.

The watcher has run one batch of 92 boards (91 passed, one bad sensor). Its logic is unit-tested without hardware (see Tests and checks); a real board on the bench is the acceptance test for any change to it.

## Deployment

The Compose stack from the quick start is the deployment too, and deploying it is one step, two ways:

- **The deploy script.** On the server, `deploy/deploy.sh deploy --yes` (Linux, macOS) or `deploy\deploy.ps1 deploy --yes` (Windows Server) writes `.env` with generated secrets, builds and starts the stack, and checks it is healthy. Run either with no action for a menu that also upgrades, backs up, restores, shows the tokens and the `config.h` lines, and removes the stack. From one machine, `--host admin@server` (repeatable) or `--servers deploy/servers.txt` does the same on each server over ssh, each keeping its own `.env` and backups.
- **Ask your Claude agent.** In Claude Code in this repo, say "deploy this to admin@server", "upgrade", or "back up the database"; the `deploy` skill drives the script, keeps the secrets out of the chat, and ends on the health check.

[`DEPLOYMENT.md`](DEPLOYMENT.md) covers both, then the same steps by hand with `docker compose` as the fallback: first run and the end-to-end check, upgrades, backups and restore, migrating an old database in, TLS in front of the stack, and the manual PM2 and nginx install for a server that cannot run Docker.

## License

ISC
