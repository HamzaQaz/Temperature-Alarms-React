/**
 * The Offline sweep (docs/adr/0006). Offline is computed when read, from how long ago the last
 * Reading arrived, so no Reading ever opens an Offline incident. This pass does instead: once
 * every Report interval it opens one for each Device the server would now report Offline.
 * The backend runs as one process (docs/adr/0001), so one sweep runs, as one retention job does;
 * the unique key on open incidents would stop a second from duplicating anything all the same.
 */
import type { RouteDeps } from './deps';
import { broadcastIncidentChanges, sweepOffline } from './incidentStore';

export interface OfflineSweepOptions {
  /** How often a pass runs. The Report interval by default: an Offline incident opens at most one interval late. */
  intervalMs?: number;
  /** Where a failed pass is reported. The next pass still runs. */
  onError?: (error: unknown) => void;
}

export interface OfflineSweep {
  /** Stop the schedule. A pass already in flight finishes. */
  stop(): void;
}

type SweepDeps = Pick<RouteDeps, 'pool' | 'config' | 'sse' | 'now' | 'listening'>;

/**
 * One pass: open what is due and tell the dashboards. Returns how many incidents opened. A pass
 * that fails tells `listening` the server may not be hearing Devices; the next one that reaches
 * the database first tells it the server hears them again, so a Device's silence during the
 * outage is not judged as its own (listening.ts).
 */
export async function runOfflineSweep({ pool, config, sse, now = () => new Date(), listening }: SweepDeps): Promise<number> {
  try {
    await pool.query('SELECT 1');
    const at = now();
    listening?.regained(at);
    const changed = await sweepOffline(pool, { reportIntervalSeconds: config.reportIntervalSeconds, thresholds: config.thresholds }, at, listening?.since());
    await broadcastIncidentChanges(pool, sse, changed);
    return changed.length;
  } catch (error) {
    listening?.lost();
    throw error;
  }
}

/**
 * Run a pass every interval. The first waits one interval. With `listening` from the process
 * start, no Device is judged Offline until it has been silent a whole Offline window since the
 * start, and no incident starts inside the server's own downtime (docs/adr/0006). The timer
 * never keeps the process alive on its own.
 */
export function startOfflineSweep(deps: SweepDeps, options: OfflineSweepOptions = {}): OfflineSweep {
  const { intervalMs = deps.config.reportIntervalSeconds * 1000, onError = (error) => console.error('offline sweep: pass failed:', error) } = options;
  let inFlight = false;
  const timer = setInterval(() => {
    if (inFlight) return;
    inFlight = true;
    runOfflineSweep(deps)
      .catch(onError)
      .finally(() => {
        inFlight = false;
      });
  }, intervalMs);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
