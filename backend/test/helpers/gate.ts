import type { Pool } from 'mysql2/promise';

/**
 * A gate a background pass stops at until the test opens it, so a test can act while the pass is
 * in flight: stop a job, shut the server down.
 */
export interface Gate {
  /** Where the pass waits. Resolves at once after open(). */
  wait(): Promise<void>;
  /** Resolves when the first caller reaches wait(). */
  readonly reached: Promise<void>;
  open(): void;
}

export function createGate(): Gate {
  let open!: () => void;
  let reach!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  const reached = new Promise<void>((resolve) => (reach = resolve));
  return {
    wait: () => {
      reach();
      return opened;
    },
    reached,
    open: () => open(),
  };
}

/** `pool`, with every query first waiting at `gate`, and recorded in `statements`. */
export function gatedPool(pool: Pool, gate: Gate, statements: string[] = []): Pool {
  const gated = Object.create(pool) as Pool;
  gated.query = (async (sql: string, values?: Parameters<Pool['query']>[1]) => {
    statements.push(sql);
    await gate.wait();
    return pool.query(sql, values);
  }) as Pool['query'];
  return gated;
}

/** Whether `promise` settles within `ms`. */
export async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  const settled = promise.then(
    () => true as const,
    () => true as const,
  );
  try {
    return await Promise.race([settled, late]);
  } finally {
    clearTimeout(timer);
  }
}
