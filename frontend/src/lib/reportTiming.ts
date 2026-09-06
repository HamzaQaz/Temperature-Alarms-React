/**
 * How the dashboard talks about time: how long since a Reading arrived, and how long
 * until the next one is due. The Report interval comes from the API, never a constant.
 */

/** "12s ago", "3m ago", "2h ago", "5d ago". */
export function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Seconds until the Device's next Reading is due, assuming it reports every interval
 * since its last one. Runs interval → 1 and wraps, so it stays meaningful while a
 * healthy Device is a little late.
 */
export function secondsUntilNextReport(secondsSinceReading: number, reportIntervalSeconds: number): number {
  return reportIntervalSeconds - (secondsSinceReading % reportIntervalSeconds);
}
