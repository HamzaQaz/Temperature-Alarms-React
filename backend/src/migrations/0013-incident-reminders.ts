import type { Migration } from './index';
import { columnExists } from './introspect';

/**
 * Reminders for long Incidents (docs/adr/0008): `incidents.last_reminded_at` is the point on the
 * Incident's own schedule (its start plus a whole number of periods) the last reminder was queued
 * for, NULL until the first, so a pass never queues one twice and a restart never starts the count
 * again. The outbox learns the `reminder` kind. Guarded, and the enum change repeats harmlessly,
 * so a run that died before being recorded can repeat.
 */
export const incidentRemindersSchema: Migration = {
  id: '0013-incident-reminders',
  async up(conn) {
    if (!(await columnExists(conn, 'incidents', 'last_reminded_at'))) {
      await conn.query('ALTER TABLE incidents ADD COLUMN last_reminded_at DATETIME NULL');
    }
    await conn.query("ALTER TABLE notifications MODIFY COLUMN kind ENUM('opened', 'worse', 'closed', 'reminder') NOT NULL");
  },
};
