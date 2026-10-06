import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { Config } from '../config';
import { serverTimeZone } from '../localDay';
import { legacyTablesAside } from './0000-legacy-tables-aside';
import { initialSchema } from './0001-initial-schema';
import { legacyCampusesAndDevices } from './0002-legacy-campuses-and-devices';
import { legacyReadings } from './0003-legacy-readings';
import { readingsRecordedAtIndex } from './0004-readings-recorded-at-index';
import { incidentsSchema } from './0005-incidents';
import { readingsCoveringIndex } from './0006-readings-covering-index';
import { firmwareSchema } from './0007-firmware';

/** What a migration may consult and report to while it runs. */
export interface MigrationContext {
  /** Zone the PHP-era and first Node backend wrote their string timestamps in. */
  legacyTimeZone: string;
  /** Where a migration reports what it skipped and what it copied. */
  log(line: string): void;
}

export interface Migration {
  /** Stable identifier, recorded in schema_migrations once applied. Sorted lexically. */
  id: string;
  up(conn: PoolConnection, context: MigrationContext): Promise<void>;
}

/** Every migration, in the order it applies. Add new ones at the end. */
export const migrations: Migration[] = [
  legacyTablesAside,
  initialSchema,
  legacyCampusesAndDevices,
  legacyReadings,
  readingsRecordedAtIndex,
  incidentsSchema,
  readingsCoveringIndex,
  firmwareSchema,
];

/** The context the running backend hands its migrations: the configured legacy zone, logging to stdout. */
export const migrationContext = ({ legacyTimeZone }: Pick<Config, 'legacyTimeZone'>): MigrationContext => ({
  legacyTimeZone,
  log: (line) => console.log(line),
});

const defaultContext = (): MigrationContext => migrationContext({ legacyTimeZone: serverTimeZone() });

/**
 * How long a second runner waits for the first before giving up. A first start that walks a
 * large set of legacy tables takes minutes, and waiting it out beats failing at once.
 */
const LOCK_WAIT_SECONDS = 600;

/** One lock per database, held by whoever is migrating it. MySQL named locks are server-wide and at most 64 characters. */
const LOCK_NAME = "LEFT(CONCAT('temperature_alarms_migrations:', DATABASE()), 64)";

export class MigrationLockError extends Error {
  constructor(waitSeconds: number) {
    super(`Another migration run still holds the lock after ${waitSeconds} s; try again once it has finished`);
    this.name = 'MigrationLockError';
  }
}

/**
 * Run `work` holding the database's migration lock, a MySQL named lock on `conn`'s session, so
 * the backend's startup and `npm run migrate:legacy` never copy legacy rows at the same time.
 * A second runner waits for the first; past `waitSeconds` it gives up rather than run alongside.
 */
export async function withMigrationLock<T>(conn: PoolConnection, work: () => Promise<T>, waitSeconds = LOCK_WAIT_SECONDS): Promise<T> {
  const [[{ acquired }]] = await conn.query<RowDataPacket[]>(`SELECT GET_LOCK(${LOCK_NAME}, ?) AS acquired`, [waitSeconds]);
  if (acquired !== 1) throw new MigrationLockError(waitSeconds);
  try {
    return await work();
  } finally {
    await conn.query(`SELECT RELEASE_LOCK(${LOCK_NAME})`);
  }
}

interface RunOptions {
  context?: MigrationContext;
  /** How long to wait for another runner's lock. */
  lockWaitSeconds?: number;
}

/**
 * Apply any migration that has not run yet and record it. Returns the ids applied.
 * MySQL commits DDL implicitly, so each migration is recorded right after it succeeds
 * rather than inside a transaction.
 */
export async function runMigrations(
  pool: Pool,
  { list = migrations, context = defaultContext(), lockWaitSeconds }: RunOptions & { list?: Migration[] } = {},
): Promise<string[]> {
  const conn = await pool.getConnection();
  try {
    return await withMigrationLock(
      conn,
      async () => {
        await conn.query(`
          CREATE TABLE IF NOT EXISTS schema_migrations (
            id         VARCHAR(100) NOT NULL,
            applied_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        const [rows] = await conn.query<RowDataPacket[]>('SELECT id FROM schema_migrations');
        const done = new Set(rows.map((r) => r.id as string));

        const applied: string[] = [];
        for (const migration of [...list].sort((a, b) => a.id.localeCompare(b.id))) {
          if (done.has(migration.id)) continue;
          await migration.up(conn, context);
          await conn.query('INSERT INTO schema_migrations (id) VALUES (?)', [migration.id]);
          applied.push(migration.id);
        }
        return applied;
      },
      lockWaitSeconds,
    );
  } finally {
    conn.release();
  }
}

/**
 * Run the guarded legacy migrations again (`npm run migrate:legacy`), under the same lock as
 * the runner. Both are safe to repeat and copy only what is new (DEPLOYMENT.md).
 */
export async function runLegacyMigrations(pool: Pool, { context = defaultContext(), lockWaitSeconds }: RunOptions = {}): Promise<void> {
  const conn = await pool.getConnection();
  try {
    await withMigrationLock(
      conn,
      async () => {
        await legacyCampusesAndDevices.up(conn, context);
        await legacyReadings.up(conn, context);
      },
      lockWaitSeconds,
    );
  } finally {
    conn.release();
  }
}
