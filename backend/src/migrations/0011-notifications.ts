import type { Migration } from './index';

/**
 * The notifications outbox (docs/adr/0008): one row for each Incident that opened, got worse, or
 * closed, written in the transaction that recorded the change, and marked sent or failed by the
 * sender. Rows go with their Incident and their Device, so Reset history and retention take
 * pending ones with them. Times keep milliseconds, since the sender's window and backoff are
 * counted from them. IF NOT EXISTS, so a run that died before being recorded can repeat.
 */
export const notificationsSchema: Migration = {
  id: '0011-notifications',
  async up(conn) {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        incident_id     BIGINT UNSIGNED NOT NULL,
        device_id       INT UNSIGNED    NOT NULL,
        kind            ENUM('opened', 'worse', 'closed') NOT NULL,
        level           VARCHAR(10)     NOT NULL,
        created_at      DATETIME(3)     NOT NULL,
        next_attempt_at DATETIME(3)     NOT NULL,
        attempts        INT UNSIGNED    NOT NULL DEFAULT 0,
        last_attempt_at DATETIME(3)     NULL,
        last_error      VARCHAR(1000)   NULL,
        sent_at         DATETIME(3)     NULL,
        subject         VARCHAR(255)    NULL,
        failed_at       DATETIME(3)     NULL,
        PRIMARY KEY (id),
        KEY ix_notifications_due (sent_at, failed_at, next_attempt_at),
        KEY ix_notifications_attempt (last_attempt_at),
        CONSTRAINT fk_notifications_incident FOREIGN KEY (incident_id) REFERENCES incidents (id) ON DELETE CASCADE,
        CONSTRAINT fk_notifications_device FOREIGN KEY (device_id) REFERENCES devices (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  },
};
