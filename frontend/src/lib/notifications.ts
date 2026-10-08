import type { NotificationStatus, RecipientList, TestEmailResult } from '../types.ts';

/** One recipient list as the Notifications tab says it. */
export interface ListSummary {
  /** Who is on it. */
  recipients: string;
  /** Which Campuses email it. */
  campuses: string;
  /** How its last try went, or that nothing went to it in the last week. */
  lastResult: string;
  /** True when that last try failed. */
  failed: boolean;
}

/** What the Notifications tab says about email notifications. */
export interface NotificationsSummary {
  /** Off, or on through which relay and from whom. */
  state: string;
  /** How email finds its recipients, or how to turn it on. */
  detail: string;
  /** Each list email can go to, the default (NOTIFY_TO) first; empty while off. */
  lists: ListSummary[];
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

function listSummary({ recipients, campuses, isDefault, lastResult }: RecipientList, timeOf: (iso: string) => string): ListSummary {
  return {
    recipients: recipients.join(', '),
    campuses: isDefault
      ? `Default recipients (NOTIFY_TO), for ${campuses.length === 0 ? 'no Campus at present' : campuses.join(', ')} and the test email.`
      : `For ${campuses.join(', ')}.`,
    lastResult:
      lastResult === null
        ? 'Nothing sent in the last week.'
        : lastResult.sent
          ? `Last sent ${timeOf(lastResult.at)}: ${lastResult.subject}.`
          : `Last failure ${timeOf(lastResult.at)}: ${lastResult.error}`,
    failed: lastResult !== null && !lastResult.sent,
  };
}

export function notificationsSummary(status: NotificationStatus, timeOf: (iso: string) => string): NotificationsSummary {
  const { enabled, relay, from, toAll, lists, pending, failed } = status;
  if (!enabled || relay === null) {
    return {
      state: 'Off.',
      detail: "Set SMTP_HOST, NOTIFY_FROM, NOTIFY_TO, and PUBLIC_URL in the server's .env and restart it to email technicians about Incidents.",
      lists: [],
      pending: null,
      failed: null,
    };
  }
  return {
    state: `On, through ${relay.host}:${relay.port} (${SECURITY[relay.secure]})${from === null ? '' : `, from ${from}`}.`,
    detail: `Each Campus emails its own recipients, set under Campuses, or the default ones when it has none.${toAll ? ' The default recipients also get every email (NOTIFY_TO_ALL).' : ''}`,
    lists: lists.map((list) => listSummary(list, timeOf)),
    pending: pending === 0 ? null : `${notifications(pending)} waiting to be sent.`,
    failed: failed === 0 ? null : `${notifications(failed)} could not be delivered within a day and ${failed === 1 ? 'was' : 'were'} given up on this week.`,
  };
}

/** The line after a test email went out: who the relay took it for, any it refused, and its reply. */
export function testEmailSent({ accepted, rejected, response }: TestEmailResult): string {
  const refused = rejected.length === 0 ? '' : ` It refused ${rejected.join(', ')}.`;
  return `Test email sent to ${accepted.join(', ')}.${refused} The relay answered: ${response}`;
}
