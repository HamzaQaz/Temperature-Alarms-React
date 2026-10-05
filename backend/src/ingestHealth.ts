import { performance } from 'node:perf_hooks';

/**
 * How the latest Reading ingest went, for /api/health.
 *
 * `SELECT 1` answers on a full disk while every Reading fails with "The table 'readings' is full",
 * so health stayed green through a whole outage (.scratch/prodtest/resilience.md, S4). Ingest
 * itself is the write probe: a hundred Devices try it every Report interval at no extra cost.
 * Only the latest outcome counts, so one good Reading clears it, and a failure is forgotten after
 * `forgetAfterMs` without a Reading either way, since then there is nothing left to judge by.
 * Timed on the monotonic clock, so a host clock step neither raises nor clears it.
 */
export interface IngestHealth {
  succeeded(): void;
  failed(): void;
  /** True while the latest ingest, within the window, failed with a server error. */
  failing(): boolean;
}

export function createIngestHealth(forgetAfterMs: number, clock: () => number = () => performance.now()): IngestHealth {
  let latest: { ok: boolean; at: number } | undefined;
  return {
    succeeded: () => {
      latest = { ok: true, at: clock() };
    },
    failed: () => {
      latest = { ok: false, at: clock() };
    },
    failing: () => latest !== undefined && !latest.ok && clock() - latest.at <= forgetAfterMs,
  };
}
