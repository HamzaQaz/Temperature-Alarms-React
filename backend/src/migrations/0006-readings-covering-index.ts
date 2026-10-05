import type { Migration } from './index';
import { indexExists } from './introspect';

const OLD = 'ix_readings_device_recorded';
const NEW = 'ix_readings_device_recorded_temp';

/**
 * The per-Device index gains `id` and `temp_f`, so the Campuses overview's day maxima read the index
 * alone: one range per Device, no row lookups. At 90 days for 100 Devices that statement took 9 to
 * 28 s on the old index and starved ingest (.scratch/prodtest/load.md, B1).
 *
 * `id` comes before `temp_f`, because every latest-Reading query (the dashboard, the overview, the
 * sweep, ingest's previous Reading) orders by (device_id, recorded_at, id) and walks one step of the
 * index; with `temp_f` before `id` that order would no longer be the index's and each would sort.
 * The new index also serves the foreign key on device_id, so the old one can go.
 *
 * One ALTER, online: INPLACE with LOCK=NONE lets ingest keep writing while it builds (about 30 s
 * at 26 M Readings). Guarded at each step, so a run that died between the two can repeat.
 */
export const readingsCoveringIndex: Migration = {
  id: '0006-readings-covering-index',
  async up(conn) {
    const hasNew = await indexExists(conn, 'readings', NEW);
    const hasOld = await indexExists(conn, 'readings', OLD);
    const changes = [
      ...(hasNew ? [] : [`ADD INDEX ${NEW} (device_id, recorded_at, id, temp_f)`]),
      ...(hasOld ? [`DROP INDEX ${OLD}`] : []),
    ];
    if (changes.length === 0) return;
    await conn.query(`ALTER TABLE readings ${changes.join(', ')}, ALGORITHM=INPLACE, LOCK=NONE`);
  },
};
