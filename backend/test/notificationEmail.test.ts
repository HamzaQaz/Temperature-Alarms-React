import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { duration, notificationEmail, openFor, type QueuedNotification } from '../src/notificationEmail';
import type { NotificationKind } from '../src/outbox';

const SETTINGS = { publicUrl: 'https://alarms.district.example', timeZone: 'America/Chicago' };

/** 2026-10-06 21:05 in Chicago (CDT, UTC-5): the next day in UTC, so the History day shows the zone is used. */
const START = new Date('2026-10-07T02:05:00Z');
const at = (minutes: number) => new Date(START.getTime() + minutes * 60_000);

let nextId = 1;

/** A due notification for a fresh incident, Hot critical in CHS IDF 2 unless overridden. */
function row(kind: NotificationKind, incident: Partial<QueuedNotification['incident']> = {}, device: Partial<QueuedNotification['device']> = {}): QueuedNotification {
  return {
    kind,
    queuedAt: at(10),
    incident: { id: nextId++, condition: 'Hot', level: 'critical', start: START, end: null, peak: { tempF: 91, humidity: 45, recordedAt: at(10) }, acknowledgement: null, ...incident },
    device: { id: 12, hostname: 'ESP_A1B2C3', closet: 'IDF 2', campus: { name: 'Central High School', shortcode: 'CHS' }, ...device },
  };
}

/** The same incident's later notification. */
const also = (first: QueuedNotification, kind: NotificationKind, incident: Partial<QueuedNotification['incident']> = {}): QueuedNotification => ({
  ...first,
  kind,
  incident: { ...first.incident, ...incident },
});

/** A reminder for a fresh incident, queued `hours` after its start. */
const reminder = (hours: number, incident: Partial<QueuedNotification['incident']> = {}, device: Partial<QueuedNotification['device']> = {}): QueuedNotification => ({
  ...row('reminder', incident, device),
  queuedAt: at(hours * 60),
});

const offline = (kind: NotificationKind, closet: string) =>
  row(kind, { condition: 'Offline', level: 'warning', peak: { tempF: 71, humidity: 44, recordedAt: at(-2) } }, { closet });

describe('notificationEmail (the email for one batch)', () => {
  test('one incident names the closet, Condition, level, and peak in the subject', () => {
    assert.equal(notificationEmail([row('opened')], SETTINGS).subject, '[Temperature Alarms] CHS IDF 2: Hot critical (91 °F)');
  });

  test('a level rising, a close, and an open and close in one batch each say so in the subject', () => {
    assert.equal(notificationEmail([row('worse')], SETTINGS).subject, '[Temperature Alarms] CHS IDF 2: Hot critical, got worse (91 °F)');
    assert.equal(notificationEmail([row('closed', { end: at(35) })], SETTINGS).subject, '[Temperature Alarms] CHS IDF 2: Hot critical, resolved (91 °F)');
    const first = row('opened');
    assert.equal(
      notificationEmail([first, also(first, 'worse'), also(first, 'closed', { end: at(35) })], SETTINGS).subject,
      '[Temperature Alarms] CHS IDF 2: Hot critical, opened and resolved (91 °F)',
    );
  });

  test('several incidents are a digest counting each Condition, most first', () => {
    const email = notificationEmail([offline('opened', 'IDF 1'), row('opened', { level: 'warning', peak: { tempF: 86, humidity: 40, recordedAt: at(1) } }), offline('opened', 'IDF 3')], SETTINGS);
    assert.equal(email.subject, '[Temperature Alarms] 3 incidents: 2 Offline, 1 Hot');
    assert.match(email.text, /^3 incidents, worst first\./);
  });

  test('a digest says how many of its incidents already ended', () => {
    const some = notificationEmail([offline('opened', 'IDF 1'), offline('closed', 'IDF 3')], SETTINGS);
    assert.equal(some.subject, '[Temperature Alarms] 2 incidents: 2 Offline (1 resolved)');
    const all = notificationEmail([offline('closed', 'IDF 1'), offline('closed', 'IDF 3')], SETTINGS);
    assert.equal(all.subject, '[Temperature Alarms] 2 incidents: 2 Offline (all resolved)');
  });

  test('entries go worst first, then oldest first', () => {
    const email = notificationEmail(
      [
        offline('opened', 'IDF 1'),
        row('opened', { condition: 'Dry', level: 'warning', start: at(-30), peak: { tempF: 70, humidity: 18, recordedAt: at(-30) } }, { closet: 'MDF' }),
        row('opened', {}, { closet: 'IDF 9' }),
      ],
      SETTINGS,
    );
    const headings = email.text.split('\n').filter((line) => /: (opened|got worse|resolved)/.test(line));
    assert.deepEqual(headings, ['Hot critical: opened', 'Dry warning: opened', 'Offline: opened (the server has not heard from the board)']);
  });

  test('an incident opened and closed in one batch is listed once, with its end and how long it lasted', () => {
    const first = row('opened');
    const email = notificationEmail([first, also(first, 'closed', { end: at(65) })], SETTINGS);
    assert.equal(email.text.match(/^Hot critical/gm)?.length, 1);
    assert.match(email.text, /^Hot critical: opened and resolved$/m);
    assert.match(email.text, /^Ended: Tue, Oct 6, 10:10 PM CDT, after 1 h 5 min$/m);
  });

  test('each entry gives Campus, Closet, Device, the start in the server\'s zone, the peak Reading, and a History link for that day', () => {
    const email = notificationEmail([row('opened')], SETTINGS);
    assert.deepEqual(email.text.split('\n').slice(0, 5), [
      'Hot critical: opened',
      'Central High School (CHS), IDF 2, ESP_A1B2C3',
      'Started: Tue, Oct 6, 9:05 PM CDT',
      'Peak Reading: 91 °F, 45% at Tue, Oct 6, 9:15 PM CDT',
      'History: https://alarms.district.example/history/12?date=2026-10-06',
    ]);
    assert.doesNotMatch(email.text, /Ended:/, 'still open, so no end');
    assert.match(email.text, /Times are America\/Chicago\./);
  });

  test('°F to one decimal and humidity as a whole percent; Dry and Mold risk peak in percent', () => {
    const warm = notificationEmail([row('opened', { peak: { tempF: 91.46, humidity: 44.6, recordedAt: at(1) } })], SETTINGS);
    assert.equal(warm.subject, '[Temperature Alarms] CHS IDF 2: Hot critical (91.5 °F)');
    assert.match(warm.text, /Peak Reading: 91\.5 °F, 45% at/);
    const dry = notificationEmail([row('opened', { condition: 'Dry', level: 'warning', peak: { tempF: 70, humidity: 18, recordedAt: at(1) } })], SETTINGS);
    assert.equal(dry.subject, '[Temperature Alarms] CHS IDF 2: Dry warning (18%)');
    const mold = notificationEmail([row('opened', { condition: 'Mold risk', level: 'high', peak: { tempF: 74, humidity: 81, recordedAt: at(1) } })], SETTINGS);
    assert.equal(mold.subject, '[Temperature Alarms] CHS IDF 2: Mold risk high (81%)');
  });

  test('Offline reports the last Reading before the silence; Sensor fault the last good one, and what it means', () => {
    const silent = notificationEmail([offline('opened', 'IDF 2')], SETTINGS);
    assert.equal(silent.subject, '[Temperature Alarms] CHS IDF 2: Offline');
    assert.match(silent.text, /^Last Reading before the silence: 71 °F, 44% at Tue, Oct 6, 9:03 PM CDT$/m);

    const fault = notificationEmail([row('opened', { condition: 'Sensor fault', peak: { tempF: 72, humidity: 40, recordedAt: at(-1) } })], SETTINGS);
    assert.equal(fault.subject, '[Temperature Alarms] CHS IDF 2: Sensor fault');
    assert.match(fault.text, /^Sensor fault: opened \(the board is online but its sensor is not answering\)$/m);
    assert.match(fault.text, /^Last good Reading: 72 °F, 40% at /m);
  });

  test('the HTML part escapes everything and loads nothing: no images, no tracking, one link per entry', () => {
    const email = notificationEmail([row('opened', {}, { closet: 'IDF <2> & "B"', campus: { name: "St. Mary's <script>", shortcode: 'SM' } })], SETTINGS);
    assert.ok(email.html !== undefined);
    assert.match(email.html, /IDF &lt;2&gt; &amp; &quot;B&quot;/);
    assert.match(email.html, /St\. Mary&#39;s &lt;script&gt;/);
    assert.doesNotMatch(email.html, /<script|<img|src=|url\(/i);
    assert.deepEqual(email.html.match(/href="[^"]*"/g), ['href="https://alarms.district.example/history/12?date=2026-10-06"']);
    assert.match(email.text, /IDF <2> & "B"/, 'the plain text is left as it is');
  });

  test('an acknowledged incident names who acknowledged it and when, in both parts, escaped in the HTML', () => {
    const acknowledgement = { by: 'Sam <on site>', at: at(15) };
    const worse = notificationEmail([row('worse', { acknowledgement })], SETTINGS);
    assert.deepEqual(worse.text.split('\n').slice(0, 4), [
      'Hot critical: got worse',
      'Central High School (CHS), IDF 2, ESP_A1B2C3',
      'Started: Tue, Oct 6, 9:05 PM CDT',
      'Acknowledged by Sam <on site> at Tue, Oct 6, 9:20 PM CDT',
    ]);
    assert.match(worse.html ?? '', /Acknowledged by Sam &lt;on site&gt; at Tue, Oct 6, 9:20 PM CDT/);
    assert.equal(worse.subject, '[Temperature Alarms] CHS IDF 2: Hot critical, got worse (91 °F)', 'the subject is unchanged');

    const closed = notificationEmail([row('closed', { end: at(65), acknowledgement })], SETTINGS);
    assert.match(closed.text, /^Ended: .*\nAcknowledged by Sam <on site> at /m, 'after the end, once resolved');
    assert.doesNotMatch(notificationEmail([row('opened')], SETTINGS).text, /Acknowledged/, 'nothing when nobody has');
  });

  test('a reminder says the incident is still open and for how long, in whole hours', () => {
    const email = notificationEmail([reminder(6)], SETTINGS);
    assert.equal(email.subject, '[Temperature Alarms] Still open: CHS IDF 2 Hot critical, 6 h');
    assert.deepEqual(email.text.split('\n').slice(0, 5), [
      'Hot critical: still open after 6 h',
      'Central High School (CHS), IDF 2, ESP_A1B2C3',
      'Started: Tue, Oct 6, 9:05 PM CDT',
      'Not acknowledged yet: acknowledging it on the Dashboard stops these reminders',
      'Peak Reading: 91 °F, 45% at Tue, Oct 6, 9:15 PM CDT',
    ]);
    assert.match(email.html ?? '', /Hot critical: still open after 6 h/);
    // Queued up to a sweep late, or after the server was down: the hours it has reached.
    assert.equal(notificationEmail([{ ...reminder(4), queuedAt: at(4 * 60 + 1) }], SETTINGS).subject, '[Temperature Alarms] Still open: CHS IDF 2 Hot critical, 4 h');
    const silent = notificationEmail([reminder(52, { condition: 'Offline', level: 'warning' })], SETTINGS);
    assert.equal(silent.subject, '[Temperature Alarms] Still open: CHS IDF 2 Offline, 2 d 4 h');
    assert.match(silent.text, /^Offline: still open after 2 d 4 h \(the server has not heard from the board\)$/m);
  });

  test('reminders coalesce with everything else: a digest says how many are still open', () => {
    const mixed = notificationEmail([reminder(4, {}, { closet: 'IDF 1' }), offline('opened', 'IDF 3'), offline('closed', 'IDF 4')], SETTINGS);
    assert.equal(mixed.subject, '[Temperature Alarms] 3 incidents: 2 Offline, 1 Hot (1 resolved, 1 still open)');
    assert.match(mixed.text, /^Hot critical: still open after 4 h$/m);
    const all = notificationEmail([reminder(4, {}, { closet: 'IDF 1' }), reminder(8, { condition: 'Offline', level: 'warning' }, { closet: 'IDF 3' })], SETTINGS);
    assert.equal(all.subject, '[Temperature Alarms] 2 incidents: 1 Hot, 1 Offline (all still open)');
  });

  test('a reminder in the same batch as other news about its incident gives way to it', () => {
    const first = reminder(4);
    assert.equal(notificationEmail([first, also(first, 'worse')], SETTINGS).subject, '[Temperature Alarms] CHS IDF 2: Hot critical, got worse (91 °F)');
    assert.equal(notificationEmail([first, also(first, 'closed', { end: at(250) })], SETTINGS).subject, '[Temperature Alarms] CHS IDF 2: Hot critical, resolved (91 °F)');
  });

  test('how long a reminder says it has been open: whole hours, then days', () => {
    assert.equal(openFor(4 * 3_600_000 + 59 * 60_000), '4 h');
    assert.equal(openFor(24 * 3_600_000), '1 d');
    assert.equal(openFor(27 * 3_600_000), '1 d 3 h');
    assert.equal(openFor(30 * 60_000), '30 min', 'under an hour, as a duration');
  });

  test('durations read in minutes, hours, and days', () => {
    assert.equal(duration(20_000), 'under a minute');
    assert.equal(duration(35 * 60_000), '35 min');
    assert.equal(duration(120 * 60_000), '2 h');
    assert.equal(duration(125 * 60_000), '2 h 5 min');
    assert.equal(duration((3 * 24 + 4) * 3_600_000), '3 d 4 h');
  });
});
