import dotenv from 'dotenv';
import { loadConfig, ConfigError } from './config';
import { createPool } from './db';
import { migrationContext } from './migrations';
import { legacyCampusesAndDevices } from './migrations/0002-legacy-campuses-and-devices';
import { legacyReadings } from './migrations/0003-legacy-readings';

dotenv.config();

/**
 * Run the guarded legacy migrations again by hand (`npm run migrate:legacy`), for rows an old
 * writer added to a per-Device table after the backend first started. The runner applies each
 * migration once; these two are safe to repeat and copy only what is new (DEPLOYMENT.md).
 */
async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`Configuration error: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
  const pool = createPool(config.database);
  const conn = await pool.getConnection();
  try {
    const context = migrationContext(config);
    await legacyCampusesAndDevices.up(conn, context);
    await legacyReadings.up(conn, context);
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Legacy migration failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
