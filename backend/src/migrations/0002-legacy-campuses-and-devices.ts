import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { isDuplicateKey } from '../db';
import { parseCampus } from '../campusInput';
import { parseDevice } from '../deviceInput';
import type { Migration, MigrationContext } from './index';
import { tableExists } from './introspect';

interface LegacyLocation extends RowDataPacket {
  ID: number;
  NAME: string | null;
  SHORTCODE: string | null;
}

interface LegacyDevice extends RowDataPacket {
  ID: number;
  Name: string | null;
  Campus: string | null;
  Location: string | null;
}

interface CampusRow extends RowDataPacket {
  id: number;
  name: string;
  shortcode: string;
}

const upper = (value: string | null): string => (value ?? '').trim().toUpperCase();

/** Each legacy location becomes a Campus, under the same rules the API applies. Already-present shortcodes are left alone. */
async function copyCampuses(conn: PoolConnection, log: MigrationContext['log']): Promise<void> {
  const [existing] = await conn.query<CampusRow[]>('SELECT id, name, shortcode FROM campuses');
  const present = new Set(existing.map((c) => c.shortcode.toUpperCase()));
  const [rows] = await conn.query<LegacyLocation[]>('SELECT ID, NAME, SHORTCODE FROM legacy_locations ORDER BY ID');
  let copied = 0;
  for (const row of rows) {
    if (present.has(upper(row.SHORTCODE))) continue;
    const parsed = parseCampus({ name: row.NAME, shortcode: row.SHORTCODE });
    if ('error' in parsed) {
      log(`legacy: legacy_locations id ${row.ID} skipped: ${parsed.error}`);
      continue;
    }
    await conn.query('INSERT INTO campuses (name, shortcode) VALUES (?, ?)', [parsed.name, parsed.shortcode]);
    present.add(parsed.shortcode);
    copied += 1;
  }
  log(`legacy: copied ${copied} of ${rows.length} legacy_locations rows into campuses`);
}

/**
 * Each legacy device becomes a Device. The old Campus column was free text, so it is matched
 * against a Campus shortcode first and a Campus name second. Already-present hostnames are left alone.
 */
async function copyDevices(conn: PoolConnection, log: MigrationContext['log']): Promise<void> {
  const [campuses] = await conn.query<CampusRow[]>('SELECT id, name, shortcode FROM campuses');
  const byShortcode = new Map(campuses.map((c) => [c.shortcode.toUpperCase(), c.id]));
  const byName = new Map(campuses.map((c) => [c.name.toUpperCase(), c.id]));
  const [existing] = await conn.query<RowDataPacket[]>('SELECT hostname FROM devices');
  const present = new Set(existing.map((d) => (d.hostname as string).toUpperCase()));
  const [rows] = await conn.query<LegacyDevice[]>('SELECT ID, Name, Campus, Location FROM legacy_devices ORDER BY ID');
  let copied = 0;
  for (const row of rows) {
    if (present.has(upper(row.Name))) continue;
    const campusId = byShortcode.get(upper(row.Campus)) ?? byName.get(upper(row.Campus));
    if (campusId === undefined) {
      log(`legacy: legacy_devices id ${row.ID} (${row.Name}) skipped: no campus with shortcode or name "${row.Campus}"`);
      continue;
    }
    const parsed = parseDevice({ hostname: row.Name, campusId, closet: row.Location });
    if ('error' in parsed) {
      log(`legacy: legacy_devices id ${row.ID} (${row.Name}) skipped: ${parsed.error}`);
      continue;
    }
    try {
      await conn.query('INSERT INTO devices (hostname, campus_id, closet) VALUES (?, ?, ?)', [
        parsed.hostname,
        parsed.campusId,
        parsed.closet,
      ]);
    } catch (error) {
      // Two legacy rows spelling the same hostname differently: the first one wins.
      if (!isDuplicateKey(error)) throw error;
      log(`legacy: legacy_devices id ${row.ID} (${row.Name}) skipped: a device with that hostname already exists`);
      continue;
    }
    present.add(parsed.hostname);
    copied += 1;
  }
  log(`legacy: copied ${copied} of ${rows.length} legacy_devices rows into devices`);
}

/**
 * Bring the PHP-era locations and devices (moved aside by 0000) into `campuses` and `devices`.
 * Re-runnable: rows already present are skipped, rows that fail validation are logged and skipped.
 */
export const legacyCampusesAndDevices: Migration = {
  id: '0002-legacy-campuses-and-devices',
  async up(conn, { log }) {
    if (await tableExists(conn, 'legacy_locations')) await copyCampuses(conn, log);
    if (await tableExists(conn, 'legacy_devices')) await copyDevices(conn, log);
  },
};
