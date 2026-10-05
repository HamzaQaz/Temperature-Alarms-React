import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'mysql2/promise';
import { createTestPool, resetDatabase, testDatabaseConfig } from './helpers/database';
import { startServer, type RunningServer } from './helpers/server';
import { createPool } from '../src/db';
import { api, asDevice } from './helpers/api';

describe('GET /api/health', () => {
  let pool: Pool;
  let server: RunningServer;

  before(async () => {
    pool = createTestPool();
    await resetDatabase(pool);
    server = await startServer(pool);
  });
  after(async () => {
    await server.close();
    await pool.end();
  });

  test('reports the database as connected', async () => {
    const response = await fetch(`${server.url}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok', database: 'connected' });
  });

  test('responds with JSON content type', async () => {
    const response = await fetch(`${server.url}/api/health`);
    assert.match(response.headers.get('content-type') ?? '', /application\/json/);
  });

  test('unknown routes return a JSON 404', async () => {
    const response = await fetch(`${server.url}/api/nope`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Not found' });
  });
});

describe('GET /api/health with an unreachable database', () => {
  let pool: Pool;
  let server: RunningServer;

  before(async () => {
    // Port 1 on loopback refuses immediately; no MySQL listens there.
    pool = createPool({ ...testDatabaseConfig(), host: '127.0.0.1', port: 1 });
    server = await startServer(pool);
  });
  after(async () => {
    await server.close();
    await pool.end();
  });

  test('reports the database as disconnected with 503', async () => {
    const response = await fetch(`${server.url}/api/health`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: 'error', database: 'disconnected' });
  });
});

describe('GET /api/health while Readings cannot be written', () => {
  let pool: Pool;
  let server: RunningServer;
  let client: ReturnType<typeof api>;

  before(async () => {
    pool = createTestPool();
    await resetDatabase(pool);
    server = await startServer(pool);
    client = api(server);
    const campus = await client.campuses.create();
    await client.devices.create(campus.id, 'ESP_A1B2C3');
  });
  after(async () => {
    await pool.query('RENAME TABLE readings_away TO readings').catch(() => undefined);
    await server.close();
    await pool.end();
  });

  test('reports ingest as failing with 503 until a Reading is written again', async () => {
    const post = async () => {
      const response = await client.readings.add({ device: 'ESP_A1B2C3', temp: 70, humidity: 40 }, asDevice());
      await response.arrayBuffer();
      return response.status;
    };
    assert.equal(await post(), 201);
    assert.equal((await fetch(`${server.url}/api/health`)).status, 200);

    // As on a full disk: the database answers SELECT 1, but no Reading can be stored.
    await pool.query('RENAME TABLE readings TO readings_away');
    assert.equal(await post(), 500);
    const failing = await fetch(`${server.url}/api/health`);
    assert.equal(failing.status, 503);
    assert.deepEqual(await failing.json(), { status: 'error', database: 'connected', ingest: 'failing' });

    await pool.query('RENAME TABLE readings_away TO readings');
    assert.equal(await post(), 201);
    const healthy = await fetch(`${server.url}/api/health`);
    assert.equal(healthy.status, 200);
    assert.deepEqual(await healthy.json(), { status: 'ok', database: 'connected' });
  });
});
