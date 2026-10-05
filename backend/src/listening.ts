/**
 * Since when the server could hear Devices: the process start, then the first moment the
 * database worked again after it failed. A Device's silence counts from the later of its last
 * Reading and this, so the server's own downtime (a restart, a database outage) is never
 * recorded as a closet going Offline (docs/adr/0006, .scratch/prodtest/resilience.md S2).
 */
export interface Listening {
  since(): Date;
  /** The database failed: Readings may have been lost from here on. */
  lost(): void;
  /** The database worked at `now`: if it had failed, the server hears Devices again from now. */
  regained(now: Date): void;
}

export function createListening(start: Date): Listening {
  let since = start;
  let down = false;
  return {
    since: () => since,
    lost: () => {
      down = true;
    },
    regained: (now) => {
      if (!down) return;
      down = false;
      since = now;
    },
  };
}
