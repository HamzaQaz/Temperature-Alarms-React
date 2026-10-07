import type { Migration } from './index';
import { columnExists } from './introspect';

/** What each board last said about itself (deviceInfo.ts): signal, uptime, memory, last restart, last update. */
export const deviceInfoSchema: Migration = {
  id: '0009-device-info',
  async up(conn) {
    if (await columnExists(conn, 'devices', 'info_at')) return;
    await conn.query(`ALTER TABLE devices
      ADD COLUMN rssi SMALLINT NULL,
      ADD COLUMN uptime_s INT UNSIGNED NULL,
      ADD COLUMN free_heap INT UNSIGNED NULL,
      ADD COLUMN reset_reason VARCHAR(60) NULL,
      ADD COLUMN update_result VARCHAR(80) NULL,
      ADD COLUMN info_at DATETIME NULL`);
  },
};
