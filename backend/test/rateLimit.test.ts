import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'mysql2/promise';
import { createTestPool } from './helpers/database';
import { startServer, type RunningServer } from './helpers/server';

/** The general per-address allowance on /api/ (app.ts). */
const GENERAL_LIMIT = 500;

describe('general /api/ rate limit behind the proxy', () => {
  let pool: Pool;
  let server: RunningServer;

  before(async () => {
    pool = createTestPool();
    server = await startServer(pool);
  });
  after(async () => {
    await server.close();
    await pool.end();
  });

  // As nginx sends it: `$proxy_add_x_forwarded_for` appends the address it saw to whatever the client claimed.
  const throughProxy = (claimed: string, seen: string) => fetch(`${server.url}/api/nothing-here`, { headers: { 'X-Forwarded-For': `${claimed}, ${seen}` } });

  test('a client rotating the X-Forwarded-For it sends is still limited by the address the proxy saw', async () => {
    for (let i = 0; i < GENERAL_LIMIT; i++) {
      const response = await throughProxy(`10.0.${i >> 8}.${i & 255}`, '203.0.113.7');
      assert.equal(response.status, 404, `request ${i + 1}`);
      await response.arrayBuffer();
    }
    const limited = await throughProxy('10.9.9.9', '203.0.113.7');
    assert.equal(limited.status, 429);
    await limited.arrayBuffer();

    // Another address the proxy saw has its own allowance.
    const other = await throughProxy('10.0.0.1', '203.0.113.8');
    assert.equal(other.status, 404);
    await other.arrayBuffer();
  });
});
