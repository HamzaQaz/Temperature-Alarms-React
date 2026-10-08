import type { Migration } from './index';
import { columnExists } from './introspect';

/**
 * Recipients per Campus (docs/adr/0008): `campuses.notify_to` is the Campus's own recipient list,
 * comma-separated, empty for a Campus that emails NOTIFY_TO. `notifications.recipients` is the list
 * a row was last tried with, NULL until its first try, so Settings can give the last result per
 * list. Guarded, so a run that died before being recorded can repeat.
 */
export const campusRecipientsSchema: Migration = {
  id: '0014-campus-recipients',
  async up(conn) {
    if (!(await columnExists(conn, 'campuses', 'notify_to'))) {
      await conn.query("ALTER TABLE campuses ADD COLUMN notify_to VARCHAR(1000) NOT NULL DEFAULT ''");
    }
    if (!(await columnExists(conn, 'notifications', 'recipients'))) {
      await conn.query('ALTER TABLE notifications ADD COLUMN recipients TEXT NULL');
    }
  },
};
