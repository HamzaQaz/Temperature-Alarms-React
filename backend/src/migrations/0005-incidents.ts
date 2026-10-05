import type { Migration } from './index';

/**
 * Incidents and their level segments (docs/adr/0006). Both go with their Device, as its
 * Readings do. `open_condition` is the Condition while the incident is open and NULL once it
 * closes, so the unique key allows one open incident per Device and Condition and any number
 * of closed ones: a second writer can never open a duplicate. IF NOT EXISTS, so a run that died
 * before being recorded can repeat.
 */
export const incidentsSchema: Migration = {
  id: '0005-incidents',
  async up(conn) {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS incidents (
        id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        device_id        INT UNSIGNED    NOT NULL,
        condition_name   VARCHAR(20)     NOT NULL,
        worst_level      VARCHAR(10)     NOT NULL,
        started_at       DATETIME        NOT NULL,
        ended_at         DATETIME        NULL,
        peak_temp_f      INT             NOT NULL,
        peak_humidity    INT             NULL,
        peak_recorded_at DATETIME        NOT NULL,
        clean_readings   TINYINT UNSIGNED NOT NULL DEFAULT 0,
        first_clean_at   DATETIME        NULL,
        open_condition   VARCHAR(20) AS (IF(ended_at IS NULL, condition_name, NULL)) STORED,
        PRIMARY KEY (id),
        UNIQUE KEY uq_incidents_open (device_id, open_condition),
        KEY ix_incidents_started (started_at),
        KEY ix_incidents_ended (ended_at),
        CONSTRAINT fk_incidents_device FOREIGN KEY (device_id) REFERENCES devices (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS incident_segments (
        id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        incident_id BIGINT UNSIGNED NOT NULL,
        level       VARCHAR(10)     NOT NULL,
        started_at  DATETIME        NOT NULL,
        ended_at    DATETIME        NULL,
        PRIMARY KEY (id),
        KEY ix_incident_segments_incident (incident_id, started_at),
        CONSTRAINT fk_incident_segments_incident FOREIGN KEY (incident_id) REFERENCES incidents (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  },
};
