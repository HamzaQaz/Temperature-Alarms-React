/**
 * The monthly report (docs/adr/0008). With NOTIFY_MONTHLY_REPORT on, each pass of the sender
 * (notifier.ts) finds the month just ended in the server's zone and, unless its report was queued
 * before, queues a `report` row in the notifications outbox, recording the month in
 * `monthly_reports` in the same transaction: from the first pass on the 1st, or the first after the
 * server comes back, and once, whatever the restarts. Settings queues one on request, whatever the
 * setting.
 *
 * The sender sends each due `report` row to NOTIFY_TO alone, as an email of its own, never with
 * Incidents or a hold, built from its month's Incidents and Readings as they stand then
 * (monthlyReportEmail.ts). A relay failure waits and retries with the outbox's backoff and is given
 * up on after a day, like any notification; Settings shows both, since it reads every outbox row.
 */
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { ConditionName, Thresholds } from './conditions';
import { localMonth, monthBefore, type LocalMonth } from './localDay';
import type { Email } from './mailer';
import { monthlyReportEmail, warmFromF, type MonthlyReport, type ReportCloset } from './monthlyReportEmail';
import type { EmailSettings } from './notificationEmail';
import { isBench } from './outbox';

/** A pool or one of its connections: anything that runs a statement. */
type Db = Pool | PoolConnection;

/** Queue a report on `month` (YYYY-MM) in the outbox, due at once. */
export async function queueMonthlyReport(db: Db, month: string, at: Date): Promise<void> {
  await db.query("INSERT INTO notifications (kind, report_month, created_at, next_attempt_at) VALUES ('report', ?, ?, ?)", [month, at, at]);
}

/**
 * Queue the scheduled report on the month before `at`, unless it was queued before. The month is
 * recorded under its primary key in the transaction that queues the row, so however many passes,
 * restarts, or processes reach it, it is queued once. Returns the month queued, or null.
 */
export async function queueScheduledReport(pool: Pool, at: Date, timeZone: string): Promise<string | null> {
  const { month } = monthBefore(at, timeZone);
  const [seen] = await pool.query<RowDataPacket[]>('SELECT 1 FROM monthly_reports WHERE month = ?', [month]);
  if (seen.length > 0) return null;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [recorded] = await conn.query<ResultSetHeader>('INSERT IGNORE INTO monthly_reports (month, queued_at) VALUES (?, ?)', [month, at]);
    if (recorded.affectedRows === 1) await queueMonthlyReport(conn, month, at);
    await conn.commit();
    return recorded.affectedRows === 1 ? month : null;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

interface DeviceRow extends RowDataPacket {
  id: number;
  hostname: string;
  closet: string;
  createdAt: Date;
  campusName: string;
  campusShortcode: string;
}

interface SummaryRow extends RowDataPacket {
  readings: number | string;
  warmReadings: number | string | null;
  maxTempF: number | null;
  maxHumidity: number | null;
}

interface PeakRow extends RowDataPacket {
  tempF: number;
  humidity: number | null;
  recordedAt: Date;
}

interface IncidentRow extends RowDataPacket {
  deviceId: number;
  conditionName: ConditionName;
  startedAt: Date;
  endedAt: Date | null;
}

/**
 * What a month's report is built from: the Incidents that overlap it, and every Device but the
 * Bench's that existed by its end or has Readings or Incidents in it, with its Readings summed
 * up. Each Device's Readings are read as one range of its index, a statement at a time, so no
 * single one holds up ingest; a month of 100 Devices is a few hundred short statements.
 */
export async function monthlyReportData(db: Db, month: LocalMonth, thresholds: Thresholds): Promise<MonthlyReport> {
  const [incidents] = await db.query<IncidentRow[]>(
    `SELECT device_id AS deviceId, condition_name AS conditionName, started_at AS startedAt, ended_at AS endedAt
     FROM incidents WHERE started_at < ? AND (ended_at IS NULL OR ended_at > ?) ORDER BY started_at, id`,
    [month.to, month.from],
  );
  const withIncidents = new Set(incidents.map((i) => i.deviceId));
  const [devices] = await db.query<DeviceRow[]>(
    `SELECT d.id, d.hostname, d.closet, d.created_at AS createdAt, c.name AS campusName, c.shortcode AS campusShortcode
     FROM devices d JOIN campuses c ON c.id = d.campus_id ORDER BY d.id`,
  );
  const closets: ReportCloset[] = [];
  for (const device of devices) {
    if (isBench(device.campusShortcode)) continue;
    const range = [device.id, month.from, month.to];
    const [[summary]] = await db.query<SummaryRow[]>(
      `SELECT COUNT(*) AS readings, SUM(temp_f >= ?) AS warmReadings, MAX(temp_f) AS maxTempF, MAX(humidity) AS maxHumidity
       FROM readings WHERE device_id = ? AND recorded_at >= ? AND recorded_at < ?`,
      [warmFromF(thresholds.hotWarningF), ...range],
    );
    const readings = Number(summary.readings);
    // A Device added after the month ended had no part in it.
    if (readings === 0 && !withIncidents.has(device.id) && device.createdAt.getTime() >= month.to.getTime()) continue;
    /** The first Reading in the month at the peak. */
    const peak = async (column: 'temp_f' | 'humidity', value: number | null): Promise<PeakRow | null> => {
      if (value === null) return null;
      const [rows] = await db.query<PeakRow[]>(
        `SELECT temp_f AS tempF, humidity, recorded_at AS recordedAt FROM readings
         WHERE device_id = ? AND recorded_at >= ? AND recorded_at < ? AND ${column} = ? ORDER BY recorded_at, id LIMIT 1`,
        [...range, value],
      );
      return rows[0] ?? null;
    };
    closets.push({
      device: { id: device.id, hostname: device.hostname, closet: device.closet, campus: { name: device.campusName, shortcode: device.campusShortcode } },
      hotWarningF: thresholds.hotWarningF,
      readings,
      warmReadings: Number(summary.warmReadings ?? 0),
      hottest: await peak('temp_f', summary.maxTempF),
      mostHumid: await peak('humidity', summary.maxHumidity),
    });
  }
  return {
    month,
    closets,
    incidents: incidents.map((i) => ({ deviceId: i.deviceId, condition: i.conditionName, start: i.startedAt, end: i.endedAt })),
  };
}

/**
 * The email for a `report` row on `month` (YYYY-MM), built from that month as it stands now, for
 * the sender. Undefined when the month cannot be read: only queueMonthlyReport writes it, so that is
 * a row nothing can send.
 */
export async function queuedReportEmail(db: Db, month: string | null, thresholds: Thresholds, settings: EmailSettings): Promise<Email | undefined> {
  const local = month === null ? undefined : localMonth(month, settings.timeZone);
  return local === undefined ? undefined : monthlyReportEmail(await monthlyReportData(db, local, thresholds), settings);
}
