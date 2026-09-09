# Temperature Alarms

Live temperature and humidity monitoring for network closets across school campuses.

Each closet has a **Device**: a NodeMCU (ESP8266) board with a **DHT11** temperature and humidity sensor. The Device posts a Reading to the backend on a fixed Report interval, and the backend pushes it to every open dashboard over Server-Sent Events.

The vocabulary used throughout the code and docs is defined in [`CONTEXT.md`](CONTEXT.md). The decisions behind the architecture are recorded as ADRs in [`docs/adr/`](docs/adr/):

- [0001 — HTTP POST from Devices, SSE to browsers, single backend process](docs/adr/0001-http-post-from-devices-sse-to-browsers.md)
- [0002 — A single `readings` table](docs/adr/0002-single-readings-table.md)
- [0003 — Two shared tokens instead of user accounts](docs/adr/0003-shared-tokens-not-user-accounts.md)
- [0004 — Ninety-day raw retention](docs/adr/0004-ninety-day-raw-retention.md)

## Repository layout

```
.
├── arduino/     # ESP8266 sketch for the NodeMCU + DHT11 Device, and its wiring diagram
├── backend/     # Express + TypeScript API, MySQL
├── frontend/    # React + TypeScript + Vite, Tailwind, shadcn/ui
├── docs/adr/    # Architecture decision records
├── CONTEXT.md   # Domain vocabulary
└── DEPLOYMENT.md
```

## Hardware

| Part | Notes |
| --- | --- |
| NodeMCU (ESP8266) | Identifies itself by hostname: `ESP_` plus the last six hex digits of its MAC |
| DHT11 | Temperature and humidity, data pin on GPIO 5 (D1) |

The full wiring diagram, library versions, and flashing steps live in the [firmware section](#firmware).

## Local development

### Prerequisites

- Node.js 20 or newer
- MySQL or MariaDB

### Backend

```bash
cd backend
npm install
cp .env.example .env   # fill in database credentials
npm run dev            # http://localhost:3001
```

The backend expects a MySQL database named in `.env` and creates the schema itself on start through its migration runner. See `backend/.env.example` for every setting the server reads, and `DEPLOYMENT.md` for upgrading a database from the old per-Device tables.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env   # VITE_API_URL points at the backend
npm run dev            # http://localhost:5173
```

### Root shortcuts

The root `package.json` wraps both packages:

```bash
npm run install:all
npm run dev:backend
npm run dev:frontend
npm run build:all
npm run start:backend
```

## API

All responses are JSON. The table below is the contract the rebuild is converging on; until the backend tickets land, the running server still exposes the older route names. Exact request and response shapes will be documented here.

| Group | Routes | Auth |
| --- | --- | --- |
| Health | `GET /api/health` | none |
| Campuses | `GET`, `POST /api/campuses`, `DELETE /api/campuses/:id` | Admin token on writes |
| Devices | `GET`, `POST /api/devices`, `PATCH /api/devices/:id` (`closet` and `campusId` only; the hostname never changes, a replaced board is a new Device), `DELETE /api/devices/:id` | Admin token on writes |
| Readings | `POST /api/readings` | Device token |
| Dashboard | `GET /api/dashboard?campus=CODE`, `GET /api/dashboard/stream` (SSE) | none |
| History | `GET /api/devices/:id/history?date=YYYY-MM-DD&tz=America/Chicago` (one local day, oldest first, with min, max, and average; `tz` defaults to the server's zone, `date` to today), `DELETE /api/devices/:id/history` | Admin token on delete |

Tokens are sent as `Authorization: Bearer <token>`. See ADR 0003 for why there are two.

## Firmware

The sketch in [`arduino/TemperatureAlarms/`](arduino/TemperatureAlarms/) is the one firmware for every Device: a NodeMCU (ESP8266) reads a DHT11 on GPIO 5 and posts a Reading every Report interval. It is a folder the Arduino IDE compiles together, one job per file:

| File | Job |
| --- | --- |
| `TemperatureAlarms.ino` | `setup` and `loop` only: when a Reading is due, read once and report once |
| `network.h/.cpp` | Join WiFi at boot, reconnect from the loop without a reboot, name the Device |
| `sensor.h/.cpp` | Read the DHT11, skip a NaN sample and say so on serial |
| `reporter.h/.cpp` | Build the JSON Reading and POST it with the Device token, log the HTTP status |
| `config.example.h` | Template for the gitignored `config.h`: SSID, password, server URL, Device token, interval |

There is no on-device web server, no retry loop, and no per-Device setting: each Device names itself `ESP_` plus the last six hex digits of its MAC, and that hostname is what you register in Settings. Your router's DHCP list shows the same digits as `ESP-xxxxxx`.

### Wiring

![NodeMCU wired to a DHT11: DATA on D1 (GPIO 5), VCC on 3V3, GND on GND](arduino/dht11-pinout.svg)

| DHT11 pin | NodeMCU pin |
| --- | --- |
| VCC | 3V3 (not VIN) |
| DATA | D1 (GPIO 5) |
| GND | GND |

A bare four-pin sensor needs a 10 kΩ pull-up between DATA and VCC or every read is NaN; its third pin stays unconnected. Three-pin modules carry that resistor already, so wire them the same way, but check the silkscreen because the pin order varies by module.

### Libraries and board settings

The sketch compiles clean against these versions; install them from the IDE's Boards Manager and Library Manager.

| Dependency | Version | Where |
| --- | --- | --- |
| esp8266 by ESP8266 Community | 3.1.2 | Boards Manager, after adding `https://arduino.esp8266.com/stable/package_esp8266com_index.json` under Preferences, Additional boards manager URLs |
| DHT sensor library by Adafruit | 1.4.7 | Library Manager |
| Adafruit Unified Sensor | 1.1.15 | Library Manager (the DHT library depends on it; accept the prompt to install it) |

Board settings, under Tools: board **NodeMCU 1.0 (ESP-12E Module)**, upload speed 115200, CPU 80 MHz, flash size 4MB (any FS split), everything else at its default. The serial monitor runs at 115200.

### Flashing

1. Copy `arduino/TemperatureAlarms/config.example.h` to `config.h` in the same folder and fill in the WiFi credentials, the server URL without a trailing slash (the sketch appends `/api/readings`), the `DEVICE_TOKEN` from the backend `.env`, and the interval, which must equal the backend's `REPORT_INTERVAL_SECONDS`. `config.h` is gitignored.
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

See [`DEPLOYMENT.md`](DEPLOYMENT.md) for the nginx template, PM2 setup, and database provisioning.

## License

ISC
