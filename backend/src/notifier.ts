/**
 * The sender (docs/adr/0008). Ingest and the Offline sweep only write rows to the notifications
 * outbox; this loop delivers them. Each pass claims the due rows, and once the oldest has waited
 * the coalescing window it sends them all as one email and marks them sent, or, if the relay
 * fails, leaves them to retry with backoff until a day has passed and they are marked failed.
 * The claim holds the rows until the pass commits, so a restart, a database outage, or an SMTP
 * outage delays an email and never drops one; the only duplicate is a crash between the relay
 * taking it and the mark. The backend runs as one process (docs/adr/0001), so one sender runs,
 * as one sweep does; SKIP LOCKED would keep a second off the same rows all the same.
 */
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { ConditionLevel, ConditionName } from './conditions';
import type { AppDeps } from './deps';
import { serverTimeZone } from './localDay';
import { MailerError, type Mailer } from './mailer';
import { notificationEmail, type QueuedNotification } from './notificationEmail';
import { DEFAULT_RETRY, givesUp, readyToSend, retryDelayMs, type NotificationKind, type RetryPolicy } from './outbox';
import { dropStaleReminders } from './outboxStore';

/** How often a pass runs by default: well inside the coalescing window, and cheap when nothing is due. */
const DEFAULT_INTERVAL_MS = 5_000;

/** The most notifications one email carries; any more go in the next pass. */
const BATCH_LIMIT = 200;

/** The subject column's width. */
const SUBJECT_MAX = 255;

export interface NotifierOptions {
  /** How often a pass runs. */
  intervalMs?: number;
  /** How long the oldest due notification waits for others before the batch is sent. NOTIFY_COALESCE_SECONDS by default. */
  coalesceMs?: number;
  /** Backoff after a failed send, and when to give up. 30 s doubling to 15 min, for a day, by default. */
  retry?: RetryPolicy;
  /** The zone the email's times are written in. The server's own by default. */
  timeZone?: string;
  /** Where a failed pass is reported. The next pass still runs. */
  onError?: (error: unknown) => void;
}

export interface Notifier {
  /** Stop the schedule. A pass already in flight finishes. */
  stop(): void;
}

type NotifierDeps = Pick<AppDeps, 'pool' | 'config' | 'now'> & { mailer: Mailer };

interface DueRow extends RowDataPacket {
  id: number;
  createdAt: Date;
  attempts: number;
}

interface QueuedRow extends RowDataPacket {
  id: number;
  kind: NotificationKind;
  queuedAt: Date;
  incidentId: number;
  conditionName: ConditionName;
  level: ConditionLevel;
  startedAt: Date;
  endedAt: Date | null;
  peakTempF: number;
  peakHumidity: number | null;
  peakRecordedAt: Date;
  deviceId: number;
  hostname: string;
  closet: string;
  campusName: string;
  campusShortcode: string;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
}

/** The claimed rows with their Incident and Device as they stand now, for the email. */
async function queuedNotifications(conn: PoolConnection, ids: number[]): Promise<QueuedNotification[]> {
  const [rows] = await conn.query<QueuedRow[]>(
    `SELECT n.id, n.kind, n.created_at AS queuedAt, i.id AS incidentId, i.condition_name AS conditionName, i.worst_level AS level,
            i.started_at AS startedAt, i.ended_at AS endedAt,
            i.peak_temp_f AS peakTempF, i.peak_humidity AS peakHumidity, i.peak_recorded_at AS peakRecordedAt,
            i.acknowledged_at AS acknowledgedAt, i.acknowledged_by AS acknowledgedBy,
            d.id AS deviceId, d.hostname, d.closet, c.name AS campusName, c.shortcode AS campusShortcode
     FROM notifications n
     JOIN incidents i ON i.id = n.incident_id
     JOIN devices d ON d.id = n.device_id
     JOIN campuses c ON c.id = d.campus_id
     WHERE n.id IN (?) ORDER BY n.id`,
    [ids],
  );
  return rows.map((r) => ({
    kind: r.kind,
    queuedAt: r.queuedAt,
    incident: {
      id: r.incidentId,
      condition: r.conditionName,
      level: r.level,
      start: r.startedAt,
      end: r.endedAt,
      peak: { tempF: r.peakTempF, humidity: r.peakHumidity, recordedAt: r.peakRecordedAt },
      acknowledgement: r.acknowledgedAt === null || r.acknowledgedBy === null ? null : { by: r.acknowledgedBy, at: r.acknowledgedAt },
    },
    device: { id: r.deviceId, hostname: r.hostname, closet: r.closet, campus: { name: r.campusName, shortcode: r.campusShortcode } },
  }));
}

/** Push each row's next try back by the backoff, or mark it failed once it has been queued a day. */
async function recordFailure(conn: PoolConnection, due: DueRow[], error: MailerError, at: Date, retry: RetryPolicy): Promise<void> {
  for (const row of due) {
    const attempts = row.attempts + 1;
    await conn.query(
      'UPDATE notifications SET attempts = ?, last_attempt_at = ?, last_error = ?, next_attempt_at = ?, failed_at = ? WHERE id = ?',
      [attempts, at, error.message.slice(0, 1000), new Date(at.getTime() + retryDelayMs(attempts, retry)), givesUp(row.createdAt, at, retry) ? at : null, row.id],
    );
  }
}

/**
 * One pass: claim what is due and, once its window has passed, send it as one email. Returns how
 * many notifications went. A relay failure is recorded on the rows, which then wait their backoff,
 * and the pass rejects with the MailerError. Nothing happens while notifications are off.
 */
export async function runNotifierPass({ pool, config, mailer, now = () => new Date() }: NotifierDeps, options: NotifierOptions = {}): Promise<number> {
  const notifications = config.notifications;
  if (notifications === undefined) return 0;
  const { coalesceMs = notifications.coalesceSeconds * 1000, retry = DEFAULT_RETRY, timeZone = serverTimeZone() } = options;
  const conn = await pool.getConnection();
  try {
    // Read committed: the claim locks only the rows it takes, never the gaps ingest inserts into,
    // so a slow relay holds up no Reading while the rows stay claimed.
    await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await conn.beginTransaction();
    const at = now();
    const [due] = await conn.query<DueRow[]>(
      `SELECT id, created_at AS createdAt, attempts FROM notifications
       WHERE sent_at IS NULL AND failed_at IS NULL AND next_attempt_at <= ?
       ORDER BY next_attempt_at, id LIMIT ? FOR UPDATE SKIP LOCKED`,
      [at, BATCH_LIMIT],
    );
    // A reminder whose incident was acknowledged or ended since it was queued has nothing left to say.
    const dropped = new Set(await dropStaleReminders(conn, due.map((r) => r.id)));
    const live = due.filter((r) => !dropped.has(r.id));
    if (!readyToSend(live, at, coalesceMs)) {
      await conn.commit();
      return 0;
    }
    const ids = live.map((r) => r.id);
    const email = notificationEmail(await queuedNotifications(conn, ids), { publicUrl: notifications.publicUrl, timeZone });
    try {
      await mailer.send(email);
    } catch (error) {
      if (!(error instanceof MailerError)) throw error;
      await recordFailure(conn, live, error, now(), retry);
      await conn.commit();
      throw error;
    }
    const sentAt = now();
    await conn.query('UPDATE notifications SET sent_at = ?, subject = ?, attempts = attempts + 1, last_attempt_at = ? WHERE id IN (?)', [
      sentAt,
      email.subject.slice(0, SUBJECT_MAX),
      sentAt,
      ids,
    ]);
    await conn.commit();
    return ids.length;
  } catch (error) {
    // After a relay failure the rows are already committed; this rolls back nothing.
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

/**
 * Run a pass every interval, first one interval after start. Passes never overlap: a tick while
 * the relay is slow is skipped. The timer never keeps the process alive on its own.
 */
export function startNotifier(deps: NotifierDeps, options: NotifierOptions = {}): Notifier {
  const { intervalMs = DEFAULT_INTERVAL_MS, onError = (error) => console.error('notifications: send failed, will retry:', error instanceof Error ? error.message : error) } =
    options;
  let inFlight = false;
  const timer = setInterval(() => {
    if (inFlight) return;
    inFlight = true;
    runNotifierPass(deps, options)
      .catch(onError)
      .finally(() => {
        inFlight = false;
      });
  }, intervalMs);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
