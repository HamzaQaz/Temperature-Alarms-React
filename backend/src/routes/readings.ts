import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { requireDeviceToken } from '../auth';
import type { AppDeps } from '../deps';
import { closetType } from '../closet';

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

interface DashboardRow extends RowDataPacket {
  id: number;
  hostname: string;
  closet: string;
  campusId: number;
  campusName: string;
  campusShortcode: string;
  tempF: number | null;
  humidity: number | null;
  recordedAt: Date | null;
}

/** Offline after three consecutive missed reports; Online while the last Reading is within that window. */
const MISSED_REPORTS_BEFORE_OFFLINE = 3;

/**
 * Every Device with its latest Reading, in one statement. The correlated subquery walks
 * ix_readings_device_recorded backwards one step per Device.
 */
const SELECT_DASHBOARD = `
  SELECT d.id, d.hostname, d.closet,
         c.id AS campusId, c.name AS campusName, c.shortcode AS campusShortcode,
         r.temp_f AS tempF, r.humidity, r.recorded_at AS recordedAt
  FROM devices d
  JOIN campuses c ON c.id = d.campus_id
  LEFT JOIN readings r ON r.id = (
    SELECT r2.id FROM readings r2
    WHERE r2.device_id = d.id
    ORDER BY r2.recorded_at DESC, r2.id DESC
    LIMIT 1
  )`;
const ORDER_DASHBOARD = 'ORDER BY c.name, d.closet, d.hostname';

function toDashboardDevice(row: DashboardRow, now: Date, offlineAfterSeconds: number) {
  const { id, hostname, closet, campusId, campusName, campusShortcode, tempF, humidity, recordedAt } = row;
  const latest = recordedAt === null || tempF === null ? null : { tempF, humidity, recordedAt };
  const secondsSinceReading = latest === null ? null : Math.max(0, Math.floor((now.getTime() - latest.recordedAt.getTime()) / 1000));
  return {
    id,
    hostname,
    campus: { id: campusId, name: campusName, shortcode: campusShortcode },
    closet,
    closetType: closetType(closet),
    latestReading: latest === null ? null : { ...latest, recordedAt: latest.recordedAt.toISOString() },
    online: secondsSinceReading !== null && secondsSinceReading <= offlineAfterSeconds,
    secondsSinceReading,
  };
}

/** Dashboard (GET /api/dashboard?campus=SHORTCODE). Its SSE stream is added by ticket 09. */
export function dashboardRouter({ pool, config, now = () => new Date() }: AppDeps): Router {
  const router = Router();
  const { reportIntervalSeconds } = config;
  const offlineAfterSeconds = MISSED_REPORTS_BEFORE_OFFLINE * reportIntervalSeconds;

  router.get('/', async (req, res, next) => {
    const campus = typeof req.query.campus === 'string' ? req.query.campus.trim() : '';
    // Shortcodes match in any case, as the old filter did.
    const [where, params] = campus === '' ? ['', []] : ['WHERE LOWER(c.shortcode) = LOWER(?)', [campus]];
    try {
      const [rows] = await pool.query<DashboardRow[]>(`${SELECT_DASHBOARD} ${where} ${ORDER_DASHBOARD}`, params);
      const at = now();
      res.json({
        reportIntervalSeconds,
        offlineAfterSeconds,
        devices: rows.map((row) => toDashboardDevice(row, at, offlineAfterSeconds)),
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
