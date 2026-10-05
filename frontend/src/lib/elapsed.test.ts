import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ageSeconds, monotonicNow } from './elapsed.ts';

const FIVE_HOURS_MS = 5 * 3_600_000;

// A card's age is the server's secondsSinceReading plus the time since the fetch. Measured with
// Date.now(), a browser clock stepped back froze every card (the elapsed time clamps to zero) and one
// stepped forward sent every card late and Offline at once (.scratch/prodtest/load.md, S3).
describe('ageSeconds across a wall-clock step', () => {
  afterEach(() => mock.timers.reset());

  it('adds the whole seconds elapsed since the fetch to the age the server gave', () => {
    assert.equal(ageSeconds(12, 1_000, 1_000), 12);
    assert.equal(ageSeconds(12, 1_000, 1_999), 12);
    assert.equal(ageSeconds(12, 1_000, 31_000), 42);
    // Never younger than the server said, whatever the clock read.
    assert.equal(ageSeconds(12, 1_000, 500), 12);
  });

  it('the monotonic clock ignores a step of the wall clock, back or forward', () => {
    mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 5, 16, 52, 12) });
    const fetchedAt = monotonicNow();
    mock.timers.setTime(Date.now() + FIVE_HOURS_MS);
    assert.equal(ageSeconds(5, fetchedAt, monotonicNow()), 5, 'stepped forward: not 5 h late');
    mock.timers.setTime(Date.now() - 2 * FIVE_HOURS_MS);
    assert.equal(ageSeconds(5, fetchedAt, monotonicNow()), 5, 'stepped back: still the same age');
  });

  it('keeps counting after a step back, so a silent Device still goes late', () => {
    mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 5, 16, 52, 12) });
    let monotonic = 10_000;
    const fetchedAt = monotonic;
    mock.timers.setTime(Date.now() - FIVE_HOURS_MS);
    monotonic += 45_000;
    assert.equal(ageSeconds(0, fetchedAt, monotonic), 45);
  });
});
