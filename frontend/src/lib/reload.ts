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

/** How often an open Firmware tab reads its status whatever the stream says. */
export const FALLBACK_RELOAD_MS = 30_000;

export interface LiveReloads {
  /** Something it shows can have changed (a `firmware` event), or the stream is back after a drop. */
  changed(): void;
  /** The page was shown or hidden (the browser's visibilitychange). */
  visibilityChanged(): void;
  /** Stop the fallback timer, as the tab closes. */
  stop(): void;
}

/**
 * When an open tab reads its data again on its own: at each `changed()`, and every `everyMs`
 * whatever the stream does, so a dropped stream, or a change no event announces (a build published
 * from the command line, a Device added), still shows within that. Only while the page is visible:
 * a hidden one reads nothing, and once when it is shown again if it missed a read. `reload` must be
 * coalesced (as useResource's is), so a burst costs at most one request beyond the one in flight.
 */
export function liveReloads(reload: () => Promise<void>, visible: () => boolean, everyMs = FALLBACK_RELOAD_MS): LiveReloads {
  let missed = false;
  const read = () => {
    missed = !visible();
    if (!missed) void reload();
  };
  const timer = setInterval(read, everyMs);
  return {
    changed: read,
    visibilityChanged: () => {
      if (missed && visible()) read();
    },
    stop: () => clearInterval(timer),
  };
}
