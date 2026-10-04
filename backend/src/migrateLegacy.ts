import dotenv from 'dotenv';
import { loadConfig, ConfigError } from './config';
import { createPool } from './db';
import { migrationContext, runLegacyMigrations } from './migrations';

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
  try {
    // Under the runner's lock: if the backend is still migrating at startup, this waits for it.
    await runLegacyMigrations(pool, { context: migrationContext(config) });
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Legacy migration failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
