import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { durationOf, formatDuration, latestDate, overlaps, parseWindowKind, spanLayout, ticks, windowBounds, worstIncident } from './incidentWindow.ts';

const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

describe('windows', () => {
  it('reads the window from the URL, Overnight when absent or unknown', () => {
    assert.equal(parseWindowKind(null), 'overnight');
    assert.equal(parseWindowKind('nonsense'), 'overnight');
    assert.equal(parseWindowKind('today'), 'today');
    assert.equal(parseWindowKind('week'), 'week');
  });

  it('names the night by its evening: before 18:00 the latest night began yesterday', () => {
    assert.equal(latestDate('overnight', local(2026, 10, 4, 7, 12)), '2026-10-03');
    assert.equal(latestDate('overnight', local(2026, 10, 4, 17, 59)), '2026-10-03');
    assert.equal(latestDate('overnight', local(2026, 10, 4, 18, 0)), '2026-10-04');
    assert.equal(latestDate('today', local(2026, 10, 4, 7)), '2026-10-04');
    assert.equal(latestDate('week', local(2026, 10, 4, 7)), '2026-10-04');
  });

  it('runs a night from 18:00 to 08:00, a day midnight to midnight, a week over its last seven days', () => {
    assert.deepEqual(windowBounds('overnight', '2026-10-03'), { from: local(2026, 10, 3, 18), to: local(2026, 10, 4, 8) });
    assert.deepEqual(windowBounds('today', '2026-10-04'), { from: local(2026, 10, 4), to: local(2026, 10, 5) });
    assert.deepEqual(windowBounds('week', '2026-10-04'), { from: local(2026, 9, 28), to: local(2026, 10, 5) });
  });

  it('marks a night every two hours from 18:00, with a line on all but the first', () => {
    const marks = ticks('overnight', '2026-10-03');
    assert.equal(marks.length, 7);
    assert.equal(marks[0].at, local(2026, 10, 3, 18).getTime());
    assert.equal(marks[0].line, false);
    assert.equal(marks[3].at, local(2026, 10, 4, 0).getTime());
    assert.deepEqual(marks.map((m) => m.major), [true, false, false, true, false, false, true]);
  });

  it('marks a week with a line at each midnight and the day name at noon', () => {
    const marks = ticks('week', '2026-10-04');
    assert.equal(marks.filter((m) => m.line).length, 6);
    assert.equal(marks.filter((m) => m.label).length, 7);
  });
});

describe('spans on the ruler', () => {
  const from = local(2026, 10, 3, 18).getTime();
  const to = local(2026, 10, 4, 8).getTime();
  const iso = (h: number, m = 0, d = 4) => local(2026, 10, d, h, m).toISOString();

  it('places an incident by its start and end, with each level as a share of the span', () => {
    const span = spanLayout(
      { start: iso(1, 0), end: iso(4, 0), segments: [{ level: 'warning', start: iso(1, 0), end: iso(2, 0) }, { level: 'critical', start: iso(2, 0), end: iso(4, 0) }] },
      from,
      to,
      to,
    );
    assert.ok(Math.abs(span.left - 7 / 14) < 1e-9);
    assert.ok(Math.abs(span.width - 3 / 14) < 1e-9);
    assert.equal(span.ongoing, false);
    assert.equal(span.cutStart, false);
    assert.deepEqual(span.pieces.map((p) => p.level), ['warning', 'critical']);
    assert.ok(Math.abs(span.pieces[1].left - 1 / 3) < 1e-9);
    assert.ok(Math.abs(span.pieces[1].width - 2 / 3) < 1e-9);
  });

  it('runs an ongoing incident to now, and cuts one that began before the window', () => {
    const now = local(2026, 10, 4, 7, 12).getTime();
    const span = spanLayout({ start: iso(17, 0, 3), end: null, segments: [{ level: 'warning', start: iso(17, 0, 3), end: null }] }, from, to, now);
    assert.equal(span.left, 0);
    assert.equal(span.cutStart, true);
    assert.equal(span.ongoing, true);
    assert.ok(Math.abs(span.left + span.width - (now - from) / (to - from)) < 1e-9);
  });

  it('counts an incident as in the window when any of it overlaps', () => {
    assert.equal(overlaps({ start: iso(17, 0, 3), end: iso(18, 30, 3) }, from, to, to), true);
    assert.equal(overlaps({ start: iso(9, 0), end: null }, from, to, to + 3_600_000), false);
    assert.equal(overlaps({ start: iso(12, 0, 3), end: iso(13, 0, 3) }, from, to, to), false);
  });
});

describe('durations and the worst incident', () => {
  it('says a duration in minutes, hours and days', () => {
    assert.equal(formatDuration(20_000), 'under 1 min');
    assert.equal(formatDuration(23 * 60_000), '23 min');
    assert.equal(formatDuration(85 * 60_000), '1 h 25 min');
    assert.equal(formatDuration(120 * 60_000), '2 h');
    assert.equal(formatDuration(27 * 3_600_000), '1 d 3 h');
  });

  it('picks the highest level the server recorded, and the longest of those', () => {
    const a = { level: 'warning' as const, start: '2026-10-04T01:00:00Z', end: '2026-10-04T05:00:00Z' };
    const b = { level: 'critical' as const, start: '2026-10-04T02:00:00Z', end: '2026-10-04T02:30:00Z' };
    const c = { level: 'critical' as const, start: '2026-10-04T03:00:00Z', end: null };
    const now = new Date('2026-10-04T04:00:00Z').getTime();
    assert.equal(worstIncident([a, b], now), b);
    assert.equal(worstIncident([a, b, c], now), c);
    assert.equal(durationOf(c, now), 3_600_000);
    assert.equal(worstIncident([], now), undefined);
  });
});
