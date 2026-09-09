import dotenv from 'dotenv';
import { createApp } from './app';
import { loadConfig, ConfigError } from './config';
import { createPool } from './db';
import { migrationContext, runMigrations } from './migrations';
import { startRetentionJob } from './retention';

dotenv.config();

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`Configuration error: ${error.message}`);
      console.error('See .env.example for every variable the backend reads.');
      process.exit(1);
    }
    throw error;
  }

  const pool = createPool(config.database);
  const applied = await runMigrations(pool, { context: migrationContext(config) });
  if (applied.length > 0) console.log(`Applied migrations: ${applied.join(', ')}`);

  const app = createApp({ config, pool });
  app.listen(config.port, () => {
    console.log(`Server is running on port ${config.port}`);
  });
  startRetentionJob({ config, pool });
}

main().catch((error) => {
  console.error('Failed to start:', error instanceof Error ? error.message : error);
  process.exit(1);
});
