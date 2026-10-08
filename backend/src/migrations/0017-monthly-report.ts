import type { RowDataPacket } from 'mysql2/promise';
import type { Migration } from './index';
import { columnExists } from './introspect';

/**
 * The monthly report (docs/adr/0008): the outbox learns the `report` kind, a row that belongs to
 * no Incident or Device, so those columns and the level may be NULL, and names the month it
 * covers in `report_month` (YYYY-MM); the email is built from that month when it is sent.
 * `monthly_reports` records each month whose scheduled report was queued, so a restart never
 * queues it twice, and outlives the week the outbox keeps its rows. Guarded, the enum gains
 * `report` beside whatever kinds it has (`hold` among them), and the column changes repeat
 * harmlessly, so a run that died before being recorded can repeat.
 */
export const monthlyReportSchema: Migration = {
  id: '0017-monthly-report',
  async up(conn) {
    await conn.query(`
      ALTER TABLE notifications
        MODIFY COLUMN incident_id BIGINT UNSIGNED NULL,
        MODIFY COLUMN device_id INT UNSIGNED NULL,
        MODIFY COLUMN level VARCHAR(10) NULL
    `);
    const [[{ type }]] = await conn.query<RowDataPacket[]>(
      "SELECT column_type AS type FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'notifications' AND column_name = 'kind'",
    );
    if (!/'report'/.test(type as string)) {
      await conn.query(`ALTER TABLE notifications MODIFY COLUMN kind ${(type as string).replace(/\)$/, ",'report')")} NOT NULL`);
    }
    if (!(await columnExists(conn, 'notifications', 'report_month'))) {
      await conn.query('ALTER TABLE notifications ADD COLUMN report_month CHAR(7) NULL');
    }
    await conn.query(`
      CREATE TABLE IF NOT EXISTS monthly_reports (
        month     CHAR(7)     NOT NULL,
        queued_at DATETIME(3) NOT NULL,
        PRIMARY KEY (month)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  },
};
