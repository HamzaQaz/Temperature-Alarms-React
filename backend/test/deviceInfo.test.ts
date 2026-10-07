import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'mysql2/promise';
import { createTestPool, resetDatabase } from './helpers/database';
import { startServer, type RunningServer } from './helpers/server';
import { api, asAdmin, json } from './helpers/api';
import { publishFirmware, withdrawFirmware } from '../src/firmwareStore';

/** A signed-looking image (firmware.test.ts has the format). */
function image(version: number): Buffer {
  const body = Buffer.concat([Buffer.from([0xe9, 1, 2, 3]), Buffer.from(`TA-FIRMWARE-VERSION=${version}\0`), Buffer.alloc(100, 0x55)]);
  const length = Buffer.alloc(4);
  length.writeUInt32LE(256);
  return Buffer.concat([body, Buffer.alloc(256, 0x5a), length]);
}

interface StatusDevice {
  hostname: string;
  firmwareVersion: number | null;
  info: { rssi: number | null; uptimeSeconds: number | null; freeHeap: number | null; resetReason: string | null; updateResult: string | null; at: string } | null;
}

describe('what a board reports about itself with each Reading', () => {
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
    const campus = await client.campuses.create();
    await client.devices.create(campus.id, 'ESP_A1B2C3');
    await client.devices.create(campus.id, 'ESP_D4E5F6');
  });
  afterEach(() => server.close());
  after(() => pool.end());

  const post = async (body: Record<string, unknown>) => {
    const response = await client.readings.add({ device: 'ESP_A1B2C3', temp: 71, humidity: 40, ...body });
    await response.arrayBuffer();
    return response;
  };
  const statusOf = async (hostname: string) =>
    (await json<{ devices: StatusDevice[] }>(await fetch(`${server.url}/api/firmware/status`, asAdmin()))).devices.find((d) => d.hostname === hostname);

  test('version, signal, uptime, free memory, last restart and last update are kept and shown to the Admin', async () => {
    const response = await post({ fw: 3, rssi: -61, uptime: 3600, heap: 21450, reset: 'Software/System restart', update: 'none newer' });
    assert.equal(response.status, 201);
    const device = await statusOf('ESP_A1B2C3');
    assert.equal(device?.firmwareVersion, 3);
    assert.deepEqual({ ...device?.info, at: undefined }, {
      rssi: -61,
      uptimeSeconds: 3600,
      freeHeap: 21450,
      resetReason: 'Software/System restart',
      updateResult: 'none newer',
      at: undefined,
    });
    assert.equal((await statusOf('ESP_D4E5F6'))?.info, null);
  });

  test('a board that sends none of it (older firmware) is recorded as before', async () => {
    assert.equal((await post({})).status, 201);
    assert.equal((await statusOf('ESP_A1B2C3'))?.info, null);
  });

  test('values out of range or of the wrong kind are dropped, never refused; text is cut to printable ASCII', async () => {
    const response = await post({ fw: -1, rssi: 40, uptime: 'long', heap: 1e12, reset: 'Exception\r\nreport: 201 created' + 'x'.repeat(100), update: 7 });
    assert.equal(response.status, 201);
    const info = (await statusOf('ESP_A1B2C3'))?.info;
    assert.equal(info?.rssi, null);
    assert.equal(info?.uptimeSeconds, null);
    assert.equal(info?.freeHeap, null);
    assert.equal(info?.updateResult, null);
    assert.ok(info?.resetReason !== null && info?.resetReason !== undefined && info.resetReason.length <= 60 && !/[\r\n]/.test(info.resetReason), info?.resetReason ?? '');
  });

  test('the Reading answer says when a newer build is waiting for this board, so it checks at once', async () => {
    assert.equal((await post({ fw: 2 })).headers.get('x-firmware-available'), null, 'nothing published');
    await publishFirmware(pool, image(3), ['ESP_A1B2C3']);
    assert.equal((await post({ fw: 2 })).headers.get('x-firmware-available'), '3');
    assert.equal((await post({ fw: 3 })).headers.get('x-firmware-available'), null, 'already on it');
    const other = await client.readings.add({ device: 'ESP_D4E5F6', temp: 71, humidity: 40, fw: 1 });
    assert.equal(other.headers.get('x-firmware-available'), null, 'staged for another board');
    await other.arrayBuffer();
    await withdrawFirmware(pool);
    assert.equal((await post({ fw: 2 })).headers.get('x-firmware-available'), null, 'withdrawn');
  });
});
