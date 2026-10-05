import type { PoolConnection as CallbackPoolConnection } from 'mysql2';
import mysql, { type Pool } from 'mysql2/promise';

export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/**
 * One shared connection pool for the process.
 *
 * Every connection is pinned to UTC: JS Dates are sent as UTC (`timezone: 'Z'`) and the
 * session time zone is set so NOW() and CURRENT_TIMESTAMP defaults are UTC too.
 */
export function createPool(config: DatabaseConfig): Pool {
  const pool = mysql.createPool({
    ...config,
    waitForConnections: true,
    connectionLimit: 10,
    // A vanished db host fails fast (a 500) instead of hanging each request for mysql2's default 10 s.
    connectTimeout: 3000,
    timezone: 'Z',
  });
  // The event hands over the core, callback-style connection, whatever the promise typings say.
  pool.on('connection', (connection) => {
    (connection as unknown as CallbackPoolConnection).query("SET time_zone = '+00:00'", (error: Error | null) => {
      if (error) console.error('Could not set the connection time zone to UTC:', error);
    });
  });
  return pool;
}

function hasMysqlErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === code;
}

/** True when a write failed because it would repeat a unique key. */
export const isDuplicateKey = (error: unknown): boolean => hasMysqlErrorCode(error, 'ER_DUP_ENTRY');

/** True when a delete failed because other rows still reference the row. */
export const isForeignKeyInUse = (error: unknown): boolean => hasMysqlErrorCode(error, 'ER_ROW_IS_REFERENCED_2');

/** True when an insert or update pointed a foreign key at a row that does not exist. */
export const isMissingForeignRow = (error: unknown): boolean => hasMysqlErrorCode(error, 'ER_NO_REFERENCED_ROW_2');
