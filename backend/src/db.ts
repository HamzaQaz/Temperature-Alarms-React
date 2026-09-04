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
    timezone: 'Z',
  });
  pool.on('connection', (connection) => {
    connection.query("SET time_zone = '+00:00'", (error: Error | null) => {
      if (error) console.error('Could not set the connection time zone to UTC:', error);
    });
  });
  return pool;
}
