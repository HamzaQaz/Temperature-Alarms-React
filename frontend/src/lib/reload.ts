/**
 * At most one reload in flight and one queued behind it. A burst of calls while one runs (a
 * stream catching up after an outage moves many cards at once) costs one more request, which
 * starts after the current one settles, so the page ends on an answer from after the burst.
 * The queued call runs whether the one before it succeeded or failed.
 */
export function coalesce(run: () => Promise<void>): () => Promise<void> {
  let current: Promise<void> | null = null;
  let queued: Promise<void> | null = null;
  const call = (): Promise<void> => {
    if (current === null) {
      current = run().finally(() => {
        current = null;
      });
      return current;
    }
    queued ??= current
      .catch(() => undefined)
      .then(() => {
        queued = null;
        return call();
      });
    return queued;
  };
  return call;
}

/** How long a page on its error screen waits between reloads the stream asks for. */
export const ERROR_RELOAD_GAP_MS = 5_000;

/**
 * Whether a Reading or incident from the stream should reload a page in this state. A page on
 * its error screen reloads on one: the stream working means the server is back, and without
 * this a wall screen whose last reload failed while the stream stayed up shows the error until
 * someone presses Try again (.scratch/prodtest/resilience.md, S1). At most once every
 * `gapMs`, so a hundred Devices reporting do not turn one tab into a few requests a second.
 * `clock` is monotonic milliseconds.
 */
export function errorReloads(clock: () => number, gapMs = ERROR_RELOAD_GAP_MS): (status: 'loading' | 'ready' | 'error') => boolean {
  let last = -Infinity;
  return (status) => {
    if (status !== 'error') return false;
    const now = clock();
    if (now - last < gapMs) return false;
    last = now;
    return true;
  };
}
