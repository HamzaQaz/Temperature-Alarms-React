import type { Migration } from './index';
import { columnExists } from './introspect';

/**
 * Quiet hours (docs/adr/0008): `notifications.not_before` is when quiet hours first let a held
 * warning go, NULL for a row they never held. The sender pushes a held row's next try to the
 * same instant; its day of retries counts from here, not from when it was queued, and Settings
 * counts the rows still held. Guarded, so a run that died before being recorded can repeat.
 */
export const quietHoursSchema: Migration = {
  id: '0019-quiet-hours',
  async up(conn) {
    if (!(await columnExists(conn, 'notifications', 'not_before'))) {
      await conn.query('ALTER TABLE notifications ADD COLUMN not_before DATETIME(3) NULL');
    }
  },
};
