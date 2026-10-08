import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isTimeZone, localDay, localMonth, monthBefore, todayIn } from '../src/localDay';

const CHICAGO = 'America/Chicago';

describe('localDay', () => {
  test('a day is midnight to the next midnight in the zone, as UTC instants', () => {
    const day = localDay('2026-09-05', CHICAGO);
    assert.deepEqual(day, {
      date: '2026-09-05',
      timeZone: CHICAGO,
      from: new Date('2026-09-05T05:00:00Z'),
      to: new Date('2026-09-06T05:00:00Z'),
    });
  });

  test('a UTC day starts at 00:00Z', () => {
    const day = localDay('2026-09-05', 'UTC');
    assert.deepEqual([day?.from, day?.to], [new Date('2026-09-05T00:00:00Z'), new Date('2026-09-06T00:00:00Z')]);
  });

  test('the day the clocks go forward is 23 hours; the day they go back is 25', () => {
    const forward = localDay('2026-03-08', CHICAGO);
    assert.deepEqual([forward?.from, forward?.to], [new Date('2026-03-08T06:00:00Z'), new Date('2026-03-09T05:00:00Z')]);
    const back = localDay('2026-11-01', CHICAGO);
    assert.deepEqual([back?.from, back?.to], [new Date('2026-11-01T05:00:00Z'), new Date('2026-11-02T06:00:00Z')]);
  });

  test('a zone east of UTC starts its day the previous UTC evening', () => {
    const day = localDay('2026-09-05', 'Asia/Tokyo');
    assert.deepEqual([day?.from, day?.to], [new Date('2026-09-04T15:00:00Z'), new Date('2026-09-05T15:00:00Z')]);
  });

  test('a day the calendar does not have is undefined', () => {
    for (const date of ['2026-02-30', '2026-13-01', '2026-00-10', '2026-04-31', '2026-9-5', '', 'today']) {
      assert.equal(localDay(date, CHICAGO), undefined, date);
    }
    assert.ok(localDay('2024-02-29', CHICAGO), 'a leap day is real');
    assert.equal(localDay('2026-02-29', CHICAGO), undefined, 'but not in a common year');
  });
});

describe('localMonth and monthBefore', () => {
  test('a month is midnight on its first day to midnight on the next first, the clocks going back inside it', () => {
    assert.deepEqual(localMonth('2026-11', CHICAGO), {
      month: '2026-11',
      timeZone: CHICAGO,
      from: new Date('2026-11-01T05:00:00Z'),
      to: new Date('2026-12-01T06:00:00Z'),
    });
    const december = localMonth('2026-12', 'UTC');
    assert.deepEqual([december?.from, december?.to], [new Date('2026-12-01T00:00:00Z'), new Date('2027-01-01T00:00:00Z')]);
  });

  test('a month the calendar does not have is undefined', () => {
    for (const month of ['2026-00', '2026-13', '2026-9', '2026-09-01', '', 'last']) assert.equal(localMonth(month, CHICAGO), undefined, month);
  });

  test('the month before is the one just ended in the zone, across a year', () => {
    assert.equal(monthBefore(new Date('2026-10-01T04:59:59Z'), CHICAGO).month, '2026-08', 'still September 30 in Chicago');
    assert.deepEqual(monthBefore(new Date('2026-10-01T05:00:00Z'), CHICAGO), localMonth('2026-09', CHICAGO));
    assert.deepEqual(monthBefore(new Date('2027-01-01T06:00:00Z'), CHICAGO), localMonth('2026-12', CHICAGO));
  });
});

describe('todayIn', () => {
  test('is the calendar date of the instant in that zone', () => {
    const at = new Date('2026-09-05T19:30:00Z');
    assert.equal(todayIn(at, CHICAGO), '2026-09-05');
    assert.equal(todayIn(at, 'Asia/Tokyo'), '2026-09-06');
    assert.equal(todayIn(new Date('2026-09-06T04:59:59Z'), CHICAGO), '2026-09-05');
    assert.equal(todayIn(new Date('2026-09-06T05:00:00Z'), CHICAGO), '2026-09-06');
  });
});

describe('isTimeZone', () => {
  test('knows IANA zones and nothing else', () => {
    assert.equal(isTimeZone(CHICAGO), true);
    assert.equal(isTimeZone('UTC'), true);
    assert.equal(isTimeZone('Mars/Olympus_Mons'), false);
    assert.equal(isTimeZone(''), false);
  });
});
