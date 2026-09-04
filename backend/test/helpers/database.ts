import type { Pool, RowDataPacket } from 'mysql2/promise';
import { createPool, type DatabaseConfig } from '../../src/db';
import { runMigrations } from '../../src/migrations';

const DEFAULT_TEST_DATABASE_URL = 'mysql://temp:temp@127.0.0.1:3307/temperature_alarms_test';

/** Database the tests run against: TEST_DATABASE_URL, or the Docker Compose one. */
export function testDatabaseConfig(): DatabaseConfig {
  const url = new URL(process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
  };
}

export function createTestPool(): Pool {
  return createPool(testDatabaseConfig());
}

/** Every table in the connected database, sorted by name. */
export async function tableNames(pool: Pool): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name',
  );
  return rows.map((r) => r.name as string);
}

/** Drop every table in the test database and rebuild the schema through the migration runner. */
export async function resetDatabase(pool: Pool): Promise<void> {
  const { database, host, port } = testDatabaseConfig();
  if (!/test/i.test(database)) {
    throw new Error(`Refusing to drop every table in "${database}": the test database name must contain "test"`);
  }
  let connection;
  try {
    connection = await pool.getConnection();
  } catch (error) {
    throw new Error(
      `Cannot reach the test database at ${host}:${port}. Start it with \`npm run test:db\` or set TEST_DATABASE_URL.`,
      { cause: error },
    );
  }
  try {
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const name of await tableNames(pool)) {
      await connection.query(`DROP TABLE IF EXISTS \`${name}\``);
    }
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    connection.release();
  }
  await runMigrations(pool);
}
