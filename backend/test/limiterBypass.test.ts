import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'mysql2/promise';
import { READ_LIMIT, WRITE_LIMIT } from '../src/app';
import { createTestPool } from './helpers/database';
import { startServer, TEST_DEVICE_TOKEN, type RunningServer } from './helpers/server';

/**
 * The general /api/ limits (app.ts) cannot be stepped around by spelling a path or a method
 * differently: once an address has spent an allowance, every spelling that reaches a route is
 * refused, and every spelling that is not refused reaches no route at all.
 */
describe('the general /api/ limits have no way around them', () => {
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

  const send = async (method: string, path: string, seen: string, headers: Record<string, string> = {}): Promise<number> => {
    const response = await fetch(`${server.url}${path}`, { method, headers: { 'X-Forwarded-For': seen, ...headers } });
    await response.arrayBuffer();
    return response.status;
  };

  const spend = async (method: string, seen: string, count: number): Promise<void> => {
    for (let i = 0; i < count; i += 100) {
      const batch = Array.from({ length: Math.min(100, count - i) }, () => send(method, '/api/nothing-here', seen));
      const statuses = await Promise.all(batch);
      assert.deepEqual(
        statuses.filter((s) => s !== 404),
        [],
        `${method}: every request within the allowance reaches the router`,
      );
    }
  };

  test('changes: past the allowance, every spelling of a change route is refused', async () => {
    const seen = '203.0.113.40';
    await spend('POST', seen, WRITE_LIMIT);
    for (const [method, path] of [
      ['POST', '/api/campuses'],
      ['POST', '/API/campuses'],
      ['POST', '/Api/Campuses/'],
      ['POST', '/api/campuses/'],
      ['POST', '/api/campuses?x=1'],
      ['DELETE', '/api/campuses/1'],
      ['PATCH', '/api/devices/1'],
      ['PUT', '/api/campuses/1'],
      // Only POST /readings exactly skips the general limit, and it has the Device token gate of its own.
      ['POST', '/api/readings/'],
      ['POST', '/api/Readings'],
      ['POST', '/api/%72eadings'],
    ] as const) {
      assert.equal(await send(method, path, seen), 429, `${method} ${path}`);
    }
  });

  test('reads: past the allowance, GET and HEAD in every spelling are refused', async () => {
    const seen = '203.0.113.41';
    // HEAD counts as a read: spending the allowance with HEAD leaves no GET.
    await spend('HEAD', seen, READ_LIMIT);
    for (const [method, path] of [
      ['GET', '/api/campuses'],
      ['GET', '/API/CAMPUSES'],
      ['GET', '/api/campuses/'],
      ['GET', '/api//campuses'],
      ['GET', '/api/health'],
      ['GET', '/api/dashboard/stream'],
      ['HEAD', '/api/campuses'],
      ['GET', '/api/devices/1/history'],
      ['GET', '/api/devices%2F1%2Fhistory'],
    ] as const) {
      assert.equal(await send(method, path, seen), 429, `${method} ${path}`);
    }
  });

  test('a path the limits do not see reaches no route either', async () => {
    const seen = '203.0.113.41';
    // Outside the /api/ mount, so not counted, and not routed: the catch-all 404, with no query run.
    for (const path of ['//api/campuses', '//api/devices/1/history', '/apix/campuses']) {
      assert.equal(await send('GET', path, seen), 404, `GET ${path}`);
    }
  });

  test('a preflight (OPTIONS) is answered by CORS before any route, so it needs no allowance', async () => {
    const seen = '203.0.113.40';
    const status = await send('OPTIONS', '/api/campuses', seen, {
      Origin: server.url,
      'Access-Control-Request-Method': 'POST',
    });
    assert.equal(status, 204);
  });

  test('the right Device token is not refused by the general change allowance being spent', async () => {
    // 203.0.113.40 has spent its changes above; Readings are limited per Device instead (readings.ts).
    const status = await send('POST', '/api/readings', '203.0.113.40', {
      Authorization: `Bearer ${TEST_DEVICE_TOKEN}`,
      'Content-Type': 'application/json',
    });
    assert.notEqual(status, 429);
  });
});
