import type { Migration } from './index';
import { columnExists } from './introspect';

/**
 * System health on Settings (systemHealth.ts). `last_backup` is the marker `deploy backup` writes
 * once its dump is complete, since the api sees neither the host's cron nor its backups folder: one
 * row at most, replaced each time, its time in UTC. `devices.weak_signal_since` is when a board's
 * WiFi signal fell under -80 dBm and has stayed there since, NULL while it is fine. Guarded, so a
 * run that died before being recorded can repeat.
 */
export const systemHealthSchema: Migration = {
  id: '0018-system-health',
  async up(conn) {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS last_backup (
        id          TINYINT UNSIGNED NOT NULL,
        finished_at DATETIME         NOT NULL,
        file        VARCHAR(255)     NOT NULL,
        size_bytes  BIGINT UNSIGNED  NULL,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    if (!(await columnExists(conn, 'devices', 'weak_signal_since'))) {
      await conn.query('ALTER TABLE devices ADD COLUMN weak_signal_since DATETIME NULL');
    }
  },
};
