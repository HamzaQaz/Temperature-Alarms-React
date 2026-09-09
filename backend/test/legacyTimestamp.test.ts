import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseLegacyTimestamp } from '../src/migrations/legacyTimestamp';

const CHICAGO = 'America/Chicago';

const iso = (date: string, time: string, zone = CHICAGO) => parseLegacyTimestamp(date, time, zone)?.toISOString();

describe('parseLegacyTimestamp', () => {
  test('reads the PHP-era m/d/Y and g:i:s A strings in the legacy zone', () => {
    assert.equal(iso('01/05/2024', '3:07:09 PM'), '2024-01-05T21:07:09.000Z');
    assert.equal(iso('01/05/2024', '3:07:09 AM'), '2024-01-05T09:07:09.000Z');
  });

  test('reads the Node-era en-US toLocaleDateString and toLocaleTimeString strings', () => {
    assert.equal(iso('7/4/2024', '3:07:09 PM'), '2024-07-04T20:07:09.000Z');
    // Node 20 puts a narrow no-break space before AM/PM.
    assert.equal(iso('7/4/2024', '3:07:09 PM'), '2024-07-04T20:07:09.000Z');
    assert.equal(iso('7/4/2024', '3:07:09 PM'), '2024-07-04T20:07:09.000Z');
  });

  test('handles noon and midnight on the 12-hour clock', () => {
    assert.equal(iso('7/4/2024', '12:00:00 PM'), '2024-07-04T17:00:00.000Z');
    assert.equal(iso('7/4/2024', '12:00:00 AM'), '2024-07-04T05:00:00.000Z');
    assert.equal(iso('7/4/2024', '12:30:00 am'), '2024-07-04T05:30:00.000Z');
  });

  test('also accepts ISO dates and 24-hour times', () => {
    assert.equal(iso('2024-01-05', '15:07:09'), '2024-01-05T21:07:09.000Z');
    assert.equal(iso('2024-01-05', '15:07'), '2024-01-05T21:07:00.000Z');
    assert.equal(iso('2024-01-05', '00:00:00'), '2024-01-05T06:00:00.000Z');
  });

  test('converts from whichever zone the legacy server wrote in', () => {
    assert.equal(iso('01/05/2024', '3:07:09 PM', 'UTC'), '2024-01-05T15:07:09.000Z');
    assert.equal(iso('01/05/2024', '3:07:09 PM', 'America/New_York'), '2024-01-05T20:07:09.000Z');
  });

  test('tolerates surrounding whitespace', () => {
    assert.equal(iso(' 01/05/2024 ', ' 3:07:09 PM '), '2024-01-05T21:07:09.000Z');
  });

  test('returns undefined for anything it cannot read, rather than guessing', () => {
    assert.equal(iso('yesterday', '3:07:09 PM'), undefined);
    assert.equal(iso('01/05/2024', 'noon'), undefined);
    assert.equal(iso('', '3:07:09 PM'), undefined);
    assert.equal(iso('01/05/2024', ''), undefined);
    assert.equal(iso('02/30/2024', '3:07:09 PM'), undefined, 'not a real day');
    assert.equal(iso('13/01/2024', '3:07:09 PM'), undefined, 'day-first dates are not assumed');
    assert.equal(iso('01/05/24', '3:07:09 PM'), undefined, 'two-digit years are ambiguous');
    assert.equal(iso('01/05/2024', '13:07:09 PM'), undefined);
    assert.equal(iso('01/05/2024', '0:07:09 PM'), undefined);
    assert.equal(iso('01/05/2024', '24:00:00'), undefined);
    assert.equal(iso('01/05/2024', '3:60:00 PM'), undefined);
  });
});
