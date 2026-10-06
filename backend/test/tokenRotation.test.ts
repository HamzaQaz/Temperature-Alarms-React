import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'mysql2/promise';
import { createTestPool, resetDatabase } from './helpers/database';
import { startServer, testConfig, TEST_ADMIN_TOKEN, TEST_DEVICE_TOKEN, type RunningServer } from './helpers/server';
import { api, asAdmin, asDevice, json, type Device } from './helpers/api';
import { DEVICE_AUTH_FAILURE_LIMIT } from '../src/routes/readings';
import { createTokenRotation, PREVIOUS_TOKEN_LOG_INTERVAL_MS } from '../src/tokenRotation';

const PREVIOUS = 'test-device-token-previous';

const bearer = (token: string, address?: string): RequestInit => ({
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    ...(address === undefined ? {} : { 'X-Forwarded-For': address }),
  },
});

interface Rotation {
  active: boolean;
  since: string;
  previous: Device[];
  unheard: Device[];
}

describe('Device token rotation (DEVICE_TOKEN_PREVIOUS)', () => {
  let pool: Pool;
  let server: RunningServer;
  let client: ReturnType<typeof api>;
  let logged: string[];
  let clock: Date;

  before(() => {
    pool = createTestPool();
  });
  beforeEach(async () => {
    await resetDatabase(pool);
    logged = [];
    clock = new Date('2026-10-06T12:00:00Z');
    const rotation = createTokenRotation({ now: () => clock, log: (line) => logged.push(line) });
    server = await startServer(pool, testConfig({ deviceTokenPrevious: PREVIOUS }), { rotation });
    client = api(server);
  });
  afterEach(() => server.close());
  after(() => pool.end());

  const post = async (hostname: string, token: string, address?: string): Promise<number> => {
    const response = await client.readings.add({ device: hostname, temp: 70, humidity: 40 }, bearer(token, address));
    await response.arrayBuffer();
    return response.status;
  };
  const rotation = async (init: RequestInit = asAdmin()): Promise<Response> => fetch(client.devices.url('/rotation'), init);

  test('a Reading with the current token or the previous one is recorded', async () => {
    const campus = await client.campuses.create();
    await client.devices.create(campus.id, 'ESP_000001');
    await client.devices.create(campus.id, 'ESP_000002');
    assert.equal(await post('ESP_000001', TEST_DEVICE_TOKEN), 201);
    assert.equal(await post('ESP_000002', PREVIOUS), 201);
  });

  test('a third token is refused and counted toward the wrong-token limit; the previous token never is', async () => {
    const campus = await client.campuses.create();
    // More boards behind one address than the limit, all still on the previous token.
    const hostnames = Array.from({ length: DEVICE_AUTH_FAILURE_LIMIT + 5 }, (_, i) => `ESP_${(0xd00000 + i).toString(16).toUpperCase()}`);
    for (const hostname of hostnames) await client.devices.create(campus.id, hostname);
    for (const hostname of hostnames) assert.equal(await post(hostname, PREVIOUS, '198.51.100.20'), 201, hostname);

    for (let i = 0; i < DEVICE_AUTH_FAILURE_LIMIT; i++) {
      assert.equal(await post(hostnames[0], `third-token-${i}`, '203.0.113.20'), 401, `guess ${i + 1}`);
    }
    assert.equal(await post(hostnames[0], 'third-token-x', '203.0.113.20'), 429);
    // Past the limit, neither the current nor the previous token tells a guesser anything from that address.
    assert.equal(await post(hostnames[1], PREVIOUS, '203.0.113.20'), 429);
    assert.equal(await post(hostnames[2], TEST_DEVICE_TOKEN, '203.0.113.20'), 429);
  });

  test('the Admin token is not a Device token, and the Device tokens do not open the rotation list', async () => {
    const campus = await client.campuses.create();
    await client.devices.create(campus.id, 'ESP_000001');
    assert.equal(await post('ESP_000001', TEST_ADMIN_TOKEN), 401);
    for (const init of [{}, asDevice(), bearer(PREVIOUS)]) {
      const response = await rotation(init);
      assert.equal(response.status, 401);
      await response.arrayBuffer();
    }
  });

  test('the Admin sees which Devices still use the previous token and which have not reported since the api started', async () => {
    const campus = await client.campuses.create();
    await client.devices.create(campus.id, 'ESP_00000A');
    await client.devices.create(campus.id, 'ESP_00000B');
    await client.devices.create(campus.id, 'ESP_00000C');
    assert.equal(await post('ESP_00000A', PREVIOUS), 201);
    assert.equal(await post('ESP_00000B', TEST_DEVICE_TOKEN), 201);

    let response = await rotation();
    assert.equal(response.status, 200);
    let body = await json<Rotation>(response);
    assert.equal(body.active, true);
    assert.equal(body.since, clock.toISOString());
    assert.deepEqual(body.previous.map((d) => d.hostname), ['ESP_00000A']);
    assert.deepEqual(body.previous[0].campus.shortcode, 'CHS');
    assert.deepEqual(body.unheard.map((d) => d.hostname), ['ESP_00000C']);

    // Reflashed: its next Reading carries the new token, and it leaves the list.
    assert.equal(await post('ESP_00000A', TEST_DEVICE_TOKEN), 201);
    assert.equal(await post('ESP_00000C', TEST_DEVICE_TOKEN), 201);
    response = await rotation();
    body = await json<Rotation>(response);
    assert.deepEqual(body.previous, []);
    assert.deepEqual(body.unheard, []);

    // And back on the old binary (a spare swapped in): listed again.
    assert.equal(await post('ESP_00000B', PREVIOUS), 201);
    body = await json<Rotation>(await rotation());
    assert.deepEqual(body.previous.map((d) => d.hostname), ['ESP_00000B']);
  });

  test('a Device on the previous token is logged once an hour, by hostname, never with a token', async () => {
    const campus = await client.campuses.create();
    await client.devices.create(campus.id, 'ESP_00000A');
    await client.devices.create(campus.id, 'ESP_00000B');
    for (let i = 0; i < 3; i++) assert.equal(await post('ESP_00000A', PREVIOUS), 201);
    assert.equal(await post('ESP_00000B', TEST_DEVICE_TOKEN), 201);
    assert.equal(logged.length, 1);
    assert.match(logged[0], /ESP_00000A/);
    assert.match(logged[0], /previous Device token/);

    clock = new Date(clock.getTime() + PREVIOUS_TOKEN_LOG_INTERVAL_MS - 1000);
    assert.equal(await post('ESP_00000A', PREVIOUS), 201);
    assert.equal(logged.length, 1);
    clock = new Date(clock.getTime() + 1000);
    assert.equal(await post('ESP_00000A', PREVIOUS), 201);
    assert.equal(logged.length, 2);

    for (const line of logged) {
      assert.ok(!line.includes(PREVIOUS) && !line.includes(TEST_DEVICE_TOKEN) && !line.includes(TEST_ADMIN_TOKEN), line);
    }
  });

  test('a Reading for an unregistered hostname with the previous token is a 404 and is neither logged nor listed', async () => {
    assert.equal(await post('ESP_FFFFFF', PREVIOUS), 404);
    assert.deepEqual(logged, []);
    const body = await json<Rotation>(await rotation());
    assert.deepEqual(body.previous, []);
  });
});

describe('Device token rotation, none under way', () => {
  let pool: Pool;
  let server: RunningServer;
  let client: ReturnType<typeof api>;

  before(() => {
    pool = createTestPool();
  });
  beforeEach(async () => {
    await resetDatabase(pool);
    server = await startServer(pool);
    client = api(server);
  });
  afterEach(() => server.close());
  after(() => pool.end());

  test('without DEVICE_TOKEN_PREVIOUS only the Device token is accepted, and the list is inactive and empty', async () => {
    const campus = await client.campuses.create();
    await client.devices.create(campus.id, 'ESP_000001');
    const refused = await client.readings.add({ device: 'ESP_000001', temp: 70, humidity: 40 }, bearer(PREVIOUS));
    assert.equal(refused.status, 401);
    await refused.arrayBuffer();

    const response = await fetch(client.devices.url('/rotation'), asAdmin());
    assert.equal(response.status, 200);
    const body = await json<Rotation>(response);
    assert.equal(body.active, false);
    assert.deepEqual(body.previous, []);
    assert.deepEqual(body.unheard, []);
  });
});
