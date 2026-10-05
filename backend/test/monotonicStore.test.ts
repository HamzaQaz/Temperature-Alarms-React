import { test, describe, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import rateLimit from 'express-rate-limit';
import type { Server } from 'node:http';
import { MonotonicStore } from '../src/monotonicStore';

const WINDOW_MS = 60_000;
const FIVE_HOURS_MS = 5 * 3_600_000;

/** A monotonic clock the test moves by hand, as performance.now() moves while the wall clock steps. */
function fakeMonotonic() {
  let ms = 1_000;
  return { now: () => ms, advance: (by: number) => (ms += by) };
}

// The load test saw the host clock jump 5 h ahead for 12 s and back (.scratch/prodtest/load.md, S3).
// express-rate-limit's MemoryStore stamps each key's reset with Date.now() + window, so keys made
// during the jump kept refusing their Devices for the 5 h it took the wall clock to catch up.
describe('MonotonicStore, under a wall clock that steps', () => {
  afterEach(() => mock.timers.reset());

  test('a key counted while the clock was 5 h ahead starts a new window one window later, by the monotonic clock', async () => {
    mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 5, 16, 52, 12) });
    const clock = fakeMonotonic();
    const store = new MonotonicStore(clock.now);
    store.init({ windowMs: WINDOW_MS });

    mock.timers.setTime(Date.now() + FIVE_HOURS_MS);
    for (let i = 0; i < 20; i++) await store.increment('ESP_A1B2C3');
    mock.timers.setTime(Date.now() - FIVE_HOURS_MS);

    clock.advance(WINDOW_MS - 1);
    assert.equal((await store.increment('ESP_A1B2C3')).totalHits, 21, 'still the same window');
    clock.advance(1);
    const fresh = await store.increment('ESP_A1B2C3');
    assert.equal(fresh.totalHits, 1, 'a new window, not one five hours long');
    // The reset time handed to the headers is always within a window of the wall clock as it is now.
    assert.equal(fresh.resetTime?.getTime(), Date.now() + WINDOW_MS);
  });

  test('a clock stepped back neither stretches nor shortens a window', async () => {
    mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 5, 12, 0, 0) });
    const clock = fakeMonotonic();
    const store = new MonotonicStore(clock.now);
    store.init({ windowMs: WINDOW_MS });

    await store.increment('k');
    mock.timers.setTime(Date.now() - FIVE_HOURS_MS);
    clock.advance(30_000);
    const mid = await store.increment('k');
    assert.equal(mid.totalHits, 2);
    assert.equal(mid.resetTime?.getTime(), Date.now() + 30_000);
    clock.advance(30_000);
    assert.equal((await store.increment('k')).totalHits, 1);
  });

  test('decrement, get, resetKey and resetAll behave like the MemoryStore', async () => {
    const clock = fakeMonotonic();
    const store = new MonotonicStore(clock.now);
    store.init({ windowMs: WINDOW_MS });
    await store.increment('a');
    await store.increment('a');
    await store.decrement('a');
    assert.equal((await store.get('a'))?.totalHits, 1);
    await store.resetKey('a');
    assert.equal(await store.get('a'), undefined);
    await store.increment('b');
    await store.resetAll();
    assert.equal(await store.get('b'), undefined);
    store.shutdown();
  });

  test('expired keys are dropped, so a store keyed by hostname or address does not grow without bound', async () => {
    const clock = fakeMonotonic();
    const store = new MonotonicStore(clock.now);
    store.init({ windowMs: WINDOW_MS });
    for (let i = 0; i < 100; i++) await store.increment(`k${i}`);
    assert.equal(store.size, 100);
    clock.advance(WINDOW_MS);
    store.sweep();
    assert.equal(store.size, 0);
    store.shutdown();
  });
});

describe('a limiter on MonotonicStore, through express-rate-limit', () => {
  afterEach(() => mock.timers.reset());

  test('a Device refused after a 5 h step is let through again within one window of the clock stepping back', async () => {
    mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 5, 16, 52, 12) });
    const clock = fakeMonotonic();
    const app = express();
    app.use(rateLimit({ windowMs: WINDOW_MS, limit: 2, standardHeaders: true, legacyHeaders: false, validate: false, store: new MonotonicStore(clock.now) }));
    app.get('/', (_req, res) => {
      res.sendStatus(201);
    });
    const server: Server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('no port');
      const post = async () => {
        const response = await fetch(`http://127.0.0.1:${address.port}/`);
        await response.arrayBuffer();
        return { status: response.status, reset: Number(response.headers.get('ratelimit-reset')) };
      };

      mock.timers.setTime(Date.now() + FIVE_HOURS_MS);
      assert.equal((await post()).status, 201);
      assert.equal((await post()).status, 201);
      mock.timers.setTime(Date.now() - FIVE_HOURS_MS);
      const refused = await post();
      assert.equal(refused.status, 429);
      assert.ok(refused.reset <= WINDOW_MS / 1000, `RateLimit-Reset ${refused.reset} s on a ${WINDOW_MS / 1000} s window`);

      clock.advance(WINDOW_MS);
      assert.equal((await post()).status, 201);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
