import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { dailyWindowText, parseDailyWindow, quietUntil, type QuietHours } from '../src/quietHours';

const CHICAGO = 'America/Chicago';
const at = (iso: string) => new Date(iso);
/** 18:00-07:00, as the ticket's example. */
const nights: QuietHours = { daily: { start: 18 * 60, end: 7 * 60 }, weekends: false };

describe('parseDailyWindow and dailyWindowText', () => {
  test('two 24-hour times, the end before the start for a window past midnight, written back the same', () => {
    assert.deepEqual(parseDailyWindow('18:00-07:00'), { start: 1080, end: 420 });
    assert.deepEqual(parseDailyWindow('00:00-23:59'), { start: 0, end: 1439 });
    assert.deepEqual(parseDailyWindow('12:30-13:15'), { start: 750, end: 795 });
    assert.equal(dailyWindowText({ start: 1080, end: 420 }), '18:00-07:00');
    assert.equal(dailyWindowText({ start: 750, end: 795 }), '12:30-13:15');
  });

  test('anything else is not a window, one that starts and ends at once included', () => {
    for (const raw of ['', '18:00', '18:00-18:00', '6:00-07:00', '18:00 - 07:00', '24:00-07:00', '18:60-07:00', '18:00-07:00-08:00', 'off', '18.00-07.00']) {
      assert.equal(parseDailyWindow(raw), undefined, raw);
    }
  });
});

describe('quietUntil', () => {
  test('inside a window past midnight it ends at the next morning; outside it, null', () => {
    // Wednesday 7 October 2026, UTC.
    assert.deepEqual(quietUntil(at('2026-10-07T23:00:00Z'), nights, 'UTC'), at('2026-10-08T07:00:00Z'));
    assert.deepEqual(quietUntil(at('2026-10-07T18:00:00Z'), nights, 'UTC'), at('2026-10-08T07:00:00Z'), 'from its first minute');
    assert.deepEqual(quietUntil(at('2026-10-08T03:00:00Z'), nights, 'UTC'), at('2026-10-08T07:00:00Z'), 'after midnight, the same morning');
    assert.deepEqual(quietUntil(at('2026-10-08T06:59:59Z'), nights, 'UTC'), at('2026-10-08T07:00:00Z'));
    assert.equal(quietUntil(at('2026-10-08T07:00:00Z'), nights, 'UTC'), null, 'over at its end');
    assert.equal(quietUntil(at('2026-10-07T17:59:59Z'), nights, 'UTC'), null);
    assert.equal(quietUntil(at('2026-10-07T12:00:00Z'), nights, 'UTC'), null);
  });

  test('a window inside one day ends the same day', () => {
    const lunch: QuietHours = { daily: { start: 12 * 60, end: 13 * 60 }, weekends: false };
    assert.deepEqual(quietUntil(at('2026-10-07T12:30:00Z'), lunch, 'UTC'), at('2026-10-07T13:00:00Z'));
    assert.equal(quietUntil(at('2026-10-07T13:00:00Z'), lunch, 'UTC'), null);
    assert.equal(quietUntil(at('2026-10-07T23:00:00Z'), lunch, 'UTC'), null);
  });

  test('read on the server\'s clock: 23:00 in Chicago is held until 07:00 there', () => {
    assert.deepEqual(quietUntil(at('2026-10-08T04:00:00Z'), nights, CHICAGO), at('2026-10-08T12:00:00Z'));
    assert.equal(quietUntil(at('2026-10-07T20:00:00Z'), nights, CHICAGO), null, '15:00 CDT');
  });

  test('weekends are quiet from Saturday\'s midnight to Monday\'s', () => {
    const weekends: QuietHours = { daily: null, weekends: true };
    assert.deepEqual(quietUntil(at('2026-10-10T00:00:00Z'), weekends, 'UTC'), at('2026-10-12T00:00:00Z'), 'Saturday');
    assert.deepEqual(quietUntil(at('2026-10-11T22:00:00Z'), weekends, 'UTC'), at('2026-10-12T00:00:00Z'), 'Sunday');
    assert.equal(quietUntil(at('2026-10-09T23:59:59Z'), weekends, 'UTC'), null, 'Friday night is a weekday');
    assert.equal(quietUntil(at('2026-10-12T03:00:00Z'), weekends, 'UTC'), null, 'Monday');
  });

  test('windows that meet are one: Friday night runs through the weekend to Monday morning', () => {
    const both: QuietHours = { ...nights, weekends: true };
    const monday = at('2026-10-12T07:00:00Z');
    assert.deepEqual(quietUntil(at('2026-10-09T18:00:00Z'), both, 'UTC'), monday, 'Friday evening');
    assert.deepEqual(quietUntil(at('2026-10-10T12:00:00Z'), both, 'UTC'), monday, 'Saturday noon');
    assert.deepEqual(quietUntil(at('2026-10-11T20:00:00Z'), both, 'UTC'), monday, 'Sunday evening');
    assert.deepEqual(quietUntil(at('2026-10-12T05:00:00Z'), both, 'UTC'), monday, 'Monday before dawn');
    assert.equal(quietUntil(at('2026-10-09T17:00:00Z'), both, 'UTC'), null, 'Friday afternoon');
    assert.equal(quietUntil(at('2026-10-12T07:00:00Z'), both, 'UTC'), null);
  });

  test('nothing is quiet with no window and no weekends', () => {
    assert.equal(quietUntil(at('2026-10-10T23:00:00Z'), { daily: null, weekends: false }, 'UTC'), null);
  });

  test('across the clocks changing, the window ends at the morning\'s wall-clock time', () => {
    // 23:00 CST on 7 March 2026; the clocks go forward at 02:00.
    assert.deepEqual(quietUntil(at('2026-03-08T05:00:00Z'), nights, CHICAGO), at('2026-03-08T12:00:00Z'), '07:00 CDT');
    // The clocks go back at 02:00 CDT on 1 November: 18:00 CDT to 07:00 CST is 14 hours.
    assert.deepEqual(quietUntil(at('2026-10-31T23:00:00Z'), nights, CHICAGO), at('2026-11-01T13:00:00Z'), '07:00 CST');
    // A window ending in the repeated hour ends at its second reading for an instant inside the second.
    const late: QuietHours = { daily: { start: 22 * 60, end: 90 }, weekends: false };
    assert.deepEqual(quietUntil(at('2026-11-01T06:15:00Z'), late, CHICAGO), at('2026-11-01T06:30:00Z'), '01:15 CDT ends at 01:30 CDT');
    assert.deepEqual(quietUntil(at('2026-11-01T07:15:00Z'), late, CHICAGO), at('2026-11-01T07:30:00Z'), '01:15 CST ends at 01:30 CST');
  });
});
