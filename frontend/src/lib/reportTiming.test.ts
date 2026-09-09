import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatAge, nextReport } from './reportTiming.ts';

describe('nextReport', () => {
  it('counts down to the next Reading while the Device is on time', () => {
    assert.deepEqual(nextReport(0, 30), { status: 'due', seconds: 30 });
    assert.deepEqual(nextReport(12, 30), { status: 'due', seconds: 18 });
    assert.deepEqual(nextReport(29, 30), { status: 'due', seconds: 1 });
  });

  it('says how long ago the Reading was expected once the interval has passed, and never wraps', () => {
    assert.deepEqual(nextReport(30, 30), { status: 'late', seconds: 0 });
    assert.deepEqual(nextReport(45, 30), { status: 'late', seconds: 15 });
    // The bug: at 75 s the old countdown wrapped back to "Next in 15s" as if nothing were wrong.
    assert.deepEqual(nextReport(75, 30), { status: 'late', seconds: 45 });
    assert.deepEqual(nextReport(3, 2), { status: 'late', seconds: 1 });
  });
});

describe('formatAge', () => {
  it('picks the largest whole unit', () => {
    assert.equal(formatAge(0), '0s ago');
    assert.equal(formatAge(59), '59s ago');
    assert.equal(formatAge(60), '1m ago');
    assert.equal(formatAge(3600), '1h ago');
    assert.equal(formatAge(90000), '1d ago');
  });
});
