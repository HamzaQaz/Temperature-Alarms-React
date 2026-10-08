import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { coalesce, errorReloads, FALLBACK_RELOAD_MS, liveReloads } from './reload.ts';

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

// The Firmware tab while it is open (.scratch/firmware-2/issues/05-live-firmware-tab.md).
describe('an open tab reading its status again on the stream and every 30 s', () => {
  afterEach(() => mock.timers.reset());

  /** The tab's reload as useResource gives it, coalesced, each request settled by hand. */
  const requests = () => {
    const runs: Array<ReturnType<typeof deferred>> = [];
    const reload = coalesce(() => {
      const run = deferred();
      runs.push(run);
      return run.promise;
    });
    return { runs, reload };
  };

  it('a `firmware` event is one request', () => {
    const { runs, reload } = requests();
    const live = liveReloads(reload, () => true);
    live.changed();
    assert.equal(runs.length, 1);
    live.stop();
  });

  it('a burst of events while one is in flight is at most one more', async () => {
    const { runs, reload } = requests();
    const live = liveReloads(reload, () => true);
    for (let i = 0; i < 12; i++) live.changed();
    assert.equal(runs.length, 1, 'one in flight at a time');
    runs[0].resolve();
    await tick();
    assert.equal(runs.length, 2, 'one more, queued while it was in flight');
    runs[1].resolve();
    await tick();
    assert.equal(runs.length, 2);
    live.stop();
  });

  it('a hidden page reads nothing, on events or on the timer, and once when it is shown again', () => {
    mock.timers.enable({ apis: ['setInterval'] });
    const { runs, reload } = requests();
    let visible = false;
    const live = liveReloads(reload, () => visible);
    live.changed();
    live.changed();
    mock.timers.tick(2 * FALLBACK_RELOAD_MS);
    assert.equal(runs.length, 0);
    visible = true;
    live.visibilityChanged();
    assert.equal(runs.length, 1);
    live.visibilityChanged();
    assert.equal(runs.length, 1, 'shown once is read once');
    live.stop();
  });

  it('a page hidden and shown again without missing a read reads nothing more', () => {
    const { runs, reload } = requests();
    let visible = true;
    const live = liveReloads(reload, () => visible);
    visible = false;
    live.visibilityChanged();
    visible = true;
    live.visibilityChanged();
    assert.equal(runs.length, 0);
    live.stop();
  });

  it('reads every 30 s with no events at all, as when the stream is down, and stops when the tab closes', async () => {
    mock.timers.enable({ apis: ['setInterval'] });
    assert.equal(FALLBACK_RELOAD_MS, 30_000);
    const { runs, reload } = requests();
    const live = liveReloads(reload, () => true);
    mock.timers.tick(FALLBACK_RELOAD_MS - 1);
    assert.equal(runs.length, 0);
    mock.timers.tick(1);
    assert.equal(runs.length, 1);
    runs[0].resolve();
    await runs[0].promise;
    mock.timers.tick(FALLBACK_RELOAD_MS);
    assert.equal(runs.length, 2);
    live.stop();
    mock.timers.tick(3 * FALLBACK_RELOAD_MS);
    assert.equal(runs.length, 2);
  });
});
