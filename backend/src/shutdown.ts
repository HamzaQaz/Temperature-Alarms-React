/**
 * Stopping cleanly on SIGTERM or SIGINT: every `docker compose up -d` that recreates `api`, every
 * deploy, `docker compose stop`, `pm2 restart`, Ctrl-C. Docker sends SIGKILL 10 s after SIGTERM,
 * so the whole stop has 8 s. Node runs as PID 1 in its container, where a signal with no handler is
 * ignored, so before this every stop waited out the 10 s and then cut whatever was running.
 *
 * In order: health answers 503 from the signal on (routes/health.ts); the server takes no new
 * connections; every dashboard stream ends, its browser told to reconnect in 2 s; the retention
 * job, the Offline sweep, and the sender each finish the pass they are in, so an email the relay
 * took is marked sent rather than rolled back and sent again (docs/adr/0008); requests in flight
 * are answered; then the pool closes.
 */
import type { Server } from 'node:http';
import type { Pool } from 'mysql2/promise';
import type { Broadcaster } from './sse';

/** How long the stop may take before the process exits regardless: inside Docker's 10 s grace. */
export const STOP_DEADLINE_MS = 8_000;

/** How often a stopping server closes the keep-alive connections that have gone idle. */
const IDLE_SWEEP_MS = 50;

/** A background job: the retention job, the Offline sweep, the sender. */
export interface Stoppable {
  /** Stop the schedule; resolves once a pass in flight has finished. */
  stop(): Promise<void>;
}

export interface ShutdownParts {
  server: Server;
  sse: Broadcaster;
  jobs: Stoppable[];
  pool: Pool;
}

/** Stop taking requests, end the streams, let the jobs finish their passes, then close the pool. */
export async function shutDown({ server, sse, jobs, pool }: ShutdownParts): Promise<void> {
  // No new connections; the idle keep-alive ones close now.
  const closed = new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
  // A request in flight keeps its keep-alive connection open for 5 s after its answer; close each as it goes idle.
  const idle = setInterval(() => server.closeIdleConnections(), IDLE_SWEEP_MS);
  try {
    sse.close();
    await Promise.all([closed, ...jobs.map((job) => job.stop())]);
  } finally {
    clearInterval(idle);
  }
  // Last: the passes and the requests in flight needed it.
  await pool.end();
}

/** What exitOnSignals listens on: the process, or a stand-in in tests. */
export interface SignalSource {
  on(signal: 'SIGTERM' | 'SIGINT', listener: (signal: NodeJS.Signals) => void): unknown;
}

export interface ExitOptions {
  signals?: SignalSource;
  /** How long the stop may take. STOP_DEADLINE_MS by default. */
  deadlineMs?: number;
  /** process.exit by default. */
  exit?: (code: number) => void;
  log?: (line: string) => void;
  logError?: (line: string, error: unknown) => void;
}

/**
 * On the first SIGTERM or SIGINT, run `stop`, then exit 0, or 1 if it failed. A second signal, or
 * `deadlineMs` without the stop finishing, exits 1 at once.
 */
export function exitOnSignals(
  stop: () => Promise<void>,
  {
    signals = process,
    deadlineMs = STOP_DEADLINE_MS,
    exit = (code) => process.exit(code),
    log = console.log,
    logError = console.error,
  }: ExitOptions = {},
): void {
  let stopping = false;
  const onSignal = (signal: NodeJS.Signals) => {
    if (stopping) {
      log(`${signal} again: exiting now`);
      exit(1);
      return;
    }
    stopping = true;
    log(`${signal}: stopping; a second signal exits at once`);
    const deadline = setTimeout(() => {
      log(`still stopping after ${deadlineMs / 1000} s: exiting now`);
      exit(1);
    }, deadlineMs);
    stop().then(
      () => {
        clearTimeout(deadline);
        log('Stopped');
        exit(0);
      },
      (error: unknown) => {
        clearTimeout(deadline);
        logError('Stop failed:', error);
        exit(1);
      },
    );
  };
  signals.on('SIGTERM', onSignal);
  signals.on('SIGINT', onSignal);
}
