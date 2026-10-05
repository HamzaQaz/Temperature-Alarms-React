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
 * Where the next Reading stands: due in so many seconds, or expected so many seconds ago
 * and not here yet. It never wraps back to a fresh count, so a Device that has missed a
 * report reads as late until a Reading arrives or the server calls it Offline.
 */
export type NextReport = { status: 'due'; seconds: number } | { status: 'late'; seconds: number };

export function nextReport(secondsSinceReading: number, reportIntervalSeconds: number): NextReport {
  const remaining = reportIntervalSeconds - secondsSinceReading;
  // Exactly due is still on time ("Next in 0s"): that second is when a punctual board's Reading
  // lands, and calling it late would flash every on-time card amber. Late starts a second after.
  return remaining >= 0 ? { status: 'due', seconds: remaining } : { status: 'late', seconds: -remaining };
}
