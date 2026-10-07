import type { Migration } from './index';
import { columnExists } from './introspect';

/**
 * Who acknowledged an incident, and when (CONTEXT.md, Acknowledgement): a technician's name or a
 * short note, free text, since there are no user accounts, only the Admin token (docs/adr/0003).
 * Both stay NULL until someone does. Guarded, so a run that died before being recorded can repeat.
 */
export const incidentAcknowledgementSchema: Migration = {
  id: '0012-incident-acknowledgement',
  async up(conn) {
    if (!(await columnExists(conn, 'incidents', 'acknowledged_at'))) {
      await conn.query(`ALTER TABLE incidents
        ADD COLUMN acknowledged_at DATETIME    NULL,
        ADD COLUMN acknowledged_by VARCHAR(60) NULL`);
    }
  },
};
