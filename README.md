# Temperature Alarms

Live temperature and humidity monitoring for network closets across school campuses.

Each closet has a **Device**: a NodeMCU (ESP8266) board with a **DHT11** temperature and humidity sensor. The Device posts a Reading to the backend on a fixed Report interval, and the backend pushes it to every open dashboard over Server-Sent Events.

The vocabulary used throughout the code and docs is defined in [`CONTEXT.md`](CONTEXT.md). The decisions behind the architecture are recorded as ADRs in [`docs/adr/`](docs/adr/):

- [0001 — HTTP POST from Devices, SSE to browsers, single backend process](docs/adr/0001-http-post-from-devices-sse-to-browsers.md)
- [0002 — A single `readings` table](docs/adr/0002-single-readings-table.md)
- [0003 — Two shared tokens instead of user accounts](docs/adr/0003-shared-tokens-not-user-accounts.md)
- [0004 — Ninety-day raw retention](docs/adr/0004-ninety-day-raw-retention.md)
- [0005 — One Docker Compose file, built from the clone](docs/adr/0005-docker-compose-runs-the-whole-system.md)

## Repository layout

```
.
├── arduino/     # ESP8266 sketch for the NodeMCU + DHT11 Device, and its wiring diagram
├── backend/     # Express + TypeScript API, MySQL
├── frontend/    # React + TypeScript + Vite, Tailwind, shadcn/ui
├── docs/adr/    # Architecture decision records
├── compose.yaml # The whole system: db, api, and web on one port (docs/adr/0005)
├── .env.example # The stack's settings; copy to .env
├── CONTEXT.md   # Domain vocabulary
└── DEPLOYMENT.md
```

## Hardware

| Part | Notes |
| --- | --- |
| NodeMCU (ESP8266) | Identifies itself by hostname: `ESP_` plus the last six hex digits of its MAC |
| DHT11 | Temperature and humidity, data pin on GPIO 5 (D1) when wired separately, GPIO 4 (D2) on boards that carry it soldered on |

The full wiring diagram, library versions, and flashing steps live in the [firmware section](#firmware).

## Local development

### Run the stack

The way to run the system, on a laptop or a server, is the Docker Compose stack at the repo root: MySQL, the backend, and nginx serving the dashboard and proxying `/api/` on one port (ADR 0005). With Docker Desktop installed:

```bash
cp .env.example .env     # set ADMIN_TOKEN, DEVICE_TOKEN, DB_PASSWORD (openssl rand -hex 32 each)
docker compose up -d --build
docker compose ps        # db and api healthy, web running
```

Open `http://localhost/`, paste the Admin token on Settings, and add a Campus and a Device. The database lives on a named volume, so it survives `docker compose down`; `docker compose down -v` wipes it. `DEPLOYMENT.md` covers upgrades, backups, migrating an old database in, and TLS.

To see a card move without a board, run the virtual Device inside the stack. It takes the Device token and port from the container, so only the hostname you registered is needed:

```bash
docker compose exec api node scripts/mock-device.mjs --hostname ESP_000001
```

### Working on the code

Run the two packages by hand when you are changing them; each reloads on save. You need Node.js 20 or newer and a MySQL 8 the backend can use; the stack's `db` is not published, so it is not that one.

### Backend

```bash
cd backend
npm install
cp .env.example .env   # fill in database credentials
npm run dev            # http://localhost:3001
```

The backend expects a MySQL database named in `.env` and creates the schema itself on start through its migration runner. It refuses to start without `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `ADMIN_TOKEN`, and `DEVICE_TOKEN`, naming whatever is missing. See `backend/.env.example` for every setting the server reads, and `DEPLOYMENT.md` for upgrading a database from the old per-Device tables.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env   # VITE_API_URL points at the backend
npm run dev            # http://localhost:5173
```

`VITE_API_URL` is the only setting the frontend reads. Unset, every request goes to the page's own origin, which is how `frontend/Dockerfile` builds it for the stack; the dev server needs it set because Vite serves on its own port.

### Root shortcuts

The root `package.json` wraps both packages:

```bash
npm run install:all
npm run dev:backend
npm run dev:frontend
npm run build:all
npm run start:backend
```

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

The frontend has no component tests. Its pure functions (timing, closet parsing, dates) have unit tests that run on Node's own test runner and type stripping, so there is nothing extra to install; lint and typecheck cover the rest, and `npm run build` runs the typecheck first.

```bash
cd frontend
npm test               # node --test over src/**/*.test.ts
npm run lint           # eslint
npm run typecheck      # tsc -b, including the tests
```

To watch the dashboard react without a board, run the virtual Device against your dev backend. It posts a Reading every interval with the Device token and logs in the firmware's style, so `report: 404` means the hostname is not registered yet:

```bash
cd backend
node scripts/mock-device.mjs --hostname ESP_000001 --token dev-device --interval 30
node scripts/mock-device.mjs --hostname ESP_000002 --count 3       # three Readings, then silence: watch the card go Offline
```

Against the stack, the same script runs inside the `api` container with `docker compose exec api node scripts/mock-device.mjs ...`, where the token and port are already set.

Both packages pass these on a clean clone; run them before a commit. The dashboard card shows "Expected Ns ago" once a Device misses a report, and Offline once the server has declared it (three missed reports); the page asks the server again at that moment, since the browser never computes a Condition itself.

## API

Every response with a body is JSON. Errors carry `{ "error": "<message>" }` with the status: 400 for malformed JSON, 401 for a missing or wrong token, 404 for an unknown Campus or Device, 409 for a conflict, 422 for a body that failed validation, 429 when a rate limit is hit. Shortcodes and hostnames are stored upper-case, so `chs` and `CHS` name the same Campus.

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
| `POST /api/readings` | Device | `{device, temp, humidity}` from the board (`device` is its hostname, `temp` in °F) → 201 `{device, reading: {tempF, humidity, recordedAt}}`; 404 when no Device has that hostname; 422 when a number is missing. Limited to 20 Readings a minute per Device, then 429 |
| `GET /api/dashboard?campus=SHORTCODE` | none | `{reportIntervalSeconds, offlineAfterSeconds, devices}`: every Device (or only that Campus's), by Campus name then closet, each with `latestReading`, `online`, `secondsSinceReading`, and its `conditions` worst first |
| `GET /api/dashboard/stream` | none | Server-Sent Events: one message per Reading ingested, `{type: "reading", device, reading, online, conditions}`, plus a heartbeat comment every 25 seconds to keep proxies from closing the stream |
| `GET /api/devices/:id/history?date=YYYY-MM-DD&tz=America/Chicago` | none | One local day of Readings, oldest first, with `summary` min, max, and average for each measure. `date` defaults to today and `tz` to the server's zone |
| `DELETE /api/devices/:id/history` | Admin | 204; every Reading of that Device is gone |

Tokens are sent as `Authorization: Bearer <token>`. The Admin token is the one the Settings page keeps; the Device token is flashed into every Device. Neither works in the other's place. See ADR 0003 for why there are two and what that trades away. The Conditions the API reports are defined in [`CONTEXT.md`](CONTEXT.md); the thresholds behind them are the `HOT_`, `COLD_`, and `DRY_` settings in `backend/.env.example`.

## Firmware

The sketch in [`arduino/TemperatureAlarms/`](arduino/TemperatureAlarms/) is the one firmware for every Device: a NodeMCU (ESP8266) reads a DHT11 on GPIO 5 and posts a Reading every Report interval. It is a folder the Arduino IDE compiles together, one job per file:

| File | Job |
| --- | --- |
| `TemperatureAlarms.ino` | `setup` and `loop` only: when a Reading is due, read once and report once |
| `network.h/.cpp` | Join WiFi at boot, reconnect from the loop without a reboot, name the Device |
| `sensor.h/.cpp` | Read the DHT11, skip a NaN sample and say so on serial |
| `reporter.h/.cpp` | Build the JSON Reading and POST it with the Device token, log the HTTP status |
| `config.example.h` | Template for the gitignored `config.h`: SSID, password, server URL, Device token, interval, sensor pin |

There is no on-device web server, no retry loop, and no per-Device setting: each Device names itself `ESP_` plus the last six hex digits of its MAC, and that hostname is what you register in Settings. Your router's DHCP list shows the same digits as `ESP-xxxxxx`.

### Wiring

![NodeMCU wired to a DHT11: DATA on D1 (GPIO 5), VCC on 3V3, GND on GND](arduino/dht11-pinout.svg)

| DHT11 pin | NodeMCU pin |
| --- | --- |
| VCC | 3V3 (not VIN) |
| DATA | D1 (GPIO 5) |
| GND | GND |

A bare four-pin sensor needs a 10 kΩ pull-up between DATA and VCC or every read is NaN; its third pin stays unconnected. Three-pin modules carry that resistor already, so wire them the same way, but check the silkscreen because the pin order varies by module.

A NodeMCU sold with the DHT11 already soldered on needs no wiring at all, but its sensor sits on D2 (GPIO 4), so set `DHT_PIN 4` in `config.h`. Every read comes back NaN until the pin matches the board.

### Libraries and board settings

The sketch compiles clean against these versions; install them from the IDE's Boards Manager and Library Manager.

| Dependency | Version | Where |
| --- | --- | --- |
| esp8266 by ESP8266 Community | 3.1.2 | Boards Manager, after adding `https://arduino.esp8266.com/stable/package_esp8266com_index.json` under Preferences, Additional boards manager URLs |
| DHT sensor library by Adafruit | 1.4.7 | Library Manager |
| Adafruit Unified Sensor | 1.1.15 | Library Manager (the DHT library depends on it; accept the prompt to install it) |

Board settings, under Tools: board **NodeMCU 1.0 (ESP-12E Module)**, upload speed 115200, CPU 80 MHz, flash size 4MB (any FS split), everything else at its default. The serial monitor runs at 115200.

### Flashing

1. Copy `arduino/TemperatureAlarms/config.example.h` to `config.h` in the same folder and fill in the WiFi credentials, the server URL without a trailing slash (the sketch appends `/api/readings`): `http://<host>` where the stack runs, with a port only if `WEB_PORT` was changed, or `https://YOUR_DOMAIN` once TLS sits in front of it. Then the `DEVICE_TOKEN` from the stack's `.env`, the interval, which must equal the backend's `REPORT_INTERVAL_SECONDS`, and the sensor pin (5 for a wired DHT11, 4 for an integrated one). `config.h` is gitignored.
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

## Deployment

The Compose stack above is the deployment too: the same `docker compose up -d --build` on the district server, with `.env` holding the real tokens. [`DEPLOYMENT.md`](DEPLOYMENT.md) covers first run and the end-to-end check, upgrades, backups and restore, migrating an old database in, TLS in front of the stack, and the manual PM2 and nginx install for a server that cannot run Docker.

## License

ISC
