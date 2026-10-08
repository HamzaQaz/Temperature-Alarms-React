import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { localMonth } from '../src/localDay';
import { monthlyReportEmail, warmFromF, type MonthlyReport, type ReportCloset, type ReportIncident } from '../src/monthlyReportEmail';

const SETTINGS = { publicUrl: 'https://alarms.district.example', timeZone: 'America/Chicago' };

/** September 2026 in Chicago (CDT, UTC-5): 2026-09-01T05:00Z up to 2026-10-01T05:00Z. */
const SEPTEMBER = localMonth('2026-09', 'America/Chicago')!;

const reading = (iso: string, tempF: number, humidity: number | null = 40) => ({ tempF, humidity, recordedAt: new Date(iso) });

function closet(id: number, closetName: string, campus: ReportCloset['device']['campus'], readings: Partial<ReportCloset> = {}): ReportCloset {
  return {
    device: { id, hostname: `ESP_${String(id).padStart(6, '0')}`, closet: closetName, campus },
    hotWarningF: 82,
    readings: 0,
    warmReadings: 0,
    hottest: null,
    mostHumid: null,
    ...readings,
  };
}

const CHS = { name: 'Central High School', shortcode: 'CHS' };
const NHS = { name: 'North High School', shortcode: 'NHS' };

const incident = (deviceId: number, condition: ReportIncident['condition'], start: string, end: string | null): ReportIncident => ({
  deviceId,
  condition,
  start: new Date(start),
  end: end === null ? null : new Date(end),
});

/** A fixed month: four closets at two Campuses, and incidents including one from before the month and one still going at its end. */
const FIXED: MonthlyReport = {
  month: SEPTEMBER,
  closets: [
    closet(12, 'IDF 2', CHS, {
      readings: 86_000,
      warmReadings: 60_000,
      hottest: reading('2026-09-15T20:05:00Z', 91),
      mostHumid: reading('2026-09-03T15:00:00Z', 80, 55),
    }),
    // Exactly half its Readings warm: not most of the month.
    closet(13, 'MDF', CHS, { readings: 86_000, warmReadings: 43_000, hottest: reading('2026-09-10T18:00:00Z', 88), mostHumid: reading('2026-09-12T18:00:00Z', 76, 62) }),
    // Its most humid Reading is 11:30 PM on the 29th in Chicago, the 30th in UTC.
    closet(20, 'IDF 1', NHS, { readings: 80_000, warmReadings: 0, hottest: reading('2026-09-02T21:00:00Z', 75), mostHumid: reading('2026-09-30T04:30:00Z', 70, 78) }),
    closet(21, 'IDF 3', NHS),
  ],
  incidents: [
    // Began on August 31 in Chicago: an hour of it falls in September.
    incident(12, 'Hot', '2026-08-31T23:00:00Z', '2026-09-01T06:00:00Z'),
    incident(12, 'Hot', '2026-09-15T19:00:00Z', '2026-09-15T21:00:00Z'),
    incident(20, 'Sensor fault', '2026-09-05T12:00:00Z', '2026-09-05T14:00:00Z'),
    incident(21, 'Offline', '2026-09-20T10:00:00Z', '2026-09-20T16:05:00Z'),
    // Still going: counted to the month's end, a day.
    incident(21, 'Offline', '2026-09-30T05:00:00Z', null),
    // A Device the report does not cover (the Bench): left out everywhere.
    incident(99, 'Offline', '2026-09-08T00:00:00Z', '2026-09-09T00:00:00Z'),
  ],
};

/** The lines of the text part from `heading` to the next blank line. */
function section(text: string, heading: string): string[] {
  const lines = text.split('\n');
  const start = lines.indexOf(heading);
  assert.notEqual(start, -1, `no "${heading}" section in:\n${text}`);
  const end = lines.indexOf('', start);
  return lines.slice(start + 1, end);
}

describe('monthlyReportEmail (the report on one month)', () => {
  const email = monthlyReportEmail(FIXED, SETTINGS);

  test('the subject names the month and counts its incidents and the closets that ran warm', () => {
    assert.equal(email.subject, '[Temperature Alarms] Monthly report, September 2026: 5 incidents, 1 closet ran warm');
    assert.match(email.text, /^Monthly report for September 2026: 4 closets at 2 Campuses\.\n/);
  });

  test('incidents are counted with their time in each Condition, clipped to the month, in the order of CONTEXT.md', () => {
    assert.deepEqual(section(email.text, 'Incidents'), [
      '5 incidents in September 2026, by Condition:',
      'Hot: 2 incidents, 3 h in all',
      'Sensor fault: 1 incident, 2 h in all',
      'Offline: 2 incidents, 1 d 6 h in all',
    ]);
  });

  test('the hottest and most humid closets with their peaks, each linked to its History on the day of the peak, in the server zone', () => {
    assert.deepEqual(section(email.text, 'Hottest closets'), [
      "Each closet's hottest Reading, hottest first:",
      'Central High School (CHS), IDF 2: 91 °F at Tue, Sep 15, 3:05 PM CDT',
      'History: https://alarms.district.example/history/12?date=2026-09-15',
      'Central High School (CHS), MDF: 88 °F at Thu, Sep 10, 1:00 PM CDT',
      'History: https://alarms.district.example/history/13?date=2026-09-10',
      'North High School (NHS), IDF 1: 75 °F at Wed, Sep 2, 4:00 PM CDT',
      'History: https://alarms.district.example/history/20?date=2026-09-02',
    ]);
    assert.deepEqual(section(email.text, 'Most humid closets'), [
      "Each closet's most humid Reading, most humid first:",
      'North High School (NHS), IDF 1: 78% at Tue, Sep 29, 11:30 PM CDT',
      'History: https://alarms.district.example/history/20?date=2026-09-29',
      'Central High School (CHS), MDF: 62% at Sat, Sep 12, 1:00 PM CDT',
      'History: https://alarms.district.example/history/13?date=2026-09-12',
      'Central High School (CHS), IDF 2: 55% at Thu, Sep 3, 10:00 AM CDT',
      'History: https://alarms.district.example/history/12?date=2026-09-03',
    ]);
  });

  test('a closet ran warm with more than half its Readings within 3 °F of its own Hot warning; exactly half is not most', () => {
    assert.equal(warmFromF(82), 79);
    assert.deepEqual(section(email.text, 'Ran warm most of the month'), [
      'Closets with more than half their Readings within 3 °F of their Hot warning, or above it:',
      'Central High School (CHS), IDF 2: 70% of its Readings at 79 °F or above (60,000 of 86,000)',
      'History: https://alarms.district.example/history/12?date=2026-09-15',
    ]);
    // Judged by its own threshold, not the other closets': at a Hot warning of 70 its line moves.
    const cooler = monthlyReportEmail({ ...FIXED, closets: FIXED.closets.map((c) => (c.device.id === 12 ? { ...c, hotWarningF: 70 } : c)) }, SETTINGS);
    assert.match(cooler.text, /IDF 2: 70% of its Readings at 67 °F or above/);
  });

  test("each Device's Offline and Sensor fault time, the longest first, linked to the day its first stretch began", () => {
    assert.deepEqual(section(email.text, 'Offline and Sensor fault time'), [
      'Time each Device went unwatched, the longest first:',
      'North High School (NHS), IDF 3, ESP_000021: Offline 1 d 6 h (2 incidents)',
      'History: https://alarms.district.example/history/21?date=2026-09-20',
      'North High School (NHS), IDF 1, ESP_000020: Sensor fault 2 h (1 incident)',
      'History: https://alarms.district.example/history/20?date=2026-09-05',
    ]);
    assert.doesNotMatch(email.text, /ESP_000099|history\/99/, 'a Device the report does not cover is left out');
  });

  test('the footer names the dashboard and the zone', () => {
    assert.match(email.text, /\n--\nSent by Temperature Alarms \(https:\/\/alarms\.district\.example\)\. Times are America\/Chicago\.\n$/);
  });

  test('the HTML part links each closet to its History, and escapes what it shows', () => {
    assert.match(email.html ?? '', /<a href="https:\/\/alarms\.district\.example\/history\/12\?date=2026-09-15">Central High School \(CHS\), IDF 2<\/a>: 91 °F at Tue, Sep 15, 3:05 PM CDT/);
    assert.match(email.html ?? '', /<h2 [^>]*>Ran warm most of the month<\/h2>/);
    const [first] = FIXED.closets;
    const odd = monthlyReportEmail({ ...FIXED, closets: [{ ...first, device: { ...first.device, closet: 'IDF <2>', campus: { name: 'A&M "Annex"', shortcode: 'AM' } } }] }, SETTINGS);
    assert.match(odd.html ?? '', /A&amp;M &quot;Annex&quot; \(AM\), IDF &lt;2&gt;<\/a>/);
    assert.doesNotMatch(odd.html ?? '', /IDF <2>/);
  });

  test('the peak lists name five closets, the earlier peak first on a tie', () => {
    const closets = [1, 2, 3, 4, 5, 6, 7].map((id) =>
      closet(id, `IDF ${id}`, CHS, { readings: 10, hottest: reading(`2026-09-${String(10 + id).padStart(2, '0')}T15:00:00Z`, id === 7 ? 86 : 80 + id) }),
    );
    const hottest = section(monthlyReportEmail({ month: SEPTEMBER, closets, incidents: [] }, SETTINGS).text, 'Hottest closets').filter((line) => !line.startsWith('History'));
    assert.deepEqual(hottest.slice(1).map((line) => line.split(':')[0]), [
      'Central High School (CHS), IDF 6',
      'Central High School (CHS), IDF 7',
      'Central High School (CHS), IDF 5',
      'Central High School (CHS), IDF 4',
      'Central High School (CHS), IDF 3',
    ]);
  });

  test('a quiet month says so in every section', () => {
    const quiet = monthlyReportEmail({ month: SEPTEMBER, closets: [closet(21, 'IDF 3', NHS)], incidents: [] }, SETTINGS);
    assert.equal(quiet.subject, '[Temperature Alarms] Monthly report, September 2026: no incidents, no closet ran warm');
    assert.match(quiet.text, /^Monthly report for September 2026: 1 closet at 1 Campus\./);
    assert.deepEqual(section(quiet.text, 'Incidents'), ['No incidents in September 2026.']);
    assert.deepEqual(section(quiet.text, 'Hottest closets'), ['No Readings in September 2026.']);
    assert.deepEqual(section(quiet.text, 'Most humid closets'), ['No humidity Readings in September 2026.']);
    assert.deepEqual(section(quiet.text, 'Ran warm most of the month'), [
      'No closet ran warm most of the month (more than half its Readings within 3 °F of its Hot warning, or above it).',
    ]);
    assert.deepEqual(section(quiet.text, 'Offline and Sensor fault time'), ['No Device was Offline or in Sensor fault.']);
  });
});
