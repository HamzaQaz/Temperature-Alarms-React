import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'mysql2/promise';
import { createTestPool, resetDatabase, testDatabaseConfig } from './helpers/database';
import { startServer, type RunningServer } from './helpers/server';
import { createPool } from '../src/db';

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
