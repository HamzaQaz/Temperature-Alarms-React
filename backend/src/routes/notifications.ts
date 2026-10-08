import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import type { RowDataPacket } from 'mysql2/promise';
import { requireAdminToken } from '../auth';
import { parseAddressList, type NotificationsConfig } from '../config';
import type { RouteDeps } from '../deps';
import { MailerError, type Email } from '../mailer';
import { MonotonicStore } from '../monotonicStore';
import { listKey, recipientLists } from '../outbox';
import { outboxStatus, type ListResult } from '../outboxStore';

/** The email the Settings button sends: proof that the relay, the sender, and the recipients work. */
export function testEmail({ smtp, publicUrl }: NotificationsConfig, sentAt: Date): Email {
  return {
    subject: '[Temperature Alarms] Test email',
    text: [
      'This is a test email from Temperature Alarms, sent from the Settings page.',
      '',
      `If you are reading it, the relay at ${smtp.host}:${smtp.port} delivers to this address, and Incident emails will arrive the same way.`,
      '',
      `Dashboard: ${publicUrl}`,
      `Sent: ${sentAt.toISOString()}`,
    ].join('\n'),
  };
}

/** The later of two results, either of which may be missing. */
function latest<T extends { at: Date }>(a: T | null, b: T | null): T | null {
  if (a === null) return b;
  if (b === null) return a;
  return b.at.getTime() > a.at.getTime() ? b : a;
}

const serialised = <T extends { at: Date }>(result: T | null) => (result === null ? null : { ...result, at: result.at.toISOString() });

interface CampusListRow extends RowDataPacket {
  shortcode: string;
  notifyTo: string;
}

/**
 * Email notifications (docs/adr/0008), both behind the Admin token. GET /api/notifications/status
 * says whether they are on, through which relay, to whom, how the last send went, and how many
 * wait in the outbox or were given up on; and for each recipient list (NOTIFY_TO, and each
 * Campus's own), which Campuses email it and how its last try went.
 * POST /api/notifications/test sends a test email now, at most one a minute, and returns the relay's reply.
 */
export function notificationsRouter({ config, pool, mailer, now = () => new Date() }: RouteDeps): Router {
  const router = Router();
  const adminOnly = requireAdminToken(config);
  const notifications = config.notifications;

  // The test email skips the outbox, so its result is kept here, for this process only. Incident
  // emails are read from the outbox's rows, which a restart keeps.
  let testSent: { at: Date; subject: string } | null = null;
  let testFailure: { at: Date; error: string } | null = null;
  // The test email goes to NOTIFY_TO, so its result is also the default list's latest.
  let testResult: ListResult | null = null;

  router.get('/status', adminOnly, async (_req, res, next) => {
    try {
      const outbox = await outboxStatus(pool);
      const [campuses] = await pool.query<CampusListRow[]>('SELECT shortcode, notify_to AS notifyTo FROM campuses ORDER BY name');
      const lists =
        notifications === undefined
          ? []
          : recipientLists(
              campuses.map((c) => ({ shortcode: c.shortcode, notifyTo: parseAddressList(c.notifyTo).addresses })),
              notifications.to,
              notifications.toAll,
            ).map((list) => ({
              ...list,
              lastResult: serialised(latest(outbox.lastByList.get(listKey(list.recipients)) ?? null, list.isDefault ? testResult : null)),
            }));
      res.json({
        enabled: notifications !== undefined,
        // Addresses are shown: whoever holds the Admin token already holds .env. The password never is.
        relay: notifications === undefined ? null : { host: notifications.smtp.host, port: notifications.smtp.port, secure: notifications.smtp.secure },
        from: notifications?.from ?? null,
        recipients: notifications?.to ?? [],
        toAll: notifications?.toAll ?? false,
        lists,
        lastSent: serialised(latest(outbox.lastSent, testSent)),
        lastFailure: serialised(latest(outbox.lastFailure, testFailure)),
        pending: outbox.pending,
        failed: outbox.failed,
      });
    } catch (error) {
      next(error);
    }
  });

  // One a minute whoever asks: every press emails every recipient. Counted only once the token is
  // accepted and notifications are on, so neither a refusal nor a press while off spends it.
  const testLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 1,
    store: new MonotonicStore(),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: () => 'test-email',
    message: { error: 'Only one test email a minute: wait a minute and try again.' },
    validate: false,
  });

  if (notifications === undefined || mailer === undefined) {
    router.post('/test', adminOnly, (_req, res) => {
      res.status(409).json({ error: 'Email notifications are off: set SMTP_HOST, NOTIFY_FROM, NOTIFY_TO, and PUBLIC_URL in .env and restart the server.' });
    });
    return router;
  }

  router.post('/test', adminOnly, testLimiter, async (_req, res, next) => {
    const sentAt = now();
    const email = testEmail(notifications, sentAt);
    try {
      const { accepted, rejected, response } = await mailer.send(email);
      testSent = { at: sentAt, subject: email.subject };
      testResult = { at: sentAt, sent: true, subject: email.subject };
      res.json({ sentAt: sentAt.toISOString(), accepted, rejected, response });
    } catch (error) {
      if (error instanceof MailerError) {
        testFailure = { at: sentAt, error: error.message };
        testResult = { at: sentAt, sent: false, error: error.message };
        res.status(502).json({ error: `The relay did not take the test email: ${error.message}` });
        return;
      }
      next(error);
    }
  });

  return router;
}
