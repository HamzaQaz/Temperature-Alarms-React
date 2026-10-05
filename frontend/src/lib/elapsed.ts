/**
 * Elapsed time in the browser, on a clock a wall-clock step never moves.
 *
 * The server says how old each Reading is (`secondsSinceReading`); the browser only adds how long
 * it has been since it asked. That span comes from performance.now(), not Date.now(): a browser
 * whose clock is stepped (NTP after drift, a laptop waking) must not freeze every card or send
 * them all late at once, and the browser's clock is never compared with the server's.
 */
export const monotonicNow = (): number => performance.now();

/** How old, in whole seconds, something is now that was `secondsAtFetch` old at the monotonic instant `fetchedAt`. */
export function ageSeconds(secondsAtFetch: number, fetchedAt: number, now: number): number {
  return secondsAtFetch + Math.max(0, Math.floor((now - fetchedAt) / 1000));
}
