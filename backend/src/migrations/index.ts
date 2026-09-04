import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { initialSchema } from './0001-initial-schema';

export interface Migration {
  /** Stable identifier, recorded in schema_migrations once applied. Sorted lexically. */
  id: string;
  up(conn: PoolConnection): Promise<void>;
}

/** Every migration, in the order it applies. Add new ones at the end. */
export const migrations: Migration[] = [initialSchema];

/**
 * Apply any migration that has not run yet and record it. Returns the ids applied.
 * MySQL commits DDL implicitly, so each migration is recorded right after it succeeds
 * rather than inside a transaction.
 */
export async function runMigrations(pool: Pool, list: Migration[] = migrations): Promise<string[]> {
  const conn = await pool.getConnection();
  try {
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
      await migration.up(conn);
      await conn.query('INSERT INTO schema_migrations (id) VALUES (?)', [migration.id]);
      applied.push(migration.id);
    }
    return applied;
  } finally {
    conn.release();
  }
}
