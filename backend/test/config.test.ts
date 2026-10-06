import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, ConfigError, MIN_TOKEN_LENGTH, tokenWarnings } from '../src/config';
import { DEFAULT_THRESHOLDS } from '../src/conditions';

const complete = {
  DB_USER: 'temp',
  DB_PASSWORD: 'secret',
  DB_NAME: 'temperature_alarms',
  ADMIN_TOKEN: 'admin-secret',
  DEVICE_TOKEN: 'device-secret',
};

describe('loadConfig', () => {
  test('reads required values and applies defaults', () => {
    const config = loadConfig(complete);
    assert.equal(config.port, 3001);
    assert.equal(config.corsOrigin, undefined);
    assert.deepEqual(config.database, {
      host: 'localhost',
      port: 3306,
      user: 'temp',
      password: 'secret',
      database: 'temperature_alarms',
    });
    assert.equal(config.adminToken, 'admin-secret');
    assert.equal(config.deviceToken, 'device-secret');
    assert.equal(config.reportIntervalSeconds, 30);
    assert.equal(config.retentionDays, 90);
    assert.deepEqual(config.thresholds, DEFAULT_THRESHOLDS);
    assert.equal(config.legacyTimeZone, Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  test('honours every optional override', () => {
    const config = loadConfig({
      ...complete,
      PORT: '4000',
      CORS_ORIGIN: 'https://example.test',
      DB_HOST: 'db.internal',
      DB_PORT: '3307',
      REPORT_INTERVAL_SECONDS: '60',
      RETENTION_DAYS: '30',
      HOT_WARNING_F: '80',
      HOT_CRITICAL_F: '95',
      COLD_WARNING_F: '-10',
      DRY_WARNING_PERCENT: '25',
      MISSED_REPORTS_BEFORE_OFFLINE: '5',
      LEGACY_TIME_ZONE: 'America/Chicago',
    });
    assert.equal(config.port, 4000);
    assert.equal(config.corsOrigin, 'https://example.test');
    assert.equal(config.database.host, 'db.internal');
    assert.equal(config.database.port, 3307);
    assert.equal(config.reportIntervalSeconds, 60);
    assert.equal(config.retentionDays, 30);
    assert.deepEqual(config.thresholds, { hotWarningF: 80, hotCriticalF: 95, coldWarningF: -10, dryWarningPercent: 25, missedReportsBeforeOffline: 5 });
    assert.equal(config.legacyTimeZone, 'America/Chicago');
  });

  test('rejects a legacy time zone the runtime does not know', () => {
    assert.throws(() => loadConfig({ ...complete, LEGACY_TIME_ZONE: 'Chicago' }), /LEGACY_TIME_ZONE/);
  });

  test('rejects thresholds that are not integers or are out of order', () => {
    assert.throws(() => loadConfig({ ...complete, HOT_WARNING_F: 'warm' }), /HOT_WARNING_F/);
    assert.throws(() => loadConfig({ ...complete, MISSED_REPORTS_BEFORE_OFFLINE: '0' }), /MISSED_REPORTS_BEFORE_OFFLINE/);
    assert.throws(() => loadConfig({ ...complete, HOT_CRITICAL_F: '82' }), /HOT_CRITICAL_F \(82\) must be above HOT_WARNING_F \(82\)/);
    assert.throws(() => loadConfig({ ...complete, COLD_WARNING_F: '82' }), /COLD_WARNING_F \(82\) must be below HOT_WARNING_F \(82\)/);
  });

  test('names every missing required variable in one message', () => {
    assert.throws(
      () => loadConfig({ DB_USER: 'temp', DB_NAME: 'x' }),
      (err: unknown) =>
        err instanceof ConfigError &&
        /DB_PASSWORD/.test(err.message) &&
        /ADMIN_TOKEN/.test(err.message) &&
        /DEVICE_TOKEN/.test(err.message),
    );
  });

  test('treats an empty string as missing', () => {
    assert.throws(() => loadConfig({ ...complete, ADMIN_TOKEN: '   ' }), /ADMIN_TOKEN/);
  });

  test('refuses an Admin token equal to the Device token: every board would carry the Admin token in its flash', () => {
    assert.throws(
      () => loadConfig({ ...complete, ADMIN_TOKEN: 'same-secret-value', DEVICE_TOKEN: 'same-secret-value' }),
      (err: unknown) => err instanceof ConfigError && /ADMIN_TOKEN/.test(err.message) && /DEVICE_TOKEN/.test(err.message) && !/same-secret-value/.test(err.message),
    );
  });

  test('DEVICE_TOKEN_PREVIOUS is optional, and read when set (a rotation under way)', () => {
    assert.equal(loadConfig(complete).deviceTokenPrevious, undefined);
    assert.equal(loadConfig({ ...complete, DEVICE_TOKEN_PREVIOUS: '  ' }).deviceTokenPrevious, undefined);
    assert.equal(loadConfig({ ...complete, DEVICE_TOKEN_PREVIOUS: 'old-device-secret' }).deviceTokenPrevious, 'old-device-secret');
  });

  test('refuses a DEVICE_TOKEN_PREVIOUS equal to the Device token or the Admin token, never printing it', () => {
    assert.throws(
      () => loadConfig({ ...complete, DEVICE_TOKEN_PREVIOUS: 'device-secret' }),
      (err: unknown) => err instanceof ConfigError && /DEVICE_TOKEN_PREVIOUS/.test(err.message) && /DEVICE_TOKEN\b/.test(err.message) && !/device-secret/.test(err.message),
    );
    assert.throws(
      () => loadConfig({ ...complete, DEVICE_TOKEN_PREVIOUS: 'admin-secret' }),
      (err: unknown) => err instanceof ConfigError && /DEVICE_TOKEN_PREVIOUS/.test(err.message) && /ADMIN_TOKEN/.test(err.message) && !/admin-secret/.test(err.message),
    );
  });

  test('warns about a token too short to resist guessing, naming it but never printing it', () => {
    const strong = 'a'.repeat(MIN_TOKEN_LENGTH);
    assert.deepEqual(tokenWarnings(loadConfig({ ...complete, ADMIN_TOKEN: strong, DEVICE_TOKEN: `b${strong}` })), []);
    const warnings = tokenWarnings(loadConfig(complete));
    assert.equal(warnings.length, 2);
    assert.match(warnings[0], /ADMIN_TOKEN/);
    assert.match(warnings[1], /DEVICE_TOKEN/);
    for (const warning of warnings) assert.ok(!warning.includes('admin-secret') && !warning.includes('device-secret'), warning);
    const rotating = tokenWarnings(loadConfig({ ...complete, ADMIN_TOKEN: strong, DEVICE_TOKEN: `b${strong}`, DEVICE_TOKEN_PREVIOUS: 'old' }));
    assert.equal(rotating.length, 1);
    assert.match(rotating[0], /DEVICE_TOKEN_PREVIOUS/);
  });

  test('rejects a non-numeric or non-positive number', () => {
    assert.throws(() => loadConfig({ ...complete, PORT: 'abc' }), /PORT/);
    assert.throws(() => loadConfig({ ...complete, RETENTION_DAYS: '0' }), /RETENTION_DAYS/);
  });
});

describe('startup', () => {
  test('exits with a clear message when required config is missing', () => {
    const backendDir = path.resolve(__dirname, '..');
    const result = spawnSync(
      process.execPath,
      ['--require', 'ts-node/register/transpile-only', path.join(backendDir, 'src', 'index.ts')],
      {
        // A directory with no .env so dotenv cannot fill in the blanks.
        cwd: os.tmpdir(),
        env: {
          PATH: process.env.PATH ?? '',
          NODE_PATH: path.join(backendDir, 'node_modules'),
          TS_NODE_PROJECT: path.join(backendDir, 'tsconfig.json'),
          DB_USER: 'temp',
          DB_NAME: 'temperature_alarms',
        },
        encoding: 'utf8',
        timeout: 30_000,
      },
    );
    assert.equal(result.status, 1, `stderr was: ${result.stderr}`);
    assert.match(result.stderr, /DB_PASSWORD/);
    assert.match(result.stderr, /ADMIN_TOKEN/);
    assert.match(result.stderr, /DEVICE_TOKEN/);
  });
});
