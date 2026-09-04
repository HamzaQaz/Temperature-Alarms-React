import type { Migration } from './index';

/** Three tables per docs/adr/0002: campuses, devices, readings. */
export const initialSchema: Migration = {
  id: '0001-initial-schema',
  async up(conn) {
    await conn.query(`
      CREATE TABLE campuses (
        id        INT UNSIGNED NOT NULL AUTO_INCREMENT,
        name      VARCHAR(100) NOT NULL,
        shortcode VARCHAR(20)  NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_campuses_shortcode (shortcode)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await conn.query(`
      CREATE TABLE devices (
        id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
        hostname   VARCHAR(20)  NOT NULL,
        campus_id  INT UNSIGNED NOT NULL,
        closet     VARCHAR(50)  NOT NULL,
        created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_devices_hostname (hostname),
        CONSTRAINT fk_devices_campus FOREIGN KEY (campus_id) REFERENCES campuses (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await conn.query(`
      CREATE TABLE readings (
        id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        device_id   INT UNSIGNED    NOT NULL,
        temp_f      INT             NOT NULL,
        humidity    INT             NULL,
        recorded_at DATETIME        NOT NULL,
        PRIMARY KEY (id),
        KEY ix_readings_device_recorded (device_id, recorded_at),
        CONSTRAINT fk_readings_device FOREIGN KEY (device_id) REFERENCES devices (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  },
};
