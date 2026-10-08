import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { createTestPool, dropAllTables, resetDatabase, tableNames } from './helpers/database';
import { MigrationLockError, runLegacyMigrations, runMigrations, withMigrationLock, type MigrationContext } from '../src/migrations';

let pool: Pool;
let log: string[];
let context: MigrationContext;

before(() => {
  pool = createTestPool();
});
after(() => pool.end());
beforeEach(() => {
  log = [];
  context = { legacyTimeZone: 'America/Chicago', log: (line) => log.push(line) };
});

/** The PHP-era per-Device table, exactly as the old backends created it; HUMIDITY was added later by hand. */
const LEGACY_DEVICE_TABLE = (name: string, withHumidity: boolean) => `
  CREATE TABLE \`${name}\` (
    \`ID\` int NOT NULL AUTO_INCREMENT,
    \`CAMPUS\` varchar(20) NOT NULL,
    \`LOCATION\` varchar(20) NOT NULL,
    \`DATE\` varchar(20) NOT NULL,
    \`TIME\` varchar(20) NOT NULL,
    \`TEMP\` int NOT NULL,
    ${withHumidity ? '`HUMIDITY` int DEFAULT NULL,' : ''}
    PRIMARY KEY (\`ID\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3`;

/**
 * A production database as the PHP era and the first Node backend left it: `devices`,
 * `locations`, and `alarms` from the phpMyAdmin dump, and one table per Device.
 */
async function buildLegacyDatabase(): Promise<void> {
  await dropAllTables(pool);
  await pool.query(`
    CREATE TABLE \`devices\` (
      \`ID\` int NOT NULL AUTO_INCREMENT,
      \`Name\` varchar(255) DEFAULT NULL,
      \`Campus\` varchar(20) NOT NULL,
      \`Location\` varchar(20) NOT NULL,
      PRIMARY KEY (\`ID\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3`);
  await pool.query(`
    CREATE TABLE \`locations\` (
      \`ID\` int NOT NULL AUTO_INCREMENT,
      \`NAME\` varchar(255) NOT NULL,
      \`SHORTCODE\` varchar(255) NOT NULL,
      PRIMARY KEY (\`ID\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3`);
  await pool.query(`
    CREATE TABLE \`alarms\` (
      \`ID\` int NOT NULL AUTO_INCREMENT,
      \`EMAIL\` varchar(255) DEFAULT NULL,
      \`TEMP\` int DEFAULT NULL,
      PRIMARY KEY (\`ID\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3`);
  await pool.query("INSERT INTO locations (NAME, SHORTCODE) VALUES ('Central High', 'CHS'), ('West Middle', 'wms')");
  await pool.query(`INSERT INTO devices (Name, Campus, Location) VALUES
    ('ESP_2EB804', 'CHS', 'IDF 2'),
    ('ESP_A1B2C3', 'wms', 'MDF'),
    ('ESP_FFFFFF', 'NOPE', 'IDF 1')`);
  await pool.query("INSERT INTO alarms (EMAIL, TEMP) VALUES ('ops@example.test', 85)");

  // PHP era: m/d/Y, g:i:s A, no humidity; then a Node-era row with the narrow no-break space.
  await pool.query(LEGACY_DEVICE_TABLE('ESP_2EB804', false));
  await pool.query(`INSERT INTO \`ESP_2EB804\` (CAMPUS, LOCATION, DATE, TIME, TEMP) VALUES
    ('CHS', 'IDF 2', '01/05/2024', '3:07:09 PM', 68),
    ('CHS', 'IDF 2', '01/05/2024', '3:07:39 PM', 69),
    ('CHS', 'IDF 2', 'not a date', '3:08:09 PM', 70),
    ('CHS', 'IDF 2', '7/4/2024', '12:00:00 PM', 75)`);

  // Node era with humidity: en-US toLocaleDateString and toLocaleTimeString.
  await pool.query(LEGACY_DEVICE_TABLE('ESP_A1B2C3', true));
  await pool.query(`INSERT INTO \`ESP_A1B2C3\` (CAMPUS, LOCATION, DATE, TIME, TEMP, HUMIDITY) VALUES
    ('wms', 'MDF', '7/4/2024', '3:07:09 PM', 72, 40),
    ('wms', 'MDF', '7/4/2024', '3:07:39 PM', 72, NULL),
    ('wms', 'MDF', '7/4/2024', 'noon', 72, 41)`);

  // A table for a Device that was deleted from `devices` but whose table was never dropped.
  await pool.query(LEGACY_DEVICE_TABLE('ESP_DEAD01', false));
  await pool.query("INSERT INTO `ESP_DEAD01` (CAMPUS, LOCATION, DATE, TIME, TEMP) VALUES ('CHS', 'IDF 9', '01/05/2024', '3:07:09 PM', 60)");
}

interface Reading {
  hostname: string;
  tempF: number;
  humidity: number | null;
  recordedAt: string;
}

async function readings(): Promise<Reading[]> {
  const [rows] = await pool.query<RowDataPacket[]>(`
    SELECT d.hostname, r.temp_f AS tempF, r.humidity, r.recorded_at AS recordedAt
      FROM readings r JOIN devices d ON d.id = r.device_id
     ORDER BY d.hostname, r.recorded_at`);
  return rows.map((r) => ({ ...r, recordedAt: (r.recordedAt as Date).toISOString() }) as Reading);
}

async function count(table: string): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM \`${table}\``);
  return rows[0].n as number;
}

/** What `npm run migrate:legacy` does. */
const rerunLegacyMigrations = (): Promise<void> => runLegacyMigrations(pool, { context });

describe('upgrading a production database', () => {
  beforeEach(async () => {
    await buildLegacyDatabase();
    await runMigrations(pool, { context });
  });

  test('moves the PHP-era devices and locations aside and builds the new schema beside them', async () => {
    assert.deepEqual(await tableNames(pool), [
      'ESP_2EB804',
      'ESP_A1B2C3',
      'ESP_DEAD01',
      'alarms',
      'campuses',
      'devices',
      'firmware_release',
      'incident_segments',
      'incidents',
      'last_backup',
      'legacy_devices',
      'legacy_locations',
      'legacy_readings_progress',
      'notifications',
      'pending_devices',
      'readings',
      'schema_migrations',
    ]);
    assert.equal(await count('legacy_devices'), 3);
    assert.equal(await count('legacy_locations'), 2);
  });

  test('copies locations into campuses and devices into devices, skipping a device whose campus is unknown', async () => {
    const [campuses] = await pool.query<RowDataPacket[]>('SELECT name, shortcode FROM campuses ORDER BY shortcode');
    assert.deepEqual(campuses.map((c) => [c.name, c.shortcode]), [['Central High', 'CHS'], ['West Middle', 'WMS']]);

    const [devices] = await pool.query<RowDataPacket[]>(
      'SELECT d.hostname, d.closet, c.shortcode FROM devices d JOIN campuses c ON c.id = d.campus_id ORDER BY d.hostname',
    );
    assert.deepEqual(devices.map((d) => [d.hostname, d.closet, d.shortcode]), [['ESP_2EB804', 'IDF 2', 'CHS'], ['ESP_A1B2C3', 'MDF', 'WMS']]);
    assert.ok(log.some((line) => /ESP_FFFFFF/.test(line) && /NOPE/.test(line)), `expected the skipped device in the log:\n${log.join('\n')}`);
  });

  test('lands every parseable row in readings with the right UTC instant and humidity', async () => {
    assert.deepEqual(await readings(), [
      { hostname: 'ESP_2EB804', tempF: 68, humidity: null, recordedAt: '2024-01-05T21:07:09.000Z' },
      { hostname: 'ESP_2EB804', tempF: 69, humidity: null, recordedAt: '2024-01-05T21:07:39.000Z' },
      { hostname: 'ESP_2EB804', tempF: 75, humidity: null, recordedAt: '2024-07-04T17:00:00.000Z' },
      { hostname: 'ESP_A1B2C3', tempF: 72, humidity: 40, recordedAt: '2024-07-04T20:07:09.000Z' },
      { hostname: 'ESP_A1B2C3', tempF: 72, humidity: null, recordedAt: '2024-07-04T20:07:39.000Z' },
    ]);
  });

  test('logs each unreadable row with its table and id, and the table with no device, without aborting', async () => {
    assert.ok(log.some((line) => /ESP_2EB804/.test(line) && /\b3\b/.test(line) && /not a date/.test(line)), log.join('\n'));
    assert.ok(log.some((line) => /ESP_A1B2C3/.test(line) && /\b3\b/.test(line) && /noon/.test(line)), log.join('\n'));
    assert.ok(log.some((line) => /ESP_DEAD01/.test(line) && /no device/i.test(line)), log.join('\n'));
    assert.ok(log.some((line) => /ESP_2EB804/.test(line) && /copied 3/.test(line) && /skipped 1/.test(line)), log.join('\n'));
  });

  test('leaves every legacy table and its rows in place', async () => {
    assert.equal(await count('ESP_2EB804'), 4);
    assert.equal(await count('ESP_A1B2C3'), 3);
    assert.equal(await count('ESP_DEAD01'), 1);
    assert.equal(await count('alarms'), 1);
  });

  test('running the legacy migrations again copies nothing twice', async () => {
    await rerunLegacyMigrations();
    assert.equal((await readings()).length, 5);
    assert.equal(await count('campuses'), 2);
    assert.equal(await count('devices'), 2);
  });

  test('two runs at once copy each new row once', async () => {
    await pool.query("INSERT INTO `ESP_2EB804` (CAMPUS, LOCATION, DATE, TIME, TEMP) VALUES ('CHS', 'IDF 2', '7/5/2024', '1:00:00 AM', 66)");
    await Promise.all([rerunLegacyMigrations(), rerunLegacyMigrations()]);
    assert.equal((await readings()).length, 6);
  });

  test('a run by hand while another runner holds the lock gives up and copies nothing', async () => {
    await pool.query("INSERT INTO `ESP_2EB804` (CAMPUS, LOCATION, DATE, TIME, TEMP) VALUES ('CHS', 'IDF 2', '7/5/2024', '1:00:00 AM', 66)");
    const conn = await pool.getConnection();
    try {
      await withMigrationLock(conn, async () => {
        await assert.rejects(runLegacyMigrations(pool, { context, lockWaitSeconds: 1 }), MigrationLockError);
      });
    } finally {
      conn.release();
    }
    assert.equal((await readings()).length, 5);
  });

  test('a later run picks up only rows added to a legacy table since', async () => {
    await pool.query("INSERT INTO `ESP_2EB804` (CAMPUS, LOCATION, DATE, TIME, TEMP) VALUES ('CHS', 'IDF 2', '7/5/2024', '1:00:00 AM', 66)");
    await rerunLegacyMigrations();
    const all = await readings();
    assert.equal(all.length, 6);
    assert.ok(all.some((r) => r.hostname === 'ESP_2EB804' && r.tempF === 66 && r.recordedAt === '2024-07-05T06:00:00.000Z'));
  });

  test('the migration runner records every migration as applied', async () => {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT id FROM schema_migrations ORDER BY id');
    assert.deepEqual(rows.map((r) => r.id), [
      '0000-legacy-tables-aside',
      '0001-initial-schema',
      '0002-legacy-campuses-and-devices',
      '0003-legacy-readings',
      '0004-readings-recorded-at-index',
      '0005-incidents',
      '0006-readings-covering-index',
      '0007-firmware',
      '0008-pending-devices',
      '0009-device-info',
      '0010-device-reports',
      '0011-notifications',
      '0012-incident-acknowledgement',
      '0013-incident-reminders',
      '0015-staged-rollout',
      '0016-device-sensor',
      '0018-system-health',
    ]);
  });
});

describe('a database that never had legacy tables', () => {
  test('gets only the new schema tables and no progress bookkeeping', async () => {
    await resetDatabase(pool);
    assert.deepEqual(await tableNames(pool), ['campuses', 'devices', 'firmware_release', 'incident_segments', 'incidents', 'last_backup', 'notifications', 'pending_devices', 'readings', 'schema_migrations']);
  });

  test('a device table that appears later is still picked up by the guarded migration', async () => {
    await resetDatabase(pool);
    await pool.query("INSERT INTO campuses (name, shortcode) VALUES ('Central High', 'CHS')");
    await pool.query("INSERT INTO devices (hostname, campus_id, closet) VALUES ('ESP_2EB804', 1, 'IDF 2')");
    await pool.query(LEGACY_DEVICE_TABLE('ESP_2EB804', false));
    await pool.query("INSERT INTO `ESP_2EB804` (CAMPUS, LOCATION, DATE, TIME, TEMP) VALUES ('CHS', 'IDF 2', '01/05/2024', '3:07:09 PM', 68)");
    await rerunLegacyMigrations();
    assert.deepEqual(await readings(), [{ hostname: 'ESP_2EB804', tempF: 68, humidity: null, recordedAt: '2024-01-05T21:07:09.000Z' }]);
  });
});
