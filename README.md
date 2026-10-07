# Temperature Alarms

**Know a closet is in trouble before the equipment does.**

Live temperature and humidity monitoring for the network closets across a school district. A NodeMCU board with a DHT11 sensor sits in each closet and posts a Reading every 30 seconds. The backend works out which Conditions a closet is in (Hot, Cold, Dry, Mold risk, Offline) and pushes every Reading to every open dashboard the moment it arrives.

![The dashboard on the demo, worst first: 24 closets across four campuses, three needing attention, led by a closet in Hot critical, then Mold risk high and Dry](docs/screenshots/dashboard-dark.png)

- **Live, not polled.** Cards update over Server-Sent Events. A Device that goes quiet reads as late, then Offline, with no reload.
- **Decided once, on the server.** Thresholds, Conditions, and Online or Offline are computed in one place, so every browser shows the same truth.
- **Worst first.** The Dashboard leads with the closet in the worst Condition, and a closet that worsens rises to the top as it happens; "By Campus" restores the familiar order.
- **What happened overnight.** The server records every incident (a Condition at warning or worse) as it starts, changes level, and ends. The Incidents page lays a night, a day, or a week out as a log on one shared ruler.
- **The district in one look.** The Campuses page puts every school on one row, worst first, with what it is in now, its worst closet, a week of daily highs against the Hot line, and the time since its last incident.
- **A day of history per Device.** Min, max, and average for each measure, any day in the last 90.
- **Two shared tokens, no accounts.** One for the people who administer Campuses and Devices, one flashed into every board. No logins to run.
- **One command to run it.** A Docker Compose stack: MySQL, the backend, and nginx on a single port, the same on a laptop and on the district server.

## Quick start

You need Docker (Docker Desktop on a laptop, Docker Engine with the Compose plugin on a server).

```bash
git clone https://github.com/HamzaQaz/Temperature-Alarms-React.git
cd Temperature-Alarms-React
cp .env.example .env        # set ADMIN_TOKEN, DEVICE_TOKEN, DB_PASSWORD, DB_ROOT_PASSWORD (openssl rand -hex 32 each)
docker compose up -d --build
```

Open `http://localhost/`. On **Settings**, paste the Admin token, add a Campus, and add a Device with the hostname `ESP_000001`. To see its card come alive without a board, run the virtual Device that ships in the stack as that hostname:

```bash
docker compose exec api node scripts/mock-device.mjs --hostname ESP_000001
```

The database lives on a named volume, so it survives `docker compose down`; `docker compose down -v` wipes it. The volume is named after the folder you cloned into (`temperature-alarms-react_db-data` here), so run the stack from the same folder, or pin the name with `COMPOSE_PROJECT_NAME` in `.env` as DEPLOYMENT.md explains. [`DEPLOYMENT.md`](DEPLOYMENT.md) covers upgrades, backups, migrating an old database in, TLS, and the manual install for a server that cannot run Docker.

## See it without hardware

One command brings up a living dashboard with no boards attached:

```bash
deploy/deploy.sh demo          # Windows: powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1 demo
```

Open `http://localhost:8080/` (`--web-port` picks another port). Four fictional schools and 24 closets appear, each with a week of history, and they keep reporting every 30 seconds. On a ten-minute loop one closet heats up through Hot warning to Hot critical and recovers, one dries out, one sits in Mold risk moderate then high, one goes cold, and one goes silent (late, then Offline) and comes back; the rest stay calm. The script prints the throwaway Admin token for Settings.

The demo runs under its own Compose project, `temperature-alarms-demo`, with its own database volume and generated secrets in `.env.demo`, so it never touches a real install's data. `deploy/deploy.sh demo --down` removes it, volume and `.env.demo` included. The pieces are `compose.demo.yaml` and `backend/scripts/demo.mjs`.

## Screenshots

All taken on the demo above.

- [Dashboard, light theme](docs/screenshots/dashboard-light.png)
- [Incidents](docs/screenshots/incidents.png): the last 7 days as a log on one shared ruler, each incident segmented by level
- [Campuses](docs/screenshots/campuses.png): every Campus worst first, with its week of daily highs against the Hot warning line
- [Dashboard filtered to one Campus](docs/screenshots/dashboard-campus.png), with the Gym closet in Hot critical
- [History for one Device](docs/screenshots/history.png): the day's averages, the chart, and the Readings table, on the day it climbed into Hot
- [Settings](docs/screenshots/settings.png) with the Admin token saved, on the Devices table
- On a phone: [Dashboard](docs/screenshots/phone-dashboard.png) and [History](docs/screenshots/phone-history.png)
- [A card escalating](docs/screenshots/escalation.gif) from Hot warning to Hot critical: the new border is traced from the badge around the card

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
├── frontend/      # React + TypeScript + Vite, Tailwind, shadcn/ui; src/pages/ holds Dashboard, Incidents, Campuses, History and Settings; e2e/ holds the browser walk
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
| `GET /api/campuses/overview?tz=America/Chicago` | none | `{timeZone, threshold, campuses}` for IT leadership: every Campus, worst first by its worst closet now (as the dashboard ranks Devices), then by name. Each is `{id, name, shortcode, closets, level, now, worst, days, lastIncident}`: `now.conditions` counts closets per Condition and level at warning or worse, and `now.headsUp` counts moderate Mold risk apart; `worst` is the worst closet with its `latestReading`, `level`, `offline`, and `conditions` (null with no Devices); `days` is the last seven local days in `tz` (the server's zone by default; an unknown one is 422), oldest first, each with its bounds, `maxTempF` (null with no Readings), `incident`, true when an incident overlapped it, and `incidentLevel`, the worst level an incident reached that day (null without one); today is `partial`. `lastIncident` is `{ongoing: true, start}` while one is open, else `{ongoing: false, end}` for the latest to close within the retention window, else null. `threshold` is the Hot warning line the server uses, for the chart, and `retentionDays` how far back Readings (and so the last incident) reach. The completed days' highs are reused for up to five minutes; today's are read on every request. Example below |
| `POST /api/campuses` | Admin | `{name, shortcode}` → 201 Campus; 409 when the shortcode exists |
| `DELETE /api/campuses/:id` | Admin | 204; 409 while the Campus still has Devices |
| `GET /api/devices` | none | `[{id, hostname, closet, campus, tokenMismatchAt}]` by Campus name, then closet. `tokenMismatchAt` is when the board was last refused for its Device token (a Reading or firmware check claiming that hostname with a wrong token), within the last 15 minutes and not since followed by an accepted Reading; otherwise null. Anyone can claim a hostname, so it is a hint, not proof |
| `POST /api/devices` | Admin | `{hostname, campusId, closet}` → 201 Device; hostname must be `ESP_` plus six hex digits; 409 when it exists; 422 when the Campus does not |
| `PATCH /api/devices/:id` | Admin | `{closet?, campusId?}` → the updated Device. The hostname never changes: a replaced board is a new Device, and a body carrying `hostname` is 422 |
| `DELETE /api/devices/:id` | Admin | 204; the Device's Readings and incidents go with it |
| `GET /api/firmware` | Device | The boards' hourly update check (ADR 0007): the Device token as Basic credentials `device:<token>` (or a Bearer header), with the ESP8266 update library's `x-ESP8266-STA-MAC` and `x-ESP8266-version` headers. 304 when there is nothing newer for that board, otherwise 200 with the signed image (`application/octet-stream`, `x-MD5`). Records the version the board reported. 400 without a MAC, 404 for an unregistered board. Shares the Readings route's wrong-token limit |
| `POST /api/firmware?only=ESP_A,ESP_B` | Admin | Publishes a signed build, the request body as `application/octet-stream` (up to 1 MB), to every Device or only those named → 201 `{version, size, md5, publishedAt, only}`. 422 for an unsigned image, one without a version marker, or a version lower than the published one (the same version again changes who it is offered to) |
| `DELETE /api/firmware` | Admin | 204; no build is offered until the next publish |
| `GET /api/firmware/status` | Admin | `{release, devices}`: the published build (or null) and every Device with the `firmwareVersion` and `checkedAt` of its last update check (null until it first checks) |
| `GET /api/devices/pending` | Admin | Boards that reported with the Device token but are not registered (their Readings get 404), most recently heard first: `[{hostname, firstSeen, lastSeen, reports, lastReading: {tempF, humidity} \| null, address, ignored}]`. Settings' New devices tab and its pop-up show them; adopting one is `POST /api/devices` with its hostname, which takes it off the list. Only `ESP_` plus six hex digits is kept, and at most 500 |
| `PATCH /api/devices/pending/:hostname` | Admin | `{ignored: boolean}`: hide a waiting board from the pop-up (it stays listed); 404 if it is not listed |
| `DELETE /api/devices/pending/:hostname` | Admin | 204; forgotten until it reports again |
| `GET /api/devices/rotation` | Admin | `{active, since, previous, unheard}` for a Device token rotation: `active` is true while `DEVICE_TOKEN_PREVIOUS` is set; `previous` lists the Devices whose latest Reading came with the previous token, and `unheard` those not heard at all since `since`, when api started (both empty when not `active`). Settings shows it; `deploy.sh rotate-device-token --finish` waits for both to be empty |
| `POST /api/readings` | Device | The Device token, or during a rotation the previous one too. `{device, temp, humidity}`, plus, from firmware 3, what the board says about itself: `fw` (its `FIRMWARE_VERSION`), `rssi` (dBm), `uptime` (seconds), `heap` (free bytes), `reset` (why it last restarted) and `update` (its last update check). Each is optional and dropped if out of range; the Firmware tab shows the latest. When a newer build is published for that board, the 201 carries `X-Firmware-Available: <version>` and the board checks for it at once. from the board (`device` is its hostname, `temp` in °F) → 201 `{device, reading: {tempF, humidity, recordedAt}}`; 404 when no Device has that hostname; 422 when a number is missing, `temp` is outside -40 to 200 °F, or `humidity` is outside 0 to 100 (a sensor fault, not a Reading). Limited to 20 Readings a minute per Device, then 429 |
| `GET /api/dashboard?campus=SHORTCODE&order=worst\|campus` | none | `{reportIntervalSeconds, offlineAfterSeconds, devices}`: every Device (or only that Campus's), worst first by default (critical, high, warning with Offline among it, moderate, then none; ties by Campus name then closet), or by Campus name then closet with `order=campus`; any other order is 422. Each Device comes with `latestReading`, `online`, `secondsSinceReading`, its `conditions` worst first, and `tokenMismatchAt` (as in `GET /api/devices`); the card says "Token mismatch" while it is set |
| `GET /api/dashboard/stream` | none | Server-Sent Events: one message per Reading ingested, `{type: "reading", device, reading, online, conditions}`; one per incident that opens, changes level, or closes, `{type: "incident", change: "opened" \| "level" \| "closed", incident}` with the incident as `/api/incidents` sends it; plus a heartbeat comment every 25 seconds to keep proxies from closing the stream. Every message is unnamed: tell them apart by `type` |
| `GET /api/incidents?from=<ISO>&to=<ISO>` | none | `{from, to, incidents}`: every incident that overlaps the window, ongoing ones included, oldest first. Each is `{id, device: {id, hostname, closet, campus}, condition, level, start, end, peak: {value, tempF, humidity, recordedAt}, segments: [{level, start, end}]}`: `level` is the worst reached, `end` is null while ongoing, `peak.value` is °F for Hot and Cold, percent for Dry and Mold risk, and null for Offline (whose peak is the last Reading before it). `from` and `to` are ISO instants with a zone; 422 unless `from` is before `to` and the window is at most 8 days. An incident is a Condition at warning or worse; see ADR 0006 for when one opens and closes |
| `GET /api/devices/:id/history?date=YYYY-MM-DD&tz=America/Chicago` | none | One local day of Readings, oldest first, with `summary` min, max, and average for each measure. `date` defaults to today and `tz` to the server's zone. At most 30,000 Readings, more than a day at the ingest limit: past that, the first 30,000 are sent, `truncated` is true, the summary covers only those, and the History page says so |
| `DELETE /api/devices/:id/history` | Admin | 204; every Reading and incident of that Device is gone |

An overview with one Campus, trimmed to two of its seven days:

```json
{
  "timeZone": "America/Chicago",
  "threshold": { "name": "Hot", "level": "warning", "tempF": 82 },
  "retentionDays": 90,
  "campuses": [
    {
      "id": 1, "name": "Riverside High School", "shortcode": "RHS", "closets": 8, "level": "critical",
      "now": {
        "conditions": [{ "name": "Hot", "level": "critical", "count": 1 }, { "name": "Offline", "level": "warning", "count": 1 }],
        "headsUp": [{ "name": "Mold risk", "level": "moderate", "count": 1 }]
      },
      "worst": {
        "id": 3, "hostname": "ESP_4F2A10", "closet": "IDF 3 (Gym)", "closetType": "IDF",
        "latestReading": { "tempF": 91, "humidity": 35, "recordedAt": "2026-10-05T03:20:00Z" },
        "level": "critical", "offline": false, "conditions": [{ "name": "Hot", "level": "critical" }]
      },
      "days": [
        { "date": "2026-10-03", "from": "2026-10-03T05:00:00Z", "to": "2026-10-04T05:00:00Z", "partial": false, "maxTempF": 83, "incident": true, "incidentLevel": "warning" },
        { "date": "2026-10-04", "from": "2026-10-04T05:00:00Z", "to": "2026-10-05T05:00:00Z", "partial": true, "maxTempF": 91, "incident": true, "incidentLevel": "critical" }
      ],
      "lastIncident": { "ongoing": true, "start": "2026-10-05T03:17:30Z" }
    }
  ]
}
```

Tokens are sent as `Authorization: Bearer <token>`. The Admin token is the one the Settings page keeps; the Device token is flashed into every Device. Neither works in the other's place. See ADR 0003 for why there are two and what that trades away. The Conditions the API reports are defined in [`CONTEXT.md`](CONTEXT.md); the thresholds behind them are the `HOT_`, `COLD_`, and `DRY_` settings in `.env.example`.

Browsers are accepted from the API's own origin, which is how the stack serves them, and from one more origin named in `CORS_ORIGIN` for a dev server on another port.

Apart from Readings, which have the per-Device limit above, `/api/` allows each client address 6,000 reads (GET and HEAD) and 500 other requests per 15 minutes. The reads are sized for about 30 open tabs behind one address: a Campuses tab, the busiest page, reloads at most every 10 seconds. The address is the one the stack's nginx saw: the backend trusts exactly one proxy hop. With another proxy in front, such as the TLS proxy in DEPLOYMENT.md, that address is the proxy's, so every browser shares one allowance, unless `TRUST_PROXY` in `.env` names the proxy. nginx then takes the browser's address from the proxy's `X-Forwarded-For` ([TLS in front of the stack](DEPLOYMENT.md#tls-in-front-of-the-stack)).

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
| `server.h/.cpp`, `roots.h/.cpp` | Where `SERVER_URL` is; over `https://`, a TLS client that accepts only a Let's Encrypt certificate for that name, with the time taken from the server |
| `updater.h/.cpp`, `version.h` | Over-the-air updates: every hour, install a newer signed build if the server offers one; `FIRMWARE_VERSION` is this build's number |
| `config.example.h` | Template for the gitignored `config.h`: SSID, password, server URL, Device token, interval, sensor pin |

There is no on-device web server, no retry loop, and no per-Device setting. Your router's DHCP list shows the same six digits as `ESP-xxxxxx`.

### Libraries and board settings

The sketch compiles clean against these versions; install them from the IDE's Boards Manager and Library Manager. Build production binaries with exactly these, not whatever is newest: the same `config.h` and the same three versions give the same firmware, so a board flashed months later behaves like the rest of its batch. When a version changes, compile, run one board through the bench checklist, and update this table in the same commit.

| Dependency | Version | Where |
| --- | --- | --- |
| esp8266 by ESP8266 Community | 3.1.2 | Boards Manager, after adding `https://arduino.esp8266.com/stable/package_esp8266com_index.json` under Preferences, Additional boards manager URLs |
| DHT sensor library by Adafruit | 1.4.7 | Library Manager |
| Adafruit Unified Sensor | 1.1.15 | Library Manager (the DHT library depends on it; accept the prompt to install it) |

Board settings, under Tools: board **NodeMCU 1.0 (ESP-12E Module)**, upload speed 115200, CPU 80 MHz, flash size 4MB (any FS split), everything else at its default. The serial monitor runs at 115200.

### Flashing

1. Copy `arduino/TemperatureAlarms/config.example.h` to `config.h` in the same folder and fill in the WiFi credentials (leave the password `""` for an open network that admits Devices by MAC allowlist, and see [Secrets on the board](#secrets-on-the-board) first), and the server URL without a trailing slash (the sketch appends `/api/readings`). For production boards that is `https://YOUR_DOMAIN`, the same name the dashboard is served at, HTTPS, checked against Let's Encrypt's roots like a browser checks it, is the transport the district chose (see [Transport for production boards](#transport-for-production-boards) below, and run its checks first). On a desk or a lab network, `http://<host>` works too. A Device flashed with `http://<host>` keeps reporting after TLS goes in front, by hostname or by address, but only through the plain-HTTP Readings route that DEPLOYMENT.md's TLS proxy keeps; the Device cannot follow a redirect to HTTPS. Then the `DEVICE_TOKEN` from the stack's `.env`, the interval, which must equal the backend's `REPORT_INTERVAL_SECONDS`, and the sensor pin (5 for a wired DHT11, 4 for an integrated one). `config.h` is gitignored.
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

Over an `https://` server URL the board checks the server's certificate as a browser does: it must chain to one of Let's Encrypt's roots, built into the firmware (`roots.cpp`: ISRG Root X1, X2, YE, and YR), and name `SERVER_URL`'s host. Checking dates needs the time, which the board takes from the server's own `Date` header (a GET of `/api/health`, with no token); until it has it, it sends nothing (serial says `no time from the server yet`). Renewals, a new server key, or a rebuilt server never need a reflash. ADR 0001 records the decision.

### Transport for production boards

Decided 2026-10-06 (ADR 0001): production boards post over **HTTPS to `https://YOUR_DOMAIN`**, the name the dashboard is reached at too, and check its certificate against **Let's Encrypt's roots**, built into the firmware. The token is encrypted on the wire and goes only to a server with a valid certificate for that name: a spoofed DNS answer, a rogue access point, or any other host fails the handshake before the request goes out, and the board logs `report: failed` and records nothing. Nothing about the server's key is in the boards, so certbot's renewals, a new key, or a rebuilt server need no reflash, and anything that does change is an [over-the-air update](#updating-boards-over-the-air), not a visit to every closet.

Before flashing day:

- [ ] **The server has a Let's Encrypt certificate for `YOUR_DOMAIN`** (DEPLOYMENT.md, step 6), renewing on its own. If the name is not reachable from the internet, issue it with a DNS challenge rather than `--nginx`.
- [ ] **The device network** resolves `YOUR_DOMAIN` to the server and lets the boards reach it on TCP 443, and nothing else besides its DNS resolver. Give the boards an SSID and VLAN of their own with client isolation (if the SSID is open, by MAC allowlist, it is this VLAN). The board takes the time from the server, so no time server is needed.
- [ ] **Checked from a machine on the device network:** `nslookup YOUR_DOMAIN` gives the server's address; `curl -i https://YOUR_DOMAIN/api/health` answers `200` (curl checks the certificate the same way); `openssl s_client -connect YOUR_DOMAIN:443 -servername YOUR_DOMAIN -verify_return_error </dev/null 2>&1 | grep 'Verify return code'` prints `Verify return code: 0 (ok)`.
- [ ] **The signing keys exist** and are in the sketch folder ([Updating boards over the air](#updating-boards-over-the-air), one-time setup), so the boards flashed over USB on flashing day are the last ones anyone flashes by hand.
- [ ] **One board on the bench first:** serial shows `server: https, 4 roots, time from the server` and `update: on, signed builds only, hourly` at boot, then `report: 201 created`. That also proves the board has the heap for TLS.

What is accepted: anyone able to get a Let's Encrypt certificate for `YOUR_DOMAIN` (that is, whoever controls its DNS) could stand in for the server, as for any browser. The roots last until 2035 (X1) to 2045 (YE, YR), the firmware does not check a root's own expiry, and new roots can be shipped over the air. Anyone holding a board can still read the token from its flash (next section).

### Secrets on the board

Every board carries the WiFi password and the Device token in plain text: in `config.h`, in the exported `.bin`, and in the board's flash, where anyone holding the board reads them back over USB with `esptool read_flash`. The ESP8266 has no flash encryption or secure boot, so no build setting changes that. Treat a board like a key to the closet network.

- **What the Device token allows.** Posting Readings, and nothing else: it cannot read anything the dashboard does not already show, or change Campuses or Devices. A Reading is accepted only for a hostname registered in Settings (the dashboard lists them), at most 20 a minute per hostname, so a stolen token can send false temperatures for any registered Device: open false incidents, or hide a real one by posting normal values over it. Every board shares the one token, so one lost board exposes all of them.
- **What the WiFi password allows.** Joining the Devices' network. Give the boards an SSID and VLAN of their own that reaches only the server's port 443, with client isolation, so the password opens nothing else.
- **An open network** (`WIFI_PASSWORD ""`) is only for an SSID that admits Devices by MAC allowlist, and a MAC allowlist stops nobody determined: the MACs are on the inventory sheet and in every frame the boards send. Use it only on that same isolated VLAN.
- **Serial.** The firmware never prints the token or the WiFi password; serial shows the SSID, the server URL, the hostname, and each report's status. A refused report prints at most 120 printable characters of the server's answer, so the bench log carries no secret, and a server cannot write a line of its own into it.
- **Where the token goes.** Only to `SERVER_URL`: the firmware never follows a redirect (a 3xx is logged as `report: 3xx` and nothing is recorded). Over `http://`, anyone who can see the traffic reads the token. Over `https://`, as production boards are flashed, it is encrypted and sent only after the server shows a valid certificate for its name, so a machine that answers for the server's name (a spoofed DNS answer, an ARP spoof, a rogue access point) gets a failed handshake, not the token.
- **A lost or stolen board**, or a token seen in the wrong place: rotate the token, without a dark fleet. The backend accepts the previous token next to the new one until you say the rotation is over:
  1. On the server, `deploy/deploy.sh rotate-device-token` (or `deploy.ps1`). It moves the current token to `DEVICE_TOKEN_PREVIOUS`, generates a new `DEVICE_TOKEN`, restarts `api` with both, and prints the new `config.h` line, masked; `deploy.sh info --reveal` prints it in full. Boards on either token keep reporting.
  2. Put the new token in `config.h`, raise `FIRMWARE_VERSION`, export once, and [publish it over the air](#updating-boards-over-the-air): boards download it with the token they still carry, which the server accepts until step 4. A board that does not update (offline, or flashed before over-the-air updates) is reflashed with the watcher, which takes boards already registered (`already`) without moving them from their Campus and Closet.
  3. Watch Settings: while a rotation is under way it lists every Device whose latest Reading still came with the previous token, and any Device the server has not heard since it last restarted. `api`'s log also names each Device still on the previous token, once an hour, by hostname.
  4. When the list is empty, `deploy/deploy.sh rotate-device-token --finish` clears the previous token, and only the new one is accepted from then on. It refuses while any Device is listed; a Device that is gone for good can be deleted in Settings, or `--finish --force` (with a typed confirmation) ends the rotation anyway, and the boards left on the old token stop reporting until they are reflashed.

  A lost board's token stays valid until `--finish`, so for a stolen board finish as soon as the fleet is reflashed. One rotation at a time: a second `rotate-device-token` is refused until the first is finished.
- **The signing key is a secret too.** `private.key` (next section) signs every build the boards will install; whoever holds it and can reach the server's Admin token could install their own firmware on every board. Keep it on the build laptop and in one offline backup, never in the repo (`.gitignore` covers it).
- **The exported `.bin` is a secret.** Keep it under the sketch's `build/` (gitignored, as is any `.bin` under `arduino/`), never copy it to a share or a ticket, and delete it when the batch is done.

### Bench checklist

Run through this once per Device, on a desk, before it goes into a closet.

1. **Hostname on serial.** After `wifi: connected` the log prints `device: ESP_xxxxxx`. Add that hostname as a Device in Settings, or adopt it: a board reporting with the right token but not added yet appears under Settings, New devices (and as a pop-up for anyone with the Admin token), with its last Reading and address. Until it is added, every POST is refused with a 404 naming the hostname. A board flashed with the wrong token shows "Token mismatch" on its card instead, if it is already added.
2. **First POST returns 201.** Within one interval the log shows a `sensor:` line with the temperature and humidity, then `report: 201 created`, and the Device's card updates on the dashboard. A `report: 401` means the token in `config.h` does not match the backend's `DEVICE_TOKEN`.
3. **Unplugged sensor yields skipped samples.** Pull the DATA wire: each interval logs `sensor: read failed (NaN), sample skipped` and nothing is posted, so the history never records a zero. Plug it back in and posting resumes at the next interval.
4. **Router reboot yields resumed posting.** Power-cycle the access point: the log shows `wifi: connection lost, reconnecting`, then `wifi: reconnected` with the new address, and the next Reading goes out without the Device restarting. The `report:` lines that fail in between are logged and not retried.

### Flashing a batch

For a box of boards, [`arduino/bench.py`](arduino/bench.py) does the checklist's first two steps for every board and writes what it found back to the inventory sheet. It runs on the Windows laptop next to a USB hub, needs Python 3.9 or newer, and only two packages:

```powershell
pip install esptool pyserial
```

1. **Export the binary once.** Fill in `config.h` as above, then in the IDE choose Sketch, Export Compiled Binary: it lands under `build/` in the sketch folder as `TemperatureAlarms.ino.bin`. One board type per batch, since `DHT_PIN` is in the binary; a batch of integrated boards is a second export.
2. **Set the Admin token**, from the stack's `.env`, in the environment and nowhere else: `$env:ADMIN_TOKEN = "..."` in PowerShell, `set ADMIN_TOKEN=...` in cmd. The watcher never prints it or writes it to the sheet or the log. It does send it with every registration, so give `--server` an `https://` URL once a TLS proxy is in front; over `http://`, run the bench only on a network you trust, such as the Devices' VLAN or a cable to the server's LAN. The watcher never follows a redirect, so an `http://` URL that the proxy redirects stops it at startup, naming the URL to use instead. Close the PowerShell window when the batch is done.
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
5. **Clean up.** Delete the exported `.bin` (it holds the WiFi password and the Device token), close the window that holds `ADMIN_TOKEN`, and keep the sheet where only technicians can read it.

The watcher has run one batch of 92 boards (91 passed, one bad sensor). Its logic is unit-tested without hardware (see Tests and checks); a real board on the bench is the acceptance test for any change to it.

### Updating boards over the air

Every board learns of a newer build within one Report interval of its publication: the server says so in its answer to the board's next Reading, and the board checks at once (at most once a minute). It also checks 30 seconds after boot and every hour regardless. It installs the build and restarts; nobody visits a closet. Boards on firmware before version 3 only check hourly and at boot, so their first update to version 3 or later can take up to an hour; after that, updates arrive within a Report interval. Only builds signed with the district's key are installed: the board checks the signature itself before it boots the new build, so not even someone who takes over the server can put their own firmware on the boards. The server offers a build only to Devices that present the Device token, since the image holds the WiFi password and the token. ADR 0007 has the design.

**One-time setup, before flashing day.** On the build laptop, in the sketch folder (`arduino\TemperatureAlarms`), with OpenSSL (Git for Windows has it in `C:\Program Files\Git\usr\bin`):

```bash
openssl genrsa -out private.key 2048
openssl rsa -in private.key -pubout -out public.key
```

With `public.key` there, every build turns updates on and refuses anything unsigned; with `private.key` there, every build also writes a signed copy, `TemperatureAlarms.ino.bin.signed`, next to the `.bin`. Both files are gitignored. Copy `private.key` to one offline place (a password manager, an encrypted USB key in a safe): if it is lost, boards keep running, but the next update means USB for every board (with new keys); if it leaks, rotate it the same way. The boards flashed over USB on flashing day must be built with the keys present, or they never check for updates (serial says `update: off, this build is not signed`).

**Every update after that:**

1. Make the change (code, `config.h`, a new Device token), and raise `FIRMWARE_VERSION` in `version.h` by one. A board installs a build only if its number is higher than its own.
2. Export the binary (Sketch, Export Compiled Binary). Use `TemperatureAlarms.ino.bin.signed` from `build/`; the server refuses the unsigned `.bin`.
3. **One board first.** In Settings, on the Firmware tab, choose the `.signed` file, type one bench board's hostname under "Only these Devices", and Publish. Within a Report interval that board downloads it, restarts, and reports; the tab shows it on the new version. On its serial: `update: ...` lines, a restart, `firmware: TA-FIRMWARE-VERSION=<new>`, then `report: 201 created`.
4. **Then every board.** Publish the same file again with "Only these Devices" empty. Within a Report interval or two every board takes it; the tab counts them and names any still on an older build, and any that never checked in.
5. Delete the exported files (they hold the WiFi password and the Device token).

The same from the server's shell: `deploy/deploy.sh publish-firmware --file TemperatureAlarms.ino.bin.signed --only ESP_A1B2C3`, then again without `--only`; `deploy/deploy.sh firmware-status`; `deploy/deploy.sh withdraw-firmware` stops offering a build (boards keep what they run).

**What can go wrong.** A build that cannot join WiFi or reach the server can never be fixed over the air, since the update check needs both: that is what step 3 is for. The ESP8266 does not roll back to the previous build on its own; a board stuck on a bad build is a USB flash. A download cut short is simply retried at the next check (the board verifies the image's MD5 and signature before switching to it, and keeps running the old build until then). A board flashed before over-the-air updates, or built without the keys, shows as "never checked" on the Firmware tab and needs one USB flash.

## Deployment

The Compose stack from the quick start is the deployment too, and deploying it is one step, two ways:

- **The deploy script.** On the server, `deploy/deploy.sh deploy --yes` (Linux, macOS) or `deploy\deploy.ps1 deploy --yes` (Windows Server) writes `.env` with generated secrets, builds and starts the stack, and checks it is healthy. Run either with no action for a menu that also upgrades, backs up, schedules a nightly backup, restores, shows the tokens and the `config.h` lines, and removes the stack. From one machine, `--host admin@server` (repeatable) or `--servers deploy/servers.txt` does the same on each server over ssh, each keeping its own `.env` and backups.
- **Ask your Claude agent.** In Claude Code in this repo, say "set up the new server admin@server", "deploy this to admin@server", "upgrade", or "back up nightly"; the `deploy` skill drives the script, keeps the secrets out of the chat, and ends on the health check.

A fresh Linux server (Ubuntu, Debian, RHEL, Rocky, AlmaLinux, CentOS Stream, Fedora) needs only git and sudo (on a minimal Debian or Ubuntu, such as a Proxmox CT, `sudo apt-get install -y git` first; see [Proxmox LXC](DEPLOYMENT.md#proxmox-lxc)):

```bash
git clone <repo-url> temperature-alarms && cd temperature-alarms
deploy/deploy.sh bootstrap        # Docker Engine and Compose from Docker's repository, cron, the docker group
# log out and back in, then:
cd temperature-alarms && deploy/deploy.sh deploy --yes
```

From another machine, `deploy/deploy.sh deploy --bootstrap --host admin@server --yes` does both over ssh, with no git needed on the server first.

[`DEPLOYMENT.md`](DEPLOYMENT.md) covers both, then the same steps by hand with `docker compose` as the fallback: first run and the end-to-end check, upgrades, backups and restore, migrating an old database in, TLS in front of the stack, what the stack hardens and what it needs from you, and the manual PM2 and nginx install for a server that cannot run Docker.

## License

ISC
