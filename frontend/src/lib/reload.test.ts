import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { coalesce, errorReloads } from './reload.ts';

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('coalesced reloads (resilience.md S1)', () => {
  it('a burst while one is in flight costs one more request, not one each', async () => {
    const runs: Array<ReturnType<typeof deferred>> = [];
    const reload = coalesce(() => {
      const run = deferred();
      runs.push(run);
      return run.promise;
    });
    const first = reload();
    const burst = Array.from({ length: 33 }, () => reload());
    assert.equal(runs.length, 1);
    runs[0].resolve();
    await first;
    await tick();
    assert.equal(runs.length, 2, 'the burst queued exactly one more');
    runs[1].resolve();
    await Promise.all(burst);
    assert.equal(runs.length, 2);
  });

  it('a queued reload still runs when the one in flight fails, and the next call starts afresh', async () => {
    const runs: Array<ReturnType<typeof deferred>> = [];
    const reload = coalesce(() => {
      const run = deferred();
      runs.push(run);
      return run.promise;
    });
    const failing = reload();
    const queued = reload();
    runs[0].reject(new Error('500'));
    await assert.rejects(failing);
    await tick();
    assert.equal(runs.length, 2);
    runs[1].resolve();
    await queued;
    void reload();
    assert.equal(runs.length, 3);
  });
});

describe('a page on its error screen while the stream is live', () => {
  it('reloads on a Reading or incident, since the stream working means the server is back, at most once every 5 s', () => {
    let now = 1_000;
    const reloads = errorReloads(() => now);
    assert.equal(reloads('error'), true);
    now += 4_999;
    assert.equal(reloads('error'), false, 'a burst of Readings is one reload');
    now += 1;
    assert.equal(reloads('error'), true);
  });
  it('leaves a loaded or loading page to its own rules', () => {
    const reloads = errorReloads(() => 0);
    assert.equal(reloads('ready'), false);
    assert.equal(reloads('loading'), false);
  });
});
