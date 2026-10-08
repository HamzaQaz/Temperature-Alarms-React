import { Router, type Request, type Response } from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { RouteDeps } from '../deps';
import { csvRow, fileNamePart, UTF8_BOM } from '../csv';
import { isTimeZone, localDay, serverTimeZone, todayIn, wallClockText, type LocalDay } from '../localDay';
import { incidentsOverlappingPage, type IncidentCursor } from '../incidentStore';
import type { IncidentPayload } from '../sse';
import { SELECT_DEVICES, type DeviceRow } from './devices';
import { parseWindow } from './incidents';

/** Rows read per query: a page of Readings is about 250 KB of CSV, written before the next is read. */
export const CSV_PAGE_ROWS = 5_000;

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** The zone asked for by `?tz=`, the server's own when there is none, or the message explaining why it is not one. */
function parseZone(query: Request['query']): string | { error: string } {
  const tz = typeof query.tz === 'string' && query.tz.trim() !== '' ? query.tz.trim() : serverTimeZone();
  return isTimeZone(tz) ? tz : { error: `Unknown time zone ${tz}; use an IANA name like America/Chicago` };
}

interface DayRange {
  from: LocalDay;
  to: LocalDay;
}

/** Days from the first to the last, both counted: 1 for a single day. */
const daysSpanned = (from: string, to: string): number => (Date.parse(to) - Date.parse(from)) / DAY_MS + 1;

/**
 * The days asked for by `?from=` and `?to=` (both YYYY-MM-DD, both included) in the zone, or the
 * message explaining why there are none. At most the Retention window: older Readings are gone.
 */
function parseDayRange(query: Request['query'], timeZone: string, retentionDays: number): DayRange | { error: string } {
  const days: LocalDay[] = [];
  for (const name of ['from', 'to'] as const) {
    const raw = query[name];
    if (typeof raw !== 'string' || raw.trim() === '') return { error: `${name} is required, a day written YYYY-MM-DD` };
    const day = localDay(raw.trim(), timeZone);
    if (day === undefined) return { error: `${name} must be a real day written YYYY-MM-DD, got ${raw.trim()}` };
    days.push(day);
  }
  const [from, to] = days;
  if (from.date > to.date) return { error: 'from must be on or before to' };
  if (daysSpanned(from.date, to.date) > retentionDays) {
    return { error: `The range can be at most ${retentionDays} days: Readings are kept that long` };
  }
  return { from, to };
}

/** "2026-09-05 19:30:00": the instant in UTC, in the same form as the local column. */
const utcText = (at: Date): string => at.toISOString().slice(0, 19).replace('T', ' ');

/** To one decimal: the table holds whole °F, so more would be noise. */
const celsius = (tempF: number): number => Math.round((((tempF - 32) * 5) / 9) * 10) / 10;

/** `2026-09-05`, or `2026-09-01_to_2026-09-28`. */
const rangeName = (from: string, to: string): string => (from === to ? from : `${from}_to_${to}`);

/** `CHS_IDF-2_readings_2026-09-01_to_2026-09-28.csv`: the Campus, the Closet, what, and the range. */
const fileName = (parts: string[], range: string): string => `${[...parts.map(fileNamePart).filter((part) => part !== ''), range].join('_')}.csv`;

/**
 * Send the lines as a CSV download. They reach the client as they are made, a page at a time and
 * no faster than it reads them, so a 90-day file is never held whole.
 */
async function sendCsv(res: Response, name: string, lines: AsyncIterable<string>): Promise<void> {
  res.attachment(name);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  try {
    await pipeline(Readable.from(lines), res);
  } catch (error) {
    // The client went away (a cancelled download, a closed tab): nobody is left to tell.
    if ((error as { code?: unknown }).code === 'ERR_STREAM_PREMATURE_CLOSE') return;
    // Rows are already out, so a status can no longer be sent; the connection is cut instead, and
    // the download fails rather than ending as a short file that looks complete.
    console.error('CSV export failed partway:', error);
  }
}

interface CsvReadingRow extends RowDataPacket {
  id: number;
  tempF: number;
  humidity: number | null;
  recordedAt: Date;
}

/**
 * One line per Reading in [from, to), oldest first, after the header. Read a page at a time,
 * each page starting after the last row of the one before (by time, then id), so every query
 * walks the Device's index from where the last left off.
 */
async function* readingLines(pool: Pool, deviceId: number, from: Date, to: Date, timeZone: string): AsyncGenerator<string> {
  yield UTF8_BOM + csvRow([`Local time (${timeZone})`, 'UTC time', 'Temperature (F)', 'Temperature (C)', 'Humidity (%)']);
  let last: CsvReadingRow | undefined;
  for (;;) {
    const [rows] = await pool.query<CsvReadingRow[]>(
      `SELECT id, temp_f AS tempF, humidity, recorded_at AS recordedAt
       FROM readings
       WHERE device_id = ? AND recorded_at >= ? AND recorded_at < ?
         ${last === undefined ? '' : 'AND (recorded_at > ? OR (recorded_at = ? AND id > ?))'}
       ORDER BY recorded_at, id
       LIMIT ?`,
      [deviceId, from, to, ...(last === undefined ? [] : [last.recordedAt, last.recordedAt, last.id]), CSV_PAGE_ROWS],
    );
    if (rows.length === 0) return;
    yield rows.map((r) => csvRow([wallClockText(r.recordedAt, timeZone), utcText(r.recordedAt), r.tempF, celsius(r.tempF), r.humidity])).join('');
    if (rows.length < CSV_PAGE_ROWS) return;
    last = rows[rows.length - 1];
  }
}

/** One incident as a CSV row; `now` ends the duration of one still going. */
function incidentRow(incident: IncidentPayload, timeZone: string, now: Date): string {
  const { device, peak, acknowledgement } = incident;
  const start = new Date(incident.start);
  const end = incident.end === null ? null : new Date(incident.end);
  return csvRow([
    device.campus.name,
    device.closet,
    device.hostname,
    incident.condition,
    incident.level,
    wallClockText(start, timeZone),
    utcText(start),
    end === null ? null : wallClockText(end, timeZone),
    end === null ? null : utcText(end),
    Math.round(((end ?? now).getTime() - start.getTime()) / MINUTE_MS),
    peak.tempF,
    celsius(peak.tempF),
    peak.humidity,
    wallClockText(new Date(peak.recordedAt), timeZone),
    acknowledgement?.by ?? null,
    acknowledgement === null ? null : wallClockText(new Date(acknowledgement.at), timeZone),
  ]);
}

/** One line per incident overlapping the window, oldest first, after the header; a page at a time, like Readings. */
async function* incidentLines(pool: Pool, from: Date, to: Date, deviceId: number | undefined, timeZone: string, now: Date): AsyncGenerator<string> {
  yield UTF8_BOM +
    csvRow([
      'Campus',
      'Closet',
      'Hostname',
      'Condition',
      'Level',
      `Started (${timeZone})`,
      'Started (UTC)',
      `Ended (${timeZone})`,
      'Ended (UTC)',
      'Duration (minutes)',
      'Peak temperature (F)',
      'Peak temperature (C)',
      'Peak humidity (%)',
      `Peak at (${timeZone})`,
      'Acknowledged by',
      `Acknowledged at (${timeZone})`,
    ]);
  let after: IncidentCursor | undefined;
  for (;;) {
    const page = await incidentsOverlappingPage(pool, from, to, { deviceId, after, limit: CSV_PAGE_ROWS });
    if (page.length === 0) return;
    yield page.map((incident) => incidentRow(incident, timeZone, now)).join('');
    if (page.length < CSV_PAGE_ROWS) return;
    const last = page[page.length - 1];
    after = { start: new Date(last.start), id: last.id };
  }
}

/**
 * CSV downloads, for Excel or a work order (mounted at /api). Public, like History and the
 * Incidents log they come from.
 *
 * GET /devices/:id/readings.csv?from=&to=&tz=: one row per Reading of the Device over a range of
 * days in the zone, both ends included, at most the Retention window.
 *
 * GET /incidents.csv?from=&to=&tz=&device=: one row per incident overlapping the window, as the
 * Incidents log takes it (ISO instants), only the Device's with `device=`, at most the Retention
 * window and a day to spare for the edges. `tz` names the zone of the local times.
 */
export function csvExportsRouter({ pool, config, now = () => new Date() }: RouteDeps): Router {
  const router = Router();

  const findDevice = async (rawId: unknown): Promise<DeviceRow | undefined> => {
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0 || id > Number.MAX_SAFE_INTEGER) return undefined;
    const [rows] = await pool.query<DeviceRow[]>(`${SELECT_DEVICES} WHERE d.id = ?`, [id]);
    return rows[0];
  };

  router.get('/devices/:id/readings.csv', async (req, res, next) => {
    const timeZone = parseZone(req.query);
    if (typeof timeZone !== 'string') {
      res.status(422).json(timeZone);
      return;
    }
    const range = parseDayRange(req.query, timeZone, config.retentionDays);
    if ('error' in range) {
      res.status(422).json({ error: range.error });
      return;
    }
    let device: DeviceRow | undefined;
    try {
      device = await findDevice(req.params.id);
    } catch (error) {
      next(error);
      return;
    }
    if (device === undefined) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }
    const name = fileName([device.campusShortcode, device.closet, 'readings'], rangeName(range.from.date, range.to.date));
    await sendCsv(res, name, readingLines(pool, device.id, range.from.from, range.to.to, timeZone));
  });

  router.get('/incidents.csv', async (req, res, next) => {
    const timeZone = parseZone(req.query);
    if (typeof timeZone !== 'string') {
      res.status(422).json(timeZone);
      return;
    }
    const window = parseWindow(req.query, config.retentionDays + 1);
    if ('error' in window) {
      res.status(422).json({ error: window.error });
      return;
    }
    let device: DeviceRow | undefined;
    if (req.query.device !== undefined) {
      try {
        device = await findDevice(req.query.device);
      } catch (error) {
        next(error);
        return;
      }
      if (device === undefined) {
        res.status(404).json({ error: 'Device not found' });
        return;
      }
    }
    // Named by the days it touches in the zone: the window ends the instant before `to`.
    const range = rangeName(todayIn(window.from, timeZone), todayIn(new Date(window.to.getTime() - 1), timeZone));
    const name = fileName(device === undefined ? ['incidents'] : [device.campusShortcode, device.closet, 'incidents'], range);
    await sendCsv(res, name, incidentLines(pool, window.from, window.to, device?.id, timeZone, now()));
  });

  return router;
}
