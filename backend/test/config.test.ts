import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, ConfigError } from '../src/config';

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
    });
    assert.equal(config.port, 4000);
    assert.equal(config.corsOrigin, 'https://example.test');
    assert.equal(config.database.host, 'db.internal');
    assert.equal(config.database.port, 3307);
    assert.equal(config.reportIntervalSeconds, 60);
    assert.equal(config.retentionDays, 30);
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
