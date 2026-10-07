/**
 * The notifications outbox in the database (docs/adr/0008): queue the Incident changes that are
 * emailed, report how sending goes, and prune what has been dealt with. The sender that claims
 * and marks the rows is notifier.ts; the rules are in outbox.ts.
 */
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { ConditionLevel } from './conditions';
import type { ChangedIncident } from './incidentStore';
import { notificationKinds } from './outbox';

/** A pool or one of its connections: anything that runs a statement. */
type Db = Pool | PoolConnection;

/** How long a sent or given-up notification is kept, for the Settings status, before retention removes it. */
export const NOTIFICATION_KEEP_DAYS = 7;

interface ChangedRow extends RowDataPacket {
  id: number;
  deviceId: number;
  level: ConditionLevel;
  campusShortcode: string;
}

interface SegmentLevelRow extends RowDataPacket {
  incidentId: number;
  level: ConditionLevel;
}

/**
 * Queue the notifications these incident changes call for (outbox.ts), due at once. Call it on
 * the connection that saved the changes, inside their transaction, holding the Device's row lock,
 * so the change and its email commit or roll back together. The caller skips it while
 * notifications are off. Returns how many rows it wrote.
 */
export async function enqueueNotifications(db: Db, changed: ChangedIncident[], at: Date): Promise<number> {
  if (changed.length === 0) return 0;
  const ids = changed.map((c) => c.id);
  const [incidents] = await db.query<ChangedRow[]>(
    `SELECT i.id, i.device_id AS deviceId, i.worst_level AS level, c.shortcode AS campusShortcode
     FROM incidents i JOIN devices d ON d.id = i.device_id JOIN campuses c ON c.id = d.campus_id
     WHERE i.id IN (?)`,
    [ids],
  );
  const byId = new Map(incidents.map((i) => [i.id, i]));
  // Only a level change needs the segments: whether this step raised the worst level.
  const levelChanges = changed.filter((c) => c.change === 'level').map((c) => c.id);
  const segmentLevels = new Map<number, ConditionLevel[]>();
  if (levelChanges.length > 0) {
    const [segments] = await db.query<SegmentLevelRow[]>(
      'SELECT incident_id AS incidentId, level FROM incident_segments WHERE incident_id IN (?) ORDER BY incident_id, started_at, id',
      [levelChanges],
    );
    for (const s of segments) segmentLevels.set(s.incidentId, [...(segmentLevels.get(s.incidentId) ?? []), s.level]);
  }
  const rows: unknown[][] = [];
  for (const { id, change, created } of changed) {
    const incident = byId.get(id);
    if (incident === undefined) continue;
    const kinds = notificationKinds({ change, created, level: incident.level, segmentLevels: segmentLevels.get(id) ?? [], campusShortcode: incident.campusShortcode });
    for (const kind of kinds) rows.push([id, incident.deviceId, kind, incident.level, at, at]);
  }
  if (rows.length === 0) return 0;
  await db.query('INSERT INTO notifications (incident_id, device_id, kind, level, created_at, next_attempt_at) VALUES ?', [rows]);
  return rows.length;
}

/** How sending goes, as Settings shows it. */
export interface OutboxStatus {
  /** Waiting to be sent, retries included. */
  pending: number;
  /** Given up on after a day of retries, within the last NOTIFICATION_KEEP_DAYS. */
  failed: number;
  /** The last email the relay took, and its subject. */
  lastSent: { at: Date; subject: string } | null;
  /** The last try the relay refused or could not be reached for, and why. */
  lastFailure: { at: Date; error: string } | null;
}

interface CountsRow extends RowDataPacket {
  pending: number | string | null;
  failed: number | string | null;
}

interface SentRow extends RowDataPacket {
  at: Date;
  subject: string;
}

interface FailureRow extends RowDataPacket {
  at: Date;
  error: string;
  failedAt: Date | null;
}

/** What the outbox says about sending: read from its rows, so a restart keeps it. */
export async function outboxStatus(db: Db): Promise<OutboxStatus> {
  const [[counts]] = await db.query<CountsRow[]>(
    'SELECT SUM(sent_at IS NULL AND failed_at IS NULL) AS pending, SUM(failed_at IS NOT NULL) AS failed FROM notifications',
  );
  const [sent] = await db.query<SentRow[]>(
    'SELECT sent_at AS at, subject FROM notifications WHERE sent_at IS NOT NULL ORDER BY sent_at DESC, id DESC LIMIT 1',
  );
  const [failures] = await db.query<FailureRow[]>(
    `SELECT last_attempt_at AS at, last_error AS error, failed_at AS failedAt FROM notifications
     WHERE last_error IS NOT NULL ORDER BY last_attempt_at DESC, id DESC LIMIT 1`,
  );
  const failure = failures[0];
  return {
    pending: Number(counts.pending ?? 0),
    failed: Number(counts.failed ?? 0),
    lastSent: sent[0] === undefined ? null : { at: sent[0].at, subject: sent[0].subject },
    lastFailure:
      failure === undefined
        ? null
        : { at: failure.at, error: failure.failedAt === null ? failure.error : `Given up after a day of retries: ${failure.error}` },
  };
}

/**
 * Remove every notification sent or given up on before `cutoff`. Pending ones stay however old:
 * they go with their Incident (Reset history, retention) or once they are sent. Returns how many went.
 */
export async function deleteNotificationsBefore(db: Db, cutoff: Date): Promise<number> {
  const [result] = await db.query<ResultSetHeader>('DELETE FROM notifications WHERE sent_at < ? OR failed_at < ?', [cutoff, cutoff]);
  return result.affectedRows;
}
