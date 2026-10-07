import type { Migration } from './index';
import { columnExists } from './introspect';

/**
 * When each Device last reported, a Reading or a fault report, and how many fault reports it has
 * sent in a row (docs/adr/0009). The last report starts as the latest Reading, so no Device goes
 * Offline at the upgrade; only a NULL one is filled, so a run that died before being recorded can
 * repeat without moving a report ingest has written since.
 */
export const deviceReportsSchema: Migration = {
  id: '0010-device-reports',
  async up(conn) {
    if (!(await columnExists(conn, 'devices', 'sensor_faults'))) {
      await conn.query(`ALTER TABLE devices
        ADD COLUMN last_report_at DATETIME NULL,
        ADD COLUMN sensor_faults INT NOT NULL DEFAULT 0`);
    }
    await conn.query(
      'UPDATE devices d SET d.last_report_at = (SELECT MAX(r.recorded_at) FROM readings r WHERE r.device_id = d.id) WHERE d.last_report_at IS NULL',
    );
  },
};
