import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'mysql2/promise';
import { createTestPool } from './helpers/database';
import { startServer, type RunningServer } from './helpers/server';

/** Per address per 15 minutes on /api/ (app.ts): reads (GET, HEAD) and everything else apart. */
const READ_LIMIT = 6000;
const WRITE_LIMIT = 500;

describe('general /api/ rate limits behind the proxy', () => {
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
  const throughProxy = async (method: 'GET' | 'POST', claimed: string, seen: string): Promise<number> => {
    const response = await fetch(`${server.url}/api/nothing-here`, { method, headers: { 'X-Forwarded-For': `${claimed}, ${seen}` } });
    await response.arrayBuffer();
    return response.status;
  };

  /** `count` requests from one address, a few at a time, each claiming a different address; returns their statuses. */
  const spend = async (method: 'GET' | 'POST', seen: string, count: number): Promise<number[]> => {
    const statuses: number[] = [];
    for (let i = 0; i < count; i += 50) {
      const batch = Array.from({ length: Math.min(50, count - i) }, (_, j) => throughProxy(method, `10.0.${(i + j) >> 8}.${(i + j) & 255}`, seen));
      statuses.push(...(await Promise.all(batch)));
    }
    return statuses;
  };

  test('changes: a client rotating the X-Forwarded-For it sends is still limited by the address the proxy saw', async () => {
    const statuses = await spend('POST', '203.0.113.7', WRITE_LIMIT);
    assert.deepEqual(statuses.filter((s) => s !== 404), [], 'every request within the allowance reaches the router');
    assert.equal(await throughProxy('POST', '10.9.9.9', '203.0.113.7'), 429);

    // Another address the proxy saw has its own allowance.
    assert.equal(await throughProxy('POST', '10.0.0.1', '203.0.113.8'), 404);
  });

  test('reads: an office of open tabs behind one address gets far more than the change allowance, and is still capped', async () => {
    const statuses = await spend('GET', '203.0.113.20', READ_LIMIT);
    assert.deepEqual(statuses.filter((s) => s !== 404), [], 'every read within the allowance reaches the router');
    assert.equal(await throughProxy('GET', '10.9.9.9', '203.0.113.20'), 429);
    assert.equal(await throughProxy('GET', '10.0.0.1', '203.0.113.21'), 404, 'another address has its own read allowance');
  });

  test('reads and changes are counted apart: spent reads leave changes open, spent changes leave reads open', async () => {
    // 203.0.113.20 spent its reads above; 203.0.113.7 spent its changes.
    assert.equal(await throughProxy('POST', '10.0.0.1', '203.0.113.20'), 404);
    assert.equal(await throughProxy('GET', '10.0.0.1', '203.0.113.7'), 404);
  });
});
