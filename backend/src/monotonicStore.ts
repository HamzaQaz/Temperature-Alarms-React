import { performance } from 'node:perf_hooks';
import type { ClientRateLimitInfo, Options, Store } from 'express-rate-limit';

interface Window {
  hits: number;
  /** When the window ends, on the monotonic clock. */
  endsAt: number;
}

/**
 * An in-memory rate-limit store whose windows are measured on a monotonic clock, not the wall clock.
 *
 * express-rate-limit's MemoryStore gives each key a reset time of Date.now() + window and only
 * starts a new window once the wall clock passes it. When the host clock jumped 5 h ahead for a
 * few seconds, every key counted then kept its 5 h reset, and the Devices behind them got 429 on
 * every post until the clock caught up (.scratch/prodtest/load.md, S3). performance.now() never
 * steps, so a window here always lasts one window, whatever the wall clock does. The reset time
 * handed back for the headers is worked out from the wall clock as it is at that moment.
 */
export class MonotonicStore implements Store {
  /** Each key's count is its own to this process, as with the MemoryStore. */
  readonly localKeys = true;
  private windowMs = 60_000;
  private readonly windows = new Map<string, Window>();
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly clock: () => number = () => performance.now()) {}

  init(options: Pick<Options, 'windowMs'>): void {
    this.windowMs = options.windowMs;
    clearInterval(this.timer);
    // Drop finished windows once a window, so a store keyed by hostname or address stays small.
    this.timer = setInterval(() => this.sweep(), this.windowMs);
    this.timer.unref();
  }

  /** How many keys have a window open or not yet swept. */
  get size(): number {
    return this.windows.size;
  }

  /** Forget every window that has ended. */
  sweep(): void {
    const now = this.clock();
    for (const [key, window] of this.windows) if (window.endsAt <= now) this.windows.delete(key);
  }

  private info(window: Window, now: number): ClientRateLimitInfo {
    return { totalHits: window.hits, resetTime: new Date(Date.now() + (window.endsAt - now)) };
  }

  get(key: string): ClientRateLimitInfo | undefined {
    const now = this.clock();
    const window = this.windows.get(key);
    return window === undefined || window.endsAt <= now ? undefined : this.info(window, now);
  }

  increment(key: string): ClientRateLimitInfo {
    const now = this.clock();
    let window = this.windows.get(key);
    if (window === undefined || window.endsAt <= now) {
      window = { hits: 0, endsAt: now + this.windowMs };
      this.windows.set(key, window);
    }
    window.hits += 1;
    return this.info(window, now);
  }

  decrement(key: string): void {
    const window = this.windows.get(key);
    if (window !== undefined && window.hits > 0) window.hits -= 1;
  }

  resetKey(key: string): void {
    this.windows.delete(key);
  }

  resetAll(): void {
    this.windows.clear();
  }

  shutdown(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.windows.clear();
  }
}
