import dotenv from 'dotenv';
import { createApp } from './app';
import { loadConfig, ConfigError, tokenWarnings } from './config';
import { createPool } from './db';
import { migrationContext, runMigrations } from './migrations';
import { startRetentionJob } from './retention';
import { startOfflineSweep } from './offlineSweep';
import { createBroadcaster } from './sse';
import { createListening } from './listening';
import { createMailer } from './mailer';
import { startNotifier } from './notifier';

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
  if (config.deviceTokenPrevious !== undefined) {
    console.log('Device token rotation under way: Readings with DEVICE_TOKEN_PREVIOUS are accepted until it is cleared (Settings lists the Devices still on it)');
  }

  const pool = createPool(config.database);
  const applied = await runMigrations(pool, { context: migrationContext(config) });
  if (applied.length > 0) console.log(`Applied migrations: ${applied.join(', ')}`);

  // One client set, shared by the routes and the Offline sweep, so both reach every dashboard.
  const sse = createBroadcaster();
  // The server hears Devices from now; their silence while it was down is not theirs (listening.ts).
  const listening = createListening(new Date());
  // One relay client, shared by the Settings test button and the sender.
  const mailer = config.notifications === undefined ? undefined : createMailer(config.notifications);
  const app = createApp({ config, pool, sse, listening, mailer });
  app.listen(config.port, () => {
    console.log(`Server is running on port ${config.port}`);
  });
  startRetentionJob({ config, pool });
  startOfflineSweep({ config, pool, sse, listening });
  // Ingest and the sweep queue Incident emails in the outbox; the sender delivers them (docs/adr/0008).
  // A pass cut short by a restart rolls back, and its rows go out from the next process.
  if (mailer !== undefined) {
    startNotifier({ config, pool, mailer });
    console.log(`Email notifications on: Incidents are sent to ${config.notifications?.to.join(', ')}`);
  }
}

main().catch((error) => {
  console.error('Failed to start:', error instanceof Error ? error.message : error);
  process.exit(1);
});
