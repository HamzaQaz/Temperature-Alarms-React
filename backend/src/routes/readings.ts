import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { requireDeviceToken } from '../auth';
import type { AppDeps } from '../deps';

interface DeviceIdRow extends RowDataPacket {
  id: number;
  hostname: string;
}

interface ReadingInput {
  hostname: string;
  tempF: number;
  humidity: number;
}

/**
 * The ESP8266 core names a board `ESP-XXXXXX` while Devices are registered as `ESP_XXXXXX`,
 * so a posted hostname has its hyphens turned into underscores, as the old server did.
 */
function normaliseHostname(device: string): string {
  return device.trim().replace(/-/g, '_').toUpperCase();
}

function isNumeric(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Normalised reading input, or the message explaining why the body is not one. */
function parseReading(body: unknown): ReadingInput | { error: string } {
  const { device, temp, humidity } = (body ?? {}) as Record<string, unknown>;
  const hostname = typeof device === 'string' ? normaliseHostname(device) : '';
  if (hostname === '') return { error: 'A reading needs the device hostname' };
  if (!isNumeric(temp)) return { error: 'temp must be a number' };
  if (!isNumeric(humidity)) return { error: 'humidity must be a number' };
  // DHT11 resolution is a whole degree and a whole percent; the table stores integers.
  return { hostname, tempF: Math.round(temp), humidity: Math.round(humidity) };
}

/** Now, to the second, since the readings table stores DATETIME without fractional seconds. */
function serverNow(): Date {
  return new Date(Math.floor(Date.now() / 1000) * 1000);
}

/** Reading ingest (POST /api/readings): a Device posts `{device, temp, humidity}` with the Device token. */
export function readingsRouter({ pool, config }: AppDeps): Router {
  const router = Router();

  // Boards report every Report interval, so a healthy IP never approaches this. Only writes are limited this way.
  const writeLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many write requests from this IP, please try again later.' },
    validate: false,
  });

  router.post('/', writeLimiter, requireDeviceToken(config), async (req, res, next) => {
    const parsed = parseReading(req.body);
    if ('error' in parsed) {
      res.status(422).json({ error: parsed.error });
      return;
    }
    const { hostname, tempF, humidity } = parsed;
    try {
      const [devices] = await pool.query<DeviceIdRow[]>('SELECT id, hostname FROM devices WHERE hostname = ?', [hostname]);
      const device = devices[0];
      if (device === undefined) {
        res.status(404).json({ error: `No device is registered with the hostname ${hostname}` });
        return;
      }
      const recordedAt = serverNow();
      await pool.query<ResultSetHeader>(
        'INSERT INTO readings (device_id, temp_f, humidity, recorded_at) VALUES (?, ?, ?, ?)',
        [device.id, tempF, humidity, recordedAt],
      );
      res.status(201).json({ device: device.hostname, reading: { tempF, humidity, recordedAt: recordedAt.toISOString() } });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

/** Dashboard and its SSE stream (GET /api/dashboard, /api/dashboard/stream). Filled in by tickets 07 and 09. */
export function dashboardRouter(_deps: AppDeps): Router {
  return Router();
}
