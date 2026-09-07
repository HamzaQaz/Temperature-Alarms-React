import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { requireDeviceToken } from '../auth';
import type { RouteDeps } from '../deps';
import { closetType } from '../closet';
import { conditionsFor, isOffline, offlineAfterSeconds, type ConditionRules } from '../conditions';
import type { Config } from '../config';
import type { ReadingPayload } from '../sse';

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

/** The part of the configuration the Conditions module needs. */
const conditionRules = ({ reportIntervalSeconds, thresholds }: Config): ConditionRules => ({ reportIntervalSeconds, thresholds });

/**
 * Reading ingest (POST /api/readings): a Device posts `{device, temp, humidity}` with the
 * Device token. Each recorded Reading is broadcast to every open dashboard.
 */
export function readingsRouter({ pool, config, sse }: RouteDeps): Router {
  const router = Router();
  const rules = conditionRules(config);

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
      const reading: ReadingPayload = { tempF, humidity, recordedAt: recordedAt.toISOString() };
      res.status(201).json({ device: device.hostname, reading });
      // It just arrived, so it is zero seconds old: the Conditions are those of the Reading alone.
      const conditions = conditionsFor({ reading: { tempF, humidity }, secondsSinceReading: 0, ...rules });
      sse.broadcast({ type: 'reading', device: device.hostname, reading, online: !isOffline(conditions), conditions });
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

function toDashboardDevice(row: DashboardRow, now: Date, rules: ConditionRules) {
  const { id, hostname, closet, campusId, campusName, campusShortcode, tempF, humidity, recordedAt } = row;
  const latest = recordedAt === null || tempF === null ? null : { tempF, humidity, recordedAt };
  const secondsSinceReading = latest === null ? null : Math.max(0, Math.floor((now.getTime() - latest.recordedAt.getTime()) / 1000));
  const conditions = conditionsFor({ reading: latest, secondsSinceReading, ...rules });
  return {
    id,
    hostname,
    campus: { id: campusId, name: campusName, shortcode: campusShortcode },
    closet,
    closetType: closetType(closet),
    latestReading: latest === null ? null : ({ ...latest, recordedAt: latest.recordedAt.toISOString() } satisfies ReadingPayload),
    online: !isOffline(conditions),
    secondsSinceReading,
    /** Worst first; the browser renders these and computes none of its own. */
    conditions,
  };
}

/**
 * Dashboard (GET /api/dashboard?campus=SHORTCODE) and its live stream
 * (GET /api/dashboard/stream), which carries every Reading as it is ingested.
 */
export function dashboardRouter({ pool, config, sse, now = () => new Date() }: RouteDeps): Router {
  const router = Router();
  const { reportIntervalSeconds, thresholds } = config;
  const rules = conditionRules(config);

  router.get('/stream', sse.handler);

  router.get('/', async (req, res, next) => {
    const campus = typeof req.query.campus === 'string' ? req.query.campus.trim() : '';
    // Shortcodes match in any case, as the old filter did.
    const [where, params] = campus === '' ? ['', []] : ['WHERE LOWER(c.shortcode) = LOWER(?)', [campus]];
    try {
      const [rows] = await pool.query<DashboardRow[]>(`${SELECT_DASHBOARD} ${where} ${ORDER_DASHBOARD}`, params);
      const at = now();
      res.json({
        reportIntervalSeconds,
        offlineAfterSeconds: offlineAfterSeconds(reportIntervalSeconds, thresholds),
        devices: rows.map((row) => toDashboardDevice(row, at, rules)),
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
