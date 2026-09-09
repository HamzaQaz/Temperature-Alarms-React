import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { Migration, MigrationContext } from './index';
import { baseTables, columnExists } from './introspect';
import { parseLegacyTimestamp } from './legacyTimestamp';

/**
 * The old backends created one table per Device, named after its hostname. Only a name that
 * is exactly a hostname is treated as one of them. Every SQL statement in this backend is
 * parameterised; the one identifier built from data is this table name, and it is accepted
 * only after matching this pattern, so it can be quoted with backticks safely.
 */
const LEGACY_TABLE = /^ESP_[0-9A-F]{6}$/i;
const CHUNK = 5000;

interface DeviceRow extends RowDataPacket {
  id: number;
  hostname: string;
}

interface LegacyReading extends RowDataPacket {
  ID: number;
  DATE: string | null;
  TIME: string | null;
  TEMP: number | null;
  HUMIDITY?: number | null;
}

interface Progress extends RowDataPacket {
  last_id: number;
  copied: number;
  skipped: number;
}

/** Copy one legacy table's rows after its last copied id into readings, in chunks, each chunk and its bookkeeping in one transaction. */
async function copyTable(
  conn: PoolConnection,
  table: string,
  device: DeviceRow,
  { legacyTimeZone, log }: MigrationContext,
): Promise<void> {
  const quoted = `\`${table}\``;
  const hasHumidity = await columnExists(conn, table, 'HUMIDITY');
  await conn.query('INSERT IGNORE INTO legacy_readings_progress (table_name) VALUES (?)', [table]);
  const [[progress]] = await conn.query<Progress[]>(
    'SELECT last_id, copied, skipped FROM legacy_readings_progress WHERE table_name = ?',
    [table],
  );
  let lastId = Number(progress.last_id);
  let copied = 0;
  let skipped = 0;

  for (;;) {
    const [rows] = await conn.query<LegacyReading[]>(
      `SELECT ID, DATE, TIME, TEMP${hasHumidity ? ', HUMIDITY' : ''} FROM ${quoted} WHERE ID > ? ORDER BY ID LIMIT ?`,
      [lastId, CHUNK],
    );
    if (rows.length === 0) break;

    const values: [number, number, number | null, Date][] = [];
    for (const row of rows) {
      const recordedAt = parseLegacyTimestamp(String(row.DATE ?? ''), String(row.TIME ?? ''), legacyTimeZone);
      if (recordedAt === undefined) {
        log(`legacy: ${table} id ${row.ID} skipped: cannot read DATE "${row.DATE}" and TIME "${row.TIME}"`);
        skipped += 1;
        continue;
      }
      const tempF = Number(row.TEMP);
      if (row.TEMP === null || !Number.isInteger(tempF)) {
        log(`legacy: ${table} id ${row.ID} skipped: TEMP "${row.TEMP}" is not a whole number`);
        skipped += 1;
        continue;
      }
      const humidity = row.HUMIDITY === undefined || row.HUMIDITY === null ? null : Number(row.HUMIDITY);
      values.push([device.id, tempF, humidity, recordedAt]);
    }
    lastId = rows[rows.length - 1].ID;

    await conn.beginTransaction();
    try {
      if (values.length > 0) {
        await conn.query('INSERT INTO readings (device_id, temp_f, humidity, recorded_at) VALUES ?', [values]);
      }
      await conn.query(
        'UPDATE legacy_readings_progress SET last_id = ?, copied = copied + ?, skipped = skipped + ? WHERE table_name = ?',
        [lastId, values.length, rows.length - values.length, table],
      );
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    }
    copied += values.length;
    if (rows.length < CHUNK) break;
  }

  const copiedBefore = Number(progress.copied);
  const skippedBefore = Number(progress.skipped);
  const runningTotal =
    copiedBefore + skippedBefore === 0
      ? ''
      : ` (${copiedBefore + copied} copied and ${skippedBefore + skipped} skipped in total)`;
  log(`legacy: ${table} into readings for ${device.hostname}: copied ${copied}, skipped ${skipped}${runningTotal}`);
}

/**
 * Walk every per-Device table into `readings` (docs/adr/0002). The runner applies it once
 * on startup; `npm run migrate:legacy` runs it again by hand. Re-runnable: each table's
 * last copied id is kept in `legacy_readings_progress`, so a later run copies only rows
 * added since. A row whose date or time cannot be read is logged and skipped, never fatal.
 * A table whose hostname has no Device row is logged and skipped. Legacy tables are never
 * dropped here; the deploy guide covers verifying counts and dropping them by hand.
 */
export const legacyReadings: Migration = {
  id: '0003-legacy-readings',
  async up(conn, context) {
    const tables = (await baseTables(conn)).filter((name) => LEGACY_TABLE.test(name));
    if (tables.length === 0) return;

    await conn.query(`
      CREATE TABLE IF NOT EXISTS legacy_readings_progress (
        table_name VARCHAR(64)     NOT NULL,
        last_id    BIGINT UNSIGNED NOT NULL DEFAULT 0,
        copied     BIGINT UNSIGNED NOT NULL DEFAULT 0,
        skipped    BIGINT UNSIGNED NOT NULL DEFAULT 0,
        updated_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (table_name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    for (const table of tables) {
      const [devices] = await conn.query<DeviceRow[]>('SELECT id, hostname FROM devices WHERE hostname = ?', [table]);
      if (devices.length === 0) {
        context.log(`legacy: ${table} has no device row; skipped`);
        continue;
      }
      await copyTable(conn, table, devices[0], context);
    }
  },
};
