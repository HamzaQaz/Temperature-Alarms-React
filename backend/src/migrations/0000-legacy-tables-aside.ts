import type { Migration } from './index';
import { columnExists, tableExists } from './introspect';

/**
 * A production database still holds the PHP-era `devices` (ID, Name, Campus, Location) and
 * `locations` (ID, NAME, SHORTCODE) tables. The initial schema creates tables of the same
 * names, so those are renamed aside first; 0002 copies their rows into the new shape.
 * Nothing happens on a fresh database or one already on the new schema.
 */
export const legacyTablesAside: Migration = {
  id: '0000-legacy-tables-aside',
  async up(conn, { log }) {
    // The new schema has a `devices` table too, told apart by its `hostname` column; it never has `locations`.
    if ((await tableExists(conn, 'devices')) && !(await columnExists(conn, 'devices', 'hostname'))) {
      await conn.query('RENAME TABLE devices TO legacy_devices');
      log('legacy: moved the old devices table aside as legacy_devices');
    }
    if (await tableExists(conn, 'locations')) {
      await conn.query('RENAME TABLE locations TO legacy_locations');
      log('legacy: moved the old locations table aside as legacy_locations');
    }
  },
};
