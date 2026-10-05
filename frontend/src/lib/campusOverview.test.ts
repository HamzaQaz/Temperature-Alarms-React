import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CHART, chartLabel, chartLayout, formatGap, listNames, sinceLast, weekPeak } from './campusOverview.ts';
import { addDays } from './localDate.ts';
import type { OverviewDay } from '../types.ts';

const week = (highs: Array<number | null>, flagged: number[] = [], level: OverviewDay['incidentLevel'] = 'warning'): OverviewDay[] =>
  highs.map((maxTempF, i) => ({
    date: addDays('2026-09-28', i),
    from: '',
    to: '',
    partial: i === highs.length - 1,
    maxTempF,
    incident: flagged.includes(i),
    incidentLevel: flagged.includes(i) ? level : null,
  }));

describe('the 7-day chart', () => {
  it('puts a higher day higher, the line between, and draws no column on a day with no Readings', () => {
    const { columns, lineY } = chartLayout(week([78, 79, null, 81, 83, 88, 84]), 82);
    assert.equal(columns.length, 7);
    assert.equal(columns[2].y, null);
    assert.equal(columns[2].height, 0);
    const top = (i: number) => columns[i].y as number;
    assert.ok(top(5) < top(4) && top(4) < top(0));
    assert.ok(top(4) < lineY && lineY < top(3), 'the 82°F line sits between 81 and 83');
    assert.ok(columns.every((c) => c.y === null || (c.y >= 0 && c.y + c.height === CHART.plot)));
  });

  it('keeps the line on the plot when every day is far below it', () => {
    const { lineY, columns } = chartLayout(week([60, 61, 60, 62, 61, 60, 60]), 82);
    assert.ok(lineY >= 0 && lineY < CHART.plot);
    assert.ok(columns.every((c) => (c.y as number) > lineY));
  });

  it('says every day, the line, and the incident days in words', () => {
    const label = chartLabel(week([78, 79, 80, 81, 83, 88, 84], [4, 5, 6]), 82);
    assert.match(label, /^Daily high: \w+ 78°F,/);
    assert.match(label, /Today 84°F so far\./);
    assert.match(label, /Hot warning line at 82°F\./);
    assert.match(label, /An incident on \w+ \(warning\), \w+ \(warning\), Today \(warning\)\./);
    assert.match(chartLabel(week([90, 70, 70, 70, 70, 70, 70], [0], 'critical'), 82), /An incident on \w+ \(critical\)\./, 'the level the server sent, so a critical day is never read as warning');
    assert.match(chartLabel(week([70, null, 70, 70, 70, 70, 70]), 82), /no Readings.*No incident in the 7 days\./);
  });

  it('names the week\'s peak on the last day it was reached', () => {
    const days = week([80, 88, 70, 88, 70, 70, 70]);
    assert.deepEqual(weekPeak(days), { value: 88, day: days[3] });
    assert.equal(weekPeak(week([null, null, null, null, null, null, null])), null);
  });
});

describe('since last incident', () => {
  const now = new Date(2026, 9, 4, 14, 20).getTime();

  it('reads ongoing with its start, and links to today', () => {
    const since = sinceLast({ ongoing: true, start: new Date(2026, 9, 4, 12, 10).toISOString() }, now, 90);
    assert.equal(since.value, 'Ongoing');
    assert.equal(since.note, 'Since 12:10 PM');
    assert.equal(since.date, '2026-10-04');
  });

  it('reads the gap since an end, and links to the day it ended', () => {
    const since = sinceLast({ ongoing: false, end: new Date(2026, 9, 1, 16, 42).toISOString() }, now, 90);
    assert.equal(since.value, '2 days');
    assert.match(since.note, /^Ended .+, 4:42 PM$/);
    assert.equal(since.date, '2026-10-01');
  });

  it('reads just now for an end under a minute ago, never "0 min"', () => {
    for (const ago of [0, 20_000, 59_999]) assert.equal(sinceLast({ ongoing: false, end: new Date(now - ago).toISOString() }, now, 90).value, 'Just now');
    assert.equal(sinceLast({ ongoing: false, end: new Date(now - 60_000).toISOString() }, now, 90).value, '1 min');
    // A browser clock a little behind the server's must not read a future end as a gap.
    assert.equal(sinceLast({ ongoing: false, end: new Date(now + 5_000).toISOString() }, now, 90).value, 'Just now');
  });

  it('reads none in the retention window when there is no last incident', () => {
    assert.deepEqual(sinceLast(null, now, 90), { value: 'None in 90 days', note: 'As far back as Readings go', ongoing: false, date: null });
  });

  it('counts a gap in whole minutes, hours, then days', () => {
    assert.equal(formatGap(20_000), 'Under 1 min');
    assert.equal(formatGap(35 * 60_000), '35 min');
    assert.equal(formatGap(5.5 * 3_600_000), '5 h');
    assert.equal(formatGap(26 * 3_600_000), '1 day');
    assert.equal(formatGap(12 * 86_400_000), '12 days');
  });
});

describe('names in a sentence', () => {
  it('joins two with and, more with commas', () => {
    assert.equal(listNames(['A']), 'A');
    assert.equal(listNames(['A', 'B']), 'A and B');
    assert.equal(listNames(['A', 'B', 'C']), 'A, B, and C');
  });
});
