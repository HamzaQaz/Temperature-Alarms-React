import type { Migration } from './index';
import { columnExists } from './introspect';

/**
 * Over-the-air firmware (docs/adr/0007): the one release on offer, and what each Device last said
 * it runs. One row at most in firmware_release; publishing replaces it. The image holds the boards'
 * WiFi password and Device token, like the binary on the build laptop, so it never leaves the
 * database except to a request carrying a Device token.
 */
export const firmwareSchema: Migration = {
  id: '0007-firmware',
  async up(conn) {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS firmware_release (
        id             TINYINT UNSIGNED NOT NULL,
        version        INT UNSIGNED     NOT NULL,
        md5            CHAR(32)         NOT NULL,
        size           INT UNSIGNED     NOT NULL,
        image          MEDIUMBLOB       NOT NULL,
        only_hostnames TEXT             NULL,
        published_at   DATETIME         NOT NULL,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    if (!(await columnExists(conn, 'devices', 'firmware_version'))) {
      await conn.query('ALTER TABLE devices ADD COLUMN firmware_version INT UNSIGNED NULL, ADD COLUMN firmware_checked_at DATETIME NULL');
    }
  },
};
