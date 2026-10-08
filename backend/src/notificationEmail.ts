/**
 * What an Incident email says (docs/adr/0008): the notifications due in one batch, with their
 * Incident and Device, turned into a subject, plain text, and a simple HTML part. One incident
 * names the closet in the subject; several are a digest, worst first. Readable on a phone: no
 * images, no tracking, nothing loaded from anywhere.
 *
 * A pure function: no I/O, no clock. The time zone and the dashboard's address are handed in.
 */
import type { ConditionLevel, ConditionName } from './conditions';
import { peakValue, type TimedReading } from './incidents';
import { todayIn } from './localDay';
import type { Email } from './mailer';
import { worstFirst, type NotificationKind } from './outbox';

/** One due notification, with its Incident and Device as they stand when the batch is sent. */
export interface QueuedNotification {
  kind: NotificationKind;
  /** When it was queued: for a reminder, how long the incident had been open is counted to here. */
  queuedAt: Date;
  incident: {
    id: number;
    condition: ConditionName;
    /** The worst level it has reached. */
    level: ConditionLevel;
    start: Date;
    end: Date | null;
    /** The worst Reading; for Offline and Sensor fault, the last good Reading before it. */
    peak: TimedReading;
    /** Who said they are on it, and when; null until someone does. Never cleared, so later emails name it. */
    acknowledgement: { by: string; at: Date } | null;
  };
  device: {
    id: number;
    hostname: string;
    closet: string;
    campus: { name: string; shortcode: string };
  };
}

export interface EmailSettings {
  /** The dashboard's address, without a trailing slash (PUBLIC_URL). */
  publicUrl: string;
  /** The zone times are written in: the server's own. */
  timeZone: string;
}

/**
 * What happened to an incident within one batch. Opened and closed together is listed once; a
 * reminder alongside any other news gives way to it.
 */
type EntryStatus = 'opened' | 'got worse' | 'resolved' | 'opened and resolved' | 'still open';

interface Entry {
  status: EntryStatus;
  /** When its latest notification in the batch was queued. */
  queuedAt: Date;
  incident: QueuedNotification['incident'];
  device: QueuedNotification['device'];
}

const SUBJECT_PREFIX = '[Temperature Alarms]';

/** Offline and Sensor fault have one level each, so it goes unsaid. */
const SINGLE_LEVEL: ReadonlySet<ConditionName> = new Set(['Offline', 'Sensor fault']);

/** What a Condition means, where its name alone does not say (CONTEXT.md). */
const MEANING: Partial<Record<ConditionName, string>> = {
  Offline: 'the server has not heard from the board',
  'Sensor fault': 'the board is online but its sensor is not answering',
};

/** What the peak line calls the Reading it shows. */
const PEAK_LABEL: Partial<Record<ConditionName, string>> = {
  Offline: 'Last Reading before the silence',
  'Sensor fault': 'Last good Reading',
};

const label = ({ condition, level }: Entry['incident']): string => (SINGLE_LEVEL.has(condition) ? condition : `${condition} ${level}`);

/** °F to one decimal, a whole number without its `.0`. */
const degrees = (tempF: number): string => `${Number.isInteger(Math.round(tempF * 10) / 10) ? Math.round(tempF) : tempF.toFixed(1)} °F`;

/** Humidity as a whole percent. */
const percent = (humidity: number): string => `${Math.round(humidity)}%`;

/** The peak in the unit its Condition is judged by, for the subject; null for Offline and Sensor fault. */
function peakFigure({ condition, peak }: Entry['incident']): string | null {
  const value = peakValue(condition, peak);
  if (value === null) return null;
  return condition === 'Hot' || condition === 'Cold' ? degrees(value) : percent(value);
}

const readingText = ({ tempF, humidity }: TimedReading): string => (humidity === null ? degrees(tempF) : `${degrees(tempF)}, ${percent(humidity)}`);

const formatters = new Map<string, Intl.DateTimeFormat>();

/** "Tue, Oct 6, 2:05 PM CDT" in the zone. */
function when(at: Date, timeZone: string): string {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
    formatters.set(timeZone, formatter);
  }
  // Newer ICU puts a narrow no-break space before AM and PM; a plain one reads the same in any mail client.
  return formatter.format(at).replace(/ /g, ' ');
}

/** "35 min", "2 h 5 min", "3 d 4 h". */
export function duration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
  const days = Math.floor(hours / 24);
  return hours % 24 === 0 ? `${days} d` : `${days} d ${hours % 24} h`;
}

/**
 * How long a still-open incident has been open, in whole hours, as a reminder says it: "6 h",
 * "1 d", "2 d 3 h". Reminders come a whole number of hours apart, so minutes would only be noise.
 */
export function openFor(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return duration(ms);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  return hours % 24 === 0 ? `${days} d` : `${days} d ${hours % 24} h`;
}

function statusOf(kinds: Set<NotificationKind>): EntryStatus {
  if (kinds.has('closed')) return kinds.has('opened') ? 'opened and resolved' : 'resolved';
  if (kinds.has('opened')) return 'opened';
  if (kinds.has('worse')) return 'got worse';
  return 'still open';
}

/** One entry per incident, worst first, then oldest first. The last row of an incident says how it stands. */
function entriesOf(rows: QueuedNotification[]): Entry[] {
  const byIncident = new Map<number, { kinds: Set<NotificationKind>; row: QueuedNotification }>();
  for (const row of rows) {
    const seen = byIncident.get(row.incident.id);
    byIncident.set(row.incident.id, { kinds: new Set([...(seen?.kinds ?? []), row.kind]), row });
  }
  const entries = [...byIncident.values()].map(
    ({ kinds, row }): Entry => ({ status: statusOf(kinds), queuedAt: row.queuedAt, incident: row.incident, device: row.device }),
  );
  return entries.sort(
    (a, b) => worstFirst(a.incident.level, b.incident.level) || a.incident.start.getTime() - b.incident.start.getTime() || a.incident.id - b.incident.id,
  );
}

const isResolved = (entry: Entry): boolean => entry.status === 'resolved' || entry.status === 'opened and resolved';

/** "still open after 6 h": the status as an entry's heading gives it. */
const statusText = (entry: Entry): string =>
  entry.status === 'still open' ? `still open after ${openFor(entry.queuedAt.getTime() - entry.incident.start.getTime())}` : entry.status;

function subjectOf(entries: Entry[]): string {
  if (entries.length === 1) {
    const [entry] = entries;
    if (entry.status === 'still open') {
      const open = openFor(entry.queuedAt.getTime() - entry.incident.start.getTime());
      return `${SUBJECT_PREFIX} Still open: ${entry.device.campus.shortcode} ${entry.device.closet} ${label(entry.incident)}, ${open}`;
    }
    const figure = peakFigure(entry.incident);
    const status = entry.status === 'opened' ? '' : `, ${entry.status}`;
    return `${SUBJECT_PREFIX} ${entry.device.campus.shortcode} ${entry.device.closet}: ${label(entry.incident)}${status}${figure === null ? '' : ` (${figure})`}`;
  }
  // Each Condition once with how many, most first; a tie keeps the order of its worst entry.
  const counts = new Map<ConditionName, number>();
  for (const { incident } of entries) counts.set(incident.condition, (counts.get(incident.condition) ?? 0) + 1);
  const byCount = [...counts].sort((a, b) => b[1] - a[1]).map(([condition, n]) => `${n} ${condition}`);
  const share = (n: number, what: string): string | null => (n === 0 ? null : n === entries.length ? `all ${what}` : `${n} ${what}`);
  const notes = [share(entries.filter(isResolved).length, 'resolved'), share(entries.filter((e) => e.status === 'still open').length, 'still open')].filter(
    (note): note is string => note !== null,
  );
  const suffix = notes.length === 0 ? '' : ` (${notes.join(', ')})`;
  return `${SUBJECT_PREFIX} ${entries.length} incidents: ${byCount.join(', ')}${suffix}`;
}

/** An entry's lines, label first, as both parts show them. */
interface EntryLines {
  heading: string;
  details: string[];
  history: { url: string; text: string };
}

function linesOf(entry: Entry, { publicUrl, timeZone }: EmailSettings): EntryLines {
  const { incident, device } = entry;
  const meaning = MEANING[incident.condition];
  const details = [
    `${device.campus.name} (${device.campus.shortcode}), ${device.closet}, ${device.hostname}`,
    `Started: ${when(incident.start, timeZone)}`,
  ];
  // The end is news only in the email that says it ended.
  if (isResolved(entry) && incident.end !== null) {
    details.push(`Ended: ${when(incident.end, timeZone)}, after ${duration(incident.end.getTime() - incident.start.getTime())}`);
  }
  // Someone is on it: the email says who, so a got-worse or resolved email does not send a second person.
  if (incident.acknowledgement !== null) {
    details.push(`Acknowledged by ${incident.acknowledgement.by} at ${when(incident.acknowledgement.at, timeZone)}`);
  } else if (entry.status === 'still open') {
    // A reminder goes only to an incident no one has acknowledged; saying how to stop them is the point.
    details.push('Not acknowledged yet: acknowledging it on the Dashboard stops these reminders');
  }
  details.push(`${PEAK_LABEL[incident.condition] ?? 'Peak Reading'}: ${readingText(incident.peak)} at ${when(incident.peak.recordedAt, timeZone)}`);
  const day = todayIn(incident.start, timeZone);
  return {
    heading: `${label(incident)}: ${statusText(entry)}${meaning === undefined ? '' : ` (${meaning})`}`,
    details,
    history: { url: `${publicUrl}/history/${device.id}?date=${day}`, text: `History for ${device.closet}, ${day}` },
  };
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * The email for one batch of due notifications: a subject naming the closet for one incident,
 * or counting by Condition for several; then each incident, worst first, with its Campus,
 * Closet, Device, Condition and level (and, for a reminder, how long it has been open), start
 * (and end, with how long), who acknowledged it, peak Reading, and a link to that Device's
 * History on the day it started. `rows` holds at least one notification.
 */
export function notificationEmail(rows: QueuedNotification[], settings: EmailSettings): Email {
  const entries = entriesOf(rows);
  const blocks = entries.map((entry) => linesOf(entry, settings));
  const intro = entries.length === 1 ? null : `${entries.length} incidents, worst first.`;
  const footer = `Sent by Temperature Alarms (${settings.publicUrl}). Times are ${settings.timeZone}.`;

  const text = [
    ...(intro === null ? [] : [intro, '']),
    ...blocks.flatMap(({ heading, details, history }) => [heading, ...details, `History: ${history.url}`, '']),
    '--',
    footer,
    '',
  ].join('\n');

  const html = [
    '<!doctype html>',
    '<html><body style="font-family: Arial, Helvetica, sans-serif; font-size: 15px; line-height: 1.4; color: #1a1a1a;">',
    ...(intro === null ? [] : [`<p>${escapeHtml(intro)}</p>`]),
    ...blocks.map(
      ({ heading, details, history }) =>
        `<p style="margin: 0 0 16px;"><strong>${escapeHtml(heading)}</strong><br>${details.map(escapeHtml).join('<br>')}<br>` +
        `<a href="${escapeHtml(history.url)}">${escapeHtml(history.text)}</a></p>`,
    ),
    `<p style="margin: 24px 0 0; font-size: 13px; color: #555;">${escapeHtml(footer)}</p>`,
    '</body></html>',
  ].join('\n');

  return { subject: subjectOf(entries), text, html };
}
