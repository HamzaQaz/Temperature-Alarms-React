/**
 * Daily deletion of Readings past the retention window (docs/adr/0004).
 *
 * The window is `config.retentionDays` before now. Readings go in bounded batches, with a
 * short pause between full ones, so no single DELETE holds the table for long while Devices
 * keep writing. Nothing is rolled up first.
 */
import type { ResultSetHeader } from 'mysql2/promise';
import type { AppDeps } from './deps';

const DAY_MS = 86_400_000;
const DEFAULT_BATCH_SIZE = 5_000;
const DEFAULT_INTERVAL_MS = DAY_MS;
/** Breathing room for Device writes between one full batch and the next. */
const BATCH_PAUSE_MS = 100;

export interface RetentionOptions {
  /** Readings removed per DELETE statement. */
  batchSize?: number;
  /** How often a pass runs. Once a day. */
  intervalMs?: number;
  /** Where each pass reports how many Readings it removed. */
  log?: (line: string) => void;
  /** Where a failed pass is reported. The next pass still runs. */
  onError?: (error: unknown) => void;
}

export interface RetentionJob {
  /** Stop the schedule. A pass already in flight finishes. */
  stop(): void;
}

type RetentionDeps = Pick<AppDeps, 'pool' | 'config' | 'now'>;

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The instant before which a Reading is past the window. A Reading exactly at it stays. */
export function retentionCutoff(now: Date, retentionDays: number): Date {
  return new Date(now.getTime() - retentionDays * DAY_MS);
}

/** Delete every Reading past the window, `batchSize` at a time, and log the total removed. */
export async function deleteReadingsPastWindow(
  { pool, config, now = () => new Date() }: RetentionDeps,
  { batchSize = DEFAULT_BATCH_SIZE, log = console.log }: Pick<RetentionOptions, 'batchSize' | 'log'> = {},
): Promise<number> {
  const cutoff = retentionCutoff(now(), config.retentionDays);
  let removed = 0;
  for (;;) {
    const [result] = await pool.query<ResultSetHeader>('DELETE FROM readings WHERE recorded_at < ? LIMIT ?', [cutoff, batchSize]);
    removed += result.affectedRows;
    if (result.affectedRows < batchSize) break;
    await pause(BATCH_PAUSE_MS);
  }
  log(`retention: removed ${removed} reading${removed === 1 ? '' : 's'} older than ${cutoff.toISOString()} (${config.retentionDays} days)`);
  return removed;
}

/**
 * Run a pass now and then once every interval. The pass at start means a backend that is
 * restarted daily still deletes daily. The timer never keeps the process alive on its own.
 */
export function startRetentionJob(deps: RetentionDeps, options: RetentionOptions = {}): RetentionJob {
  const { intervalMs = DEFAULT_INTERVAL_MS, onError = (error) => console.error('retention: pass failed:', error) } = options;
  let inFlight = false;

  // Passes never overlap: a tick during a long pass (the first after a legacy migration) is skipped.
  const tick = () => {
    if (inFlight) return;
    inFlight = true;
    deleteReadingsPastWindow(deps, options)
      .catch(onError)
      .finally(() => {
        inFlight = false;
      });
  };

  const timer = setInterval(tick, intervalMs);
  timer.unref();
  tick();

  return { stop: () => clearInterval(timer) };
}
