import type { RowDataPacket } from 'mysql2/promise';
import type { Migration } from './index';
import { columnExists } from './introspect';

/**
 * Staged rollout with an automatic hold (docs/adr/0007). The release records when a staged one was
 * opened to every Device (`only_hostnames` keeps the Devices it went to first) and, when one of those
 * failed it, the hold: when, which Device, why. Each Device records when the server last sent it the
 * image, to the millisecond, so a report can be told apart from the download just before it, and how
 * many good Readings in a row it has sent on its version. The outbox learns the `hold` kind, a row
 * with no Incident. Guarded, and the enum gains `hold` beside whatever kinds it has, so a run that
 * died before being recorded can repeat.
 */
export const stagedRolloutSchema: Migration = {
  id: '0015-staged-rollout',
  async up(conn) {
    if (!(await columnExists(conn, 'firmware_release', 'held_at'))) {
      await conn.query(`ALTER TABLE firmware_release
        ADD COLUMN widened_at    DATETIME    NULL,
        ADD COLUMN held_at       DATETIME    NULL,
        ADD COLUMN held_hostname VARCHAR(20) NULL,
        ADD COLUMN held_reason   VARCHAR(20) NULL,
        ADD COLUMN held_detail   VARCHAR(80) NULL`);
    }
    if (!(await columnExists(conn, 'devices', 'firmware_sent_at'))) {
      await conn.query(`ALTER TABLE devices
        ADD COLUMN firmware_sent_at       DATETIME(3)  NULL,
        ADD COLUMN firmware_clean_reports INT UNSIGNED NOT NULL DEFAULT 0`);
    }
    await conn.query('ALTER TABLE notifications MODIFY COLUMN incident_id BIGINT UNSIGNED NULL');
    const [[{ type }]] = await conn.query<RowDataPacket[]>(
      "SELECT column_type AS type FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'notifications' AND column_name = 'kind'",
    );
    if (!/'hold'/.test(type as string)) {
      await conn.query(`ALTER TABLE notifications MODIFY COLUMN kind ${(type as string).replace(/\)$/, ",'hold')")} NOT NULL`);
    }
  },
};
