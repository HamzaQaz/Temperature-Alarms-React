import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { createTestPool, resetDatabase } from './helpers/database';
import { startServer, type RunningServer } from './helpers/server';
import { api, asAdmin, errorOf, json, type Device } from './helpers/api';

describe('/api/devices', () => {
  let pool: Pool;
  let server: RunningServer;
  let client: ReturnType<typeof api>;

  before(async () => {
    pool = createTestPool();
    server = await startServer(pool);
    client = api(server);
  });
  beforeEach(() => resetDatabase(pool));
  after(async () => {
    await server.close();
    await pool.end();
  });

  const url = (path = '') => client.devices.url(path);
  const listed = () => client.devices.list();
  const addCampus = (name?: string, shortcode?: string) => client.campuses.create(name, shortcode);
  const addDevice = (body: unknown, init?: RequestInit) => client.devices.add(body, init);

  test('lists nothing on a fresh database, without a token', async () => {
    const response = await fetch(url());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), []);
  });

  test('adds a device with the Admin token and lists it back with its campus', async () => {
    const campus = await addCampus();
    const created = await addDevice({ hostname: 'ESP_A1B2C3', campusId: campus.id, closet: 'IDF 2' });
    assert.equal(created.status, 201);
    const body = await json<Device>(created);
    assert.equal(typeof body.id, 'number');
    assert.deepEqual(body, { id: body.id, hostname: 'ESP_A1B2C3', closet: 'IDF 2', campus });

    assert.deepEqual(await listed(), [body]);
  });

  test('lists devices ordered by campus name then closet', async () => {
    const west = await addCampus('West Elementary', 'WES');
    const central = await addCampus('Central High School', 'CHS');
    await addDevice({ hostname: 'ESP_000001', campusId: west.id, closet: 'MDF' });
    await addDevice({ hostname: 'ESP_000002', campusId: central.id, closet: 'IDF 2' });
    await addDevice({ hostname: 'ESP_000003', campusId: central.id, closet: 'IDF 1' });

    const hostnames = (await listed()).map((device) => device.hostname);
    assert.deepEqual(hostnames, ['ESP_000003', 'ESP_000002', 'ESP_000001']);
  });

  test('rejects an add without a token or with the wrong token with 401', async () => {
    const campus = await addCampus();
    const body = { hostname: 'ESP_A1B2C3', campusId: campus.id, closet: 'IDF 2' };
    const missing = await addDevice(body, { headers: { 'Content-Type': 'application/json' } });
    assert.equal(missing.status, 401);
    assert.deepEqual(await missing.json(), { error: 'Not authorised' });
    const wrong = await addDevice(body, { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer nope' } });
    assert.equal(wrong.status, 401);
    assert.deepEqual(await listed(), []);
  });

  test('rejects a hostname that is not ESP_ plus six hex digits with 422', async () => {
    const campus = await addCampus();
    for (const hostname of ['', 'ESP_', 'ESP_12345', 'ESP_1234567', 'ESP_GHIJKL', 'ESP-A1B2C3', 'esp_a1b2c3x', 'A1B2C3', 42]) {
      const response = await addDevice({ hostname, campusId: campus.id, closet: 'IDF 2' });
      assert.equal(response.status, 422, JSON.stringify(hostname));
      assert.match(await errorOf(response), /hostname/i);
    }
    assert.deepEqual(await listed(), []);
  });

  test('trims the hostname and closet and upper-cases the hostname', async () => {
    const campus = await addCampus();
    const response = await addDevice({ hostname: ' esp_a1b2c3 ', campusId: campus.id, closet: '  IDF 2 ' });
    assert.equal(response.status, 201);
    const body = await json<Device>(response);
    assert.equal(body.hostname, 'ESP_A1B2C3');
    assert.equal(body.closet, 'IDF 2');
  });

  test('rejects a missing or blank closet, or one that is too long, with 422', async () => {
    const campus = await addCampus();
    for (const closet of [undefined, '', '   ', 'x'.repeat(51), 7]) {
      const response = await addDevice({ hostname: 'ESP_A1B2C3', campusId: campus.id, closet });
      assert.equal(response.status, 422, JSON.stringify(closet));
      assert.match(await errorOf(response), /closet/i);
    }
    assert.deepEqual(await listed(), []);
  });

  test('rejects a missing, malformed, or unknown campus with 422', async () => {
    for (const campusId of [undefined, 'CHS', 0, -1, 1.5, 999]) {
      const response = await addDevice({ hostname: 'ESP_A1B2C3', campusId, closet: 'IDF 2' });
      assert.equal(response.status, 422, JSON.stringify(campusId));
      assert.match(await errorOf(response), /campus/i);
    }
    assert.deepEqual(await listed(), []);
  });

  test('rejects a duplicate hostname with 409, whatever its case', async () => {
    const campus = await addCampus();
    await addDevice({ hostname: 'ESP_A1B2C3', campusId: campus.id, closet: 'IDF 2' });
    const response = await addDevice({ hostname: 'esp_a1b2c3', campusId: campus.id, closet: 'IDF 3' });
    assert.equal(response.status, 409);
    assert.match(await errorOf(response), /ESP_A1B2C3/);
    assert.equal((await listed()).length, 1);
  });

  describe('DELETE /api/devices/:id', () => {
    const createDevice = async (): Promise<Device> => {
      const campus = await addCampus();
      return json<Device>(await addDevice({ hostname: 'ESP_A1B2C3', campusId: campus.id, closet: 'IDF 2' }));
    };
    const readingCount = async (deviceId: number): Promise<number> => {
      const [rows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM readings WHERE device_id = ?', [deviceId]);
      return Number(rows[0].n);
    };

    test('deletes a device with the Admin token and its readings go with it', async () => {
      const device = await createDevice();
      await client.readings.add({ device: device.hostname, temp: 72, humidity: 40 });
      await client.readings.add({ device: device.hostname, temp: 73, humidity: 41 });
      assert.equal(await readingCount(device.id), 2);

      const response = await fetch(url(`/${device.id}`), asAdmin({ method: 'DELETE' }));
      assert.equal(response.status, 204);
      assert.deepEqual(await listed(), []);
      assert.equal(await readingCount(device.id), 0);
    });

    test('requires the Admin token', async () => {
      const device = await createDevice();
      const missing = await fetch(url(`/${device.id}`), { method: 'DELETE' });
      assert.equal(missing.status, 401);
      const wrong = await fetch(url(`/${device.id}`), { method: 'DELETE', headers: { Authorization: 'Bearer nope' } });
      assert.equal(wrong.status, 401);
      assert.equal((await listed()).length, 1);
    });

    test('returns 404 for an unknown or malformed id', async () => {
      assert.equal((await fetch(url('/999'), asAdmin({ method: 'DELETE' }))).status, 404);
      assert.equal((await fetch(url('/abc'), asAdmin({ method: 'DELETE' }))).status, 404);
    });

    test('frees the campus to be deleted once its last device is gone', async () => {
      const device = await createDevice();
      const campusUrl = `${server.url}/api/campuses/${device.campus.id}`;
      assert.equal((await fetch(campusUrl, asAdmin({ method: 'DELETE' }))).status, 409);
      await fetch(url(`/${device.id}`), asAdmin({ method: 'DELETE' }));
      assert.equal((await fetch(campusUrl, asAdmin({ method: 'DELETE' }))).status, 204);
    });
  });
});
