import dotenv from 'dotenv';
import { createApp } from './app';
import { loadConfig, ConfigError, tokenWarnings } from './config';
import { createPool } from './db';
import { migrationContext, runMigrations } from './migrations';
import { startRetentionJob } from './retention';
import { startOfflineSweep } from './offlineSweep';
import { createBroadcaster } from './sse';
import { createListening } from './listening';

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

  for (const warning of tokenWarnings(config)) console.warn(`Warning: ${warning}`);

  const pool = createPool(config.database);
  const applied = await runMigrations(pool, { context: migrationContext(config) });
  if (applied.length > 0) console.log(`Applied migrations: ${applied.join(', ')}`);

  // One client set, shared by the routes and the Offline sweep, so both reach every dashboard.
  const sse = createBroadcaster();
  // The server hears Devices from now; their silence while it was down is not theirs (listening.ts).
  const listening = createListening(new Date());
  const app = createApp({ config, pool, sse, listening });
  app.listen(config.port, () => {
    console.log(`Server is running on port ${config.port}`);
  });
  startRetentionJob({ config, pool });
  startOfflineSweep({ config, pool, sse, listening });
}

main().catch((error) => {
  console.error('Failed to start:', error instanceof Error ? error.message : error);
  process.exit(1);
});
