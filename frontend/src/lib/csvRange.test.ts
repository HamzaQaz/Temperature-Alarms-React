import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { daysSpanned, earliestDay, rangeBounds, rangeProblem } from './csvRange.ts';

describe('the CSV download range', () => {
  it('counts both ends: one day is 1, a month of September is 30', () => {
    assert.equal(daysSpanned('2026-09-05', '2026-09-05'), 1);
    assert.equal(daysSpanned('2026-09-01', '2026-09-30'), 30);
    assert.equal(daysSpanned('2026-06-08', '2026-09-05'), 90);
  });

  it('starts no earlier than the Retention window back from today, today included', () => {
    assert.equal(earliestDay('2026-09-05', 90), '2026-06-08');
    assert.equal(earliestDay('2026-09-05', 1), '2026-09-05');
  });

  it('takes a range of up to the Retention window, first day on or before the last', () => {
    assert.equal(rangeProblem('2026-09-05', '2026-09-05', 90), null);
    assert.equal(rangeProblem('2026-06-08', '2026-09-05', 90), null);
    assert.match(rangeProblem('2026-06-07', '2026-09-05', 90) ?? '', /at most 90 days/i);
    assert.match(rangeProblem('2026-09-06', '2026-09-05', 90) ?? '', /first day/i);
    assert.match(rangeProblem('', '2026-09-05', 90) ?? '', /pick/i);
    assert.match(rangeProblem('2026-09-05', '2026-02-30', 90) ?? '', /pick/i);
  });

  it('runs from the first day\'s local midnight to the midnight after the last', () => {
    assert.deepEqual(rangeBounds('2026-09-01', '2026-09-05'), { from: new Date(2026, 8, 1), to: new Date(2026, 8, 6) });
    assert.deepEqual(rangeBounds('2026-12-31', '2026-12-31'), { from: new Date(2026, 11, 31), to: new Date(2027, 0, 1) });
  });
});
