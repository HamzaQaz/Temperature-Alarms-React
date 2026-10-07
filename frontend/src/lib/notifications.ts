import type { NotificationStatus, TestEmailResult } from '../types.ts';

/** What the Notifications tab says about email notifications. */
export interface NotificationsSummary {
  /** Off, or on through which relay and from whom. */
  state: string;
  /** Who receives them, or how to turn them on. */
  detail: string;
  /** The last email the relay took, or null if none in the last week. */
  lastSent: string | null;
  /** The last one it did not, with its reason, or null. */
  lastFailure: string | null;
  /** How many wait in the outbox, or null when none do. */
  pending: string | null;
  /** How many were given up on, or null when none were. */
  failed: string | null;
}

const notifications = (n: number): string => `${n} notification${n === 1 ? '' : 's'}`;

const SECURITY: Record<NonNullable<NotificationStatus['relay']>['secure'], string> = {
  starttls: 'STARTTLS',
  tls: 'TLS',
  none: 'no encryption',
};

export function notificationsSummary(status: NotificationStatus, timeOf: (iso: string) => string): NotificationsSummary {
  const { enabled, relay, from, recipients, lastSent, lastFailure, pending, failed } = status;
  if (!enabled || relay === null) {
    return {
      state: 'Off.',
      detail: "Set SMTP_HOST, NOTIFY_FROM, NOTIFY_TO, and PUBLIC_URL in the server's .env and restart it to email technicians about Incidents.",
      lastSent: null,
      lastFailure: null,
      pending: null,
      failed: null,
    };
  }
  return {
    state: `On, through ${relay.host}:${relay.port} (${SECURITY[relay.secure]})${from === null ? '' : `, from ${from}`}.`,
    detail: `Sent to ${recipients.join(', ')}.`,
    lastSent: lastSent === null ? null : `Last sent ${timeOf(lastSent.at)}: ${lastSent.subject}.`,
    lastFailure: lastFailure === null ? null : `Last failure ${timeOf(lastFailure.at)}: ${lastFailure.error}`,
    pending: pending === 0 ? null : `${notifications(pending)} waiting to be sent.`,
    failed: failed === 0 ? null : `${notifications(failed)} could not be delivered within a day and ${failed === 1 ? 'was' : 'were'} given up on this week.`,
  };
}

/** The line after a test email went out: who the relay took it for, any it refused, and its reply. */
export function testEmailSent({ accepted, rejected, response }: TestEmailResult): string {
  const refused = rejected.length === 0 ? '' : ` It refused ${rejected.join(', ')}.`;
  return `Test email sent to ${accepted.join(', ')}.${refused} The relay answered: ${response}`;
}
