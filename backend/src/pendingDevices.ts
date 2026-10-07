import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

/**
 * Boards that report with the Device token but are not registered as Devices yet. Settings lists
 * them so a technician can adopt one (give it a Campus and Closet) instead of typing its hostname.
 * Only a request carrying the Device token can add one, so the list holds real boards; a request
 * with a wrong token never lands here (deviceSightings.ts covers those).
 */

/** A Device's hostname: `ESP_` and the last six hex digits of its MAC (deviceInput.ts). */
export const HOSTNAME = /^ESP_[0-9A-F]{6}$/;
/** Far more than a district flashes at once; past it new hostnames are not added until some are adopted or forgotten. */
const MAX_PENDING = 500;

export interface Sighting {
  hostname: string;
  /** The Reading it sent, or null for a firmware check. */
  reading: { tempF: number; humidity: number } | null;
  address: string | null;
}

/** Records a report from an unregistered board; a hostname that is not ESP_ and six hex digits is ignored. */
export async function notePending(pool: Pool, { hostname, reading, address }: Sighting): Promise<void> {
  if (!HOSTNAME.test(hostname)) return;
  const [[{ n }]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM pending_devices');
  const known = await pool.query<RowDataPacket[]>('SELECT 1 FROM pending_devices WHERE hostname = ?', [hostname]);
  if (Number(n) >= MAX_PENDING && known[0].length === 0) return;
  await pool.query(
    `INSERT INTO pending_devices (hostname, first_seen, last_seen, reports, last_temp_f, last_humidity, last_address)
     VALUES (?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), 1, ?, ?, ?)
     ON DUPLICATE KEY UPDATE last_seen = UTC_TIMESTAMP(), reports = reports + 1,
       last_temp_f = COALESCE(VALUES(last_temp_f), last_temp_f),
       last_humidity = COALESCE(VALUES(last_humidity), last_humidity),
       last_address = VALUES(last_address)`,
    [hostname, reading?.tempF ?? null, reading?.humidity ?? null, address],
  );
}

interface PendingRow extends RowDataPacket {
  hostname: string;
  firstSeen: Date;
  lastSeen: Date;
  reports: number;
  lastTempF: number | null;
  lastHumidity: number | null;
  lastAddress: string | null;
  ignored: number;
}

export interface PendingDevice {
  hostname: string;
  firstSeen: string;
  lastSeen: string;
  reports: number;
  lastReading: { tempF: number; humidity: number } | null;
  address: string | null;
  ignored: boolean;
}

/** Every board waiting to be adopted, most recently heard first. */
export async function listPending(pool: Pool): Promise<PendingDevice[]> {
  const [rows] = await pool.query<PendingRow[]>(
    `SELECT hostname, first_seen AS firstSeen, last_seen AS lastSeen, reports, last_temp_f AS lastTempF,
            last_humidity AS lastHumidity, last_address AS lastAddress, ignored
     FROM pending_devices ORDER BY last_seen DESC, hostname`,
  );
  return rows.map((row) => ({
    hostname: row.hostname,
    firstSeen: row.firstSeen.toISOString(),
    lastSeen: row.lastSeen.toISOString(),
    reports: row.reports,
    lastReading: row.lastTempF === null || row.lastHumidity === null ? null : { tempF: row.lastTempF, humidity: row.lastHumidity },
    address: row.lastAddress,
    ignored: row.ignored === 1,
  }));
}

/** Hides or shows a board in the pop-up; false when it is not listed. */
export async function setIgnored(pool: Pool, hostname: string, ignored: boolean): Promise<boolean> {
  const [result] = await pool.query<ResultSetHeader>('UPDATE pending_devices SET ignored = ? WHERE hostname = ?', [ignored ? 1 : 0, hostname]);
  return result.affectedRows > 0;
}

/** Drops a board from the list (adopted, or forgotten until it reports again); false when it was not listed. */
export async function forgetPending(pool: Pool, hostname: string): Promise<boolean> {
  const [result] = await pool.query<ResultSetHeader>('DELETE FROM pending_devices WHERE hostname = ?', [hostname]);
  return result.affectedRows > 0;
}
