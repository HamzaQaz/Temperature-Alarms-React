/**
 * The sender (docs/adr/0008). Ingest and the Offline sweep only write rows to the notifications
 * outbox; this loop delivers them. Each pass claims the due rows and groups them by recipient list
 * (their Campus's own, or NOTIFY_TO); once a list's oldest has waited the coalescing window it
 * sends them all as one email to that list and marks them sent, or, if the relay fails, leaves
 * them to retry with backoff until a day has passed and they are marked failed. Each list is
 * claimed, sent, and marked in its own transaction, so one the relay refuses neither holds back nor
 * resends another's. The claim holds the rows until it commits, so a restart, a database outage,
 * or an SMTP outage delays an email and never drops one; the only duplicate is a crash between the
 * relay taking it and the mark. The backend runs as one process (docs/adr/0001), so one sender
 * runs, as one sweep does; SKIP LOCKED would keep a second off the same rows all the same.
 *
 * A held release and a monthly report are rows with no Incident, each sent as an email of its own,
 * never in an Incident digest; a report goes to NOTIFY_TO alone, and the pass queues the scheduled
 * one when it is due (monthlyReport.ts).
 */
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { ConditionLevel, ConditionName } from './conditions';
import { parseAddressList, type NotificationsConfig } from './config';
import type { AppDeps } from './deps';
import { dropStaleHolds, queuedHold } from './firmwareStore';
import { holdEmail } from './holdEmail';
import { serverTimeZone } from './localDay';
import { MailerError, type Mailer } from './mailer';
import { queuedReportEmail, queueScheduledReport } from './monthlyReport';
import { notificationEmail, type QueuedNotification } from './notificationEmail';
import { byRecipients, DEFAULT_RETRY, givesUp, listKey, readyToSend, recipientsFor, retryDelayMs, type NotificationKind, type RetryPolicy } from './outbox';
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
  /**
   * Stop the schedule; resolves once a pass in flight has finished, so an email the relay took is
   * marked sent rather than rolled back and sent again by the next process.
   */
  stop(): Promise<void>;
}

type NotifierDeps = Pick<AppDeps, 'pool' | 'config' | 'now'> & { mailer: Mailer };

interface DueRow extends RowDataPacket {
  id: number;
  /**
   * `hold` is a firmware release held by itself (firmwareStore.ts), `report` a monthly report
   * (monthlyReport.ts): no Incident, each an email of its own.
   */
  kind: NotificationKind | 'hold' | 'report';
  createdAt: Date;
  attempts: number;
  /** The month a `report` covers, YYYY-MM. */
  reportMonth: string | null;
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

interface CampusListRow extends RowDataPacket {
  id: number;
  notifyTo: string | null;
}

/**
 * Who each claimed row goes to, by its Campus's list as it stands now (outbox.ts, recipientsFor).
 * A plain read, so it locks no Device or Campus. A row with no Campus goes to NOTIFY_TO.
 */
async function recipientsOf(conn: PoolConnection, ids: number[], { to, toAll }: NotificationsConfig): Promise<Map<number, string[]>> {
  if (ids.length === 0) return new Map();
  const [rows] = await conn.query<CampusListRow[]>(
    `SELECT n.id, c.notify_to AS notifyTo FROM notifications n
     LEFT JOIN devices d ON d.id = n.device_id LEFT JOIN campuses c ON c.id = d.campus_id
     WHERE n.id IN (?)`,
    [ids],
  );
  return new Map(rows.map((r) => [r.id, recipientsFor(parseAddressList(r.notifyTo ?? '').addresses, to, toAll)]));
}

/** Push each row's next try back by the backoff, or mark it failed once it has been queued a day. */
async function recordFailure(conn: PoolConnection, due: DueRow[], recipients: string, error: MailerError, at: Date, retry: RetryPolicy): Promise<void> {
  for (const row of due) {
    const attempts = row.attempts + 1;
    await conn.query(
      'UPDATE notifications SET attempts = ?, last_attempt_at = ?, last_error = ?, next_attempt_at = ?, failed_at = ?, recipients = ? WHERE id = ?',
      [attempts, at, error.message.slice(0, 1000), new Date(at.getTime() + retryDelayMs(attempts, retry)), givesUp(row.createdAt, at, retry) ? at : null, recipients, row.id],
    );
  }
}

/** What one recipient list's turn came to: how many went, or the relay's refusal. Keyed by the list. */
type ListOutcome = { list: string; sent: number } | { list: string; error: MailerError };

/**
 * One list's turn: claim what is due, and send the first list whose window has passed and which has
 * not had its turn this pass (`tried`) as one email. Returns what came of it, or undefined when no
 * list is ready. A relay failure is recorded on that list's rows, which then wait their backoff.
 */
async function sendNextList(
  { pool, config, mailer, now = () => new Date() }: NotifierDeps,
  notifications: NotificationsConfig,
  { coalesceMs = notifications.coalesceSeconds * 1000, retry = DEFAULT_RETRY, timeZone = serverTimeZone() }: NotifierOptions,
  tried: ReadonlySet<string>,
): Promise<ListOutcome | undefined> {
  const conn = await pool.getConnection();
  try {
    // Read committed: the claim locks only the rows it takes, never the gaps ingest inserts into,
    // so a slow relay holds up no Reading while the rows stay claimed.
    await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await conn.beginTransaction();
    const at = now();
    const [due] = await conn.query<DueRow[]>(
      `SELECT id, kind, created_at AS createdAt, attempts, report_month AS reportMonth FROM notifications
       WHERE sent_at IS NULL AND failed_at IS NULL AND next_attempt_at <= ?
       ORDER BY next_attempt_at, id LIMIT ? FOR UPDATE SKIP LOCKED`,
      [at, BATCH_LIMIT],
    );
    // A reminder whose incident was acknowledged or ended since it was queued has nothing left to say,
    // nor has a hold whose release was withdrawn or replaced.
    const claimed = due.map((r) => r.id);
    const dropped = new Set([...(await dropStaleReminders(conn, claimed)), ...(await dropStaleHolds(conn, claimed))]);
    const live = due.filter((r) => !dropped.has(r.id));
    const recipients = await recipientsOf(conn, live.map((r) => r.id), notifications);
    const defaults = recipientsFor([], notifications.to, notifications.toAll);
    const listOf = (r: DueRow) => recipients.get(r.id) ?? defaults;
    // A held release (it has no Campus, so the default list) is its own email, ahead of that list's
    // Incidents, which go in its next turn. So is each monthly report, which goes to NOTIFY_TO alone
    // (owner decision), and at once: it has nothing to wait for. Each list coalesces on its own: a
    // retry or a full window in one never hurries another.
    const holds = live.filter((r) => r.kind === 'hold');
    const hold = holds.length > 0 ? await queuedHold(conn) : null;
    const groups = [
      ...(hold !== null ? byRecipients(holds, listOf).map((group) => ({ ...group, hold, report: null })) : []),
      ...live.filter((r) => r.kind === 'report').map((report) => ({ recipients: defaults, due: [report], hold: null, report })),
      ...byRecipients(live.filter((r) => r.kind !== 'hold' && r.kind !== 'report'), listOf).map((group) => ({ ...group, hold: null, report: null })),
    ];
    const batch = groups.find(
      (group) => !tried.has(listKey(group.recipients)) && (group.report !== null || readyToSend(group.due, at, coalesceMs)),
    );
    if (batch === undefined) {
      await conn.commit();
      return undefined;
    }
    const list = listKey(batch.recipients);
    const ids = batch.due.map((r) => r.id);
    const settings = { publicUrl: notifications.publicUrl, timeZone };
    const email =
      batch.hold !== null
        ? holdEmail(batch.hold, settings)
        : batch.report !== null
          ? await queuedReportEmail(conn, batch.report.reportMonth, config.thresholds, settings)
          : notificationEmail(await queuedNotifications(conn, ids), settings);
    if (email === undefined) {
      // A report on a month that cannot be read: nothing could ever send it, so it is given up, where Settings shows it.
      await conn.query('UPDATE notifications SET last_attempt_at = ?, last_error = ?, failed_at = ? WHERE id IN (?)', [
        at,
        `Not a month: "${batch.report?.reportMonth}"`,
        at,
        ids,
      ]);
      await conn.commit();
      return { list, sent: 0 };
    }
    try {
      await mailer.send({ ...email, to: batch.recipients });
    } catch (error) {
      if (!(error instanceof MailerError)) throw error;
      await recordFailure(conn, batch.due, list, error, now(), retry);
      await conn.commit();
      return { list, error };
    }
    const sentAt = now();
    await conn.query('UPDATE notifications SET sent_at = ?, subject = ?, attempts = attempts + 1, last_attempt_at = ?, recipients = ? WHERE id IN (?)', [
      sentAt,
      email.subject.slice(0, SUBJECT_MAX),
      sentAt,
      list,
      ids,
    ]);
    await conn.commit();
    return { list, sent: ids.length };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

/**
 * One pass: with the monthly report on, queue last month's if it was not queued before; then send
 * each recipient list whose window has passed, one email and one turn each. Returns how many
 * notifications went. A relay failure is recorded on that list's rows, which then wait their
 * backoff; the other lists still go, and the pass then rejects with the MailerError. Nothing
 * happens while notifications are off.
 */
export async function runNotifierPass(deps: NotifierDeps, options: NotifierOptions = {}): Promise<number> {
  const notifications = deps.config.notifications;
  if (notifications === undefined) return 0;
  if (notifications.monthlyReport) {
    const { pool, now = () => new Date() } = deps;
    await queueScheduledReport(pool, now(), options.timeZone ?? serverTimeZone());
  }
  const tried = new Set<string>();
  let sent = 0;
  let failure: MailerError | undefined;
  for (;;) {
    const outcome = await sendNextList(deps, notifications, options, tried);
    if (outcome === undefined) break;
    tried.add(outcome.list);
    if ('error' in outcome) failure ??= outcome.error;
    else sent += outcome.sent;
  }
  if (failure !== undefined) throw failure;
  return sent;
}

/**
 * Run a pass every interval, first one interval after start. Passes never overlap: a tick while
 * the relay is slow is skipped. The timer never keeps the process alive on its own.
 */
export function startNotifier(deps: NotifierDeps, options: NotifierOptions = {}): Notifier {
  const { intervalMs = DEFAULT_INTERVAL_MS, onError = (error) => console.error('notifications: send failed, will retry:', error instanceof Error ? error.message : error) } =
    options;
  let inFlight: Promise<unknown> | undefined;
  const timer = setInterval(() => {
    if (inFlight !== undefined) return;
    inFlight = runNotifierPass(deps, options)
      .catch(onError)
      .finally(() => {
        inFlight = undefined;
      });
  }, intervalMs);
  timer.unref();
  return {
    stop: async () => {
      clearInterval(timer);
      await inFlight;
    },
  };
}
