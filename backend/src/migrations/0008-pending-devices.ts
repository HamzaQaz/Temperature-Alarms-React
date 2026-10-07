import type { Migration } from './index';

/**
 * Boards that report with the Device token but are not registered yet, waiting to be adopted
 * (pendingDevices.ts). Kept in the database so the Settings list survives a restart.
 */
export const pendingDevicesSchema: Migration = {
  id: '0008-pending-devices',
  async up(conn) {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS pending_devices (
        hostname      VARCHAR(20)  NOT NULL,
        first_seen    DATETIME     NOT NULL,
        last_seen     DATETIME     NOT NULL,
        reports       INT UNSIGNED NOT NULL DEFAULT 0,
        last_temp_f   INT          NULL,
        last_humidity INT          NULL,
        last_address  VARCHAR(45)  NULL,
        ignored       TINYINT(1)   NOT NULL DEFAULT 0,
        PRIMARY KEY (hostname)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  },
};
