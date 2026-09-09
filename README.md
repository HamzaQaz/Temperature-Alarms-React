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
├── arduino/     # ESP8266 firmware for the NodeMCU + DHT11 Device
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
| Devices | `GET`, `POST /api/devices`, `DELETE /api/devices/:id` | Admin token on writes |
| Readings | `POST /api/readings` | Device token |
| Dashboard | `GET /api/dashboard?campus=CODE`, `GET /api/dashboard/stream` (SSE) | none |
| History | `GET /api/devices/:id/history?date=YYYY-MM-DD&tz=America/Chicago` (one local day, oldest first, with min, max, and average; `tz` defaults to the server's zone, `date` to today), `DELETE /api/devices/:id/history` | Admin token on delete |

Tokens are sent as `Authorization: Bearer <token>`. See ADR 0003 for why there are two.

## Firmware

The firmware in [`arduino/`](arduino/) is being rewritten for the DHT11. The sketch currently committed is the older DS18B20 version and does not match the hardware or the API above; do not flash it.

The replacement will target the ESP8266 Arduino core with the DHT11 on GPIO 5, read on the configured Report interval, skip failed samples, and post a JSON Reading with the Device token in the `Authorization` header. Its settings (WiFi credentials, server URL, Device token, interval) will live in a gitignored `config.h` with a committed `config.example.h`.

Wiring, library versions, board settings, flashing steps, and the bench checklist will be documented in this section once the new sketch lands.

## Deployment

See [`DEPLOYMENT.md`](DEPLOYMENT.md) for the nginx template, PM2 setup, and database provisioning.

## License

ISC
