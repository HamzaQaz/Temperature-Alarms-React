import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { createTestPool, resetDatabase } from './helpers/database';
import { startServer, testConfig, type RunningServer } from './helpers/server';
import { api, asAdmin, json, type History } from './helpers/api';
import type { NotificationsConfig } from '../src/config';
import { publishFirmware, withdrawFirmware } from '../src/firmwareStore';

/** Email on, so a test can show nothing is queued (nothing is sent: the outbox is not drained here). */
const NOTIFY: NotificationsConfig = {
  smtp: { host: '127.0.0.1', port: 2525, secure: 'none', auth: undefined },
  from: 'alarms@district.example',
  to: ['techs@district.example'],
  toAll: false,
  publicUrl: 'https://alarms.district.example',
  coalesceSeconds: 0,
  remindHours: 0,
  monthlyReport: false,
};

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
  info: {
    rssi: number | null;
    uptimeSeconds: number | null;
    freeHeap: number | null;
    resetReason: string | null;
    updateResult: string | null;
    sensor: string | null;
    ssid: string | null;
    fallback: boolean | null;
    at: string;
  } | null;
}

describe('what a board reports about itself with each Reading', () => {
  let pool: Pool;
  let server: RunningServer;
  let client: ReturnType<typeof api>;
  let deviceId: number;

  before(() => {
    pool = createTestPool();
  });
  beforeEach(async () => {
    await resetDatabase(pool);
    server = await startServer(pool);
    client = api(server);
    const campus = await client.campuses.create();
    deviceId = (await client.devices.create(campus.id, 'ESP_A1B2C3')).id;
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
  const historySensor = async () => (await json<History>(await client.devices.history(deviceId))).device.sensor;
  const cardOf = async (hostname: string) => (await client.dashboard.get()).devices.find((d) => d.hostname === hostname);

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
      sensor: null,
      ssid: null,
      fallback: null,
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

  test('the sensor a board names (firmware 6) is kept on the Device, shown to the Admin and on its History', async () => {
    assert.equal(await historySensor(), null, 'not said yet');
    assert.equal((await post({ fw: 6, sensor: 'SHT31' })).status, 201);
    assert.equal((await statusOf('ESP_A1B2C3'))?.info?.sensor, 'SHT31');
    assert.equal(await historySensor(), 'SHT31');
    assert.equal((await statusOf('ESP_D4E5F6'))?.info, null);
  });

  test('a fault report names the sensor too, so a board whose sensor never answered still says which it carries', async () => {
    const response = await client.readings.add({ device: 'ESP_A1B2C3', fault: 'sensor', fw: 6, sensor: 'DHT22' });
    assert.equal(response.status, 202);
    await response.arrayBuffer();
    assert.equal((await statusOf('ESP_A1B2C3'))?.info?.sensor, 'DHT22');
    assert.equal(await historySensor(), 'DHT22');
  });

  test('the sensor is what the board last said: one it no longer names (older firmware flashed back) is not kept', async () => {
    await post({ fw: 6, sensor: 'DHT22' });
    await post({ fw: 5 });
    assert.equal((await statusOf('ESP_A1B2C3'))?.info?.sensor, null);
    assert.equal(await historySensor(), null);
  });

  test('a sensor the server does not know is dropped, never refused', async () => {
    for (const sensor of ['BME280', 'dht22', ' SHT31', 31, '']) {
      const response = await post({ fw: 6, sensor });
      assert.equal(response.status, 201, String(sensor));
      assert.equal((await statusOf('ESP_A1B2C3'))?.info?.sensor, null, String(sensor));
    }
    // Alone it is still a self-report: the board is newer firmware, saying nothing else usable.
    await post({ sensor: 'DHT11' });
    assert.equal((await statusOf('ESP_A1B2C3'))?.info?.sensor, 'DHT11');
  });

  test('the network a board is on (firmware 7) is shown to the Admin, and its fallback network as a note on its card', async () => {
    assert.equal((await cardOf('ESP_A1B2C3'))?.onFallbackNetwork, false, 'not said yet');
    assert.equal((await post({ fw: 7, ssid: 'closet-net', network: 1 })).status, 201);
    assert.deepEqual(await statusOf('ESP_A1B2C3').then((d) => [d?.info?.ssid, d?.info?.fallback]), ['closet-net', false]);
    assert.equal((await cardOf('ESP_A1B2C3'))?.onFallbackNetwork, false);

    assert.equal((await post({ fw: 7, ssid: 'CISD-MAC', network: 2 })).status, 201);
    assert.deepEqual(await statusOf('ESP_A1B2C3').then((d) => [d?.info?.ssid, d?.info?.fallback]), ['CISD-MAC', true]);
    assert.equal((await cardOf('ESP_A1B2C3'))?.onFallbackNetwork, true);
    // The card says only that it is on its fallback: the network's name stays behind the Admin token.
    assert.ok(!JSON.stringify(await client.dashboard.get()).includes('CISD-MAC'));
    assert.equal((await cardOf('ESP_D4E5F6'))?.onFallbackNetwork, false);
  });

  test('a fault report names the network too', async () => {
    const response = await client.readings.add({ device: 'ESP_A1B2C3', fault: 'sensor', fw: 7, ssid: 'CISD-MAC', network: 2 });
    assert.equal(response.status, 202);
    await response.arrayBuffer();
    assert.deepEqual(await statusOf('ESP_A1B2C3').then((d) => [d?.info?.ssid, d?.info?.fallback]), ['CISD-MAC', true]);
    assert.equal((await cardOf('ESP_A1B2C3'))?.onFallbackNetwork, true);
  });

  test('the network is what the board last said: older firmware flashed back clears it, and the note with it', async () => {
    await post({ fw: 7, ssid: 'CISD-MAC', network: 2 });
    await post({ fw: 6, sensor: 'DHT11' });
    assert.deepEqual(await statusOf('ESP_A1B2C3').then((d) => [d?.info?.ssid, d?.info?.fallback]), [null, null]);
    assert.equal((await cardOf('ESP_A1B2C3'))?.onFallbackNetwork, false);
  });

  test('a network number other than 1 or 2 is dropped, never refused; the name is cut to printable ASCII and 32 characters', async () => {
    for (const network of [0, 3, '2', 1.5, null]) {
      const response = await post({ fw: 7, ssid: 'CISD-MAC', network });
      assert.equal(response.status, 201, String(network));
      assert.deepEqual(await statusOf('ESP_A1B2C3').then((d) => [d?.info?.ssid, d?.info?.fallback]), ['CISD-MAC', null], String(network));
      assert.equal((await cardOf('ESP_A1B2C3'))?.onFallbackNetwork, false, String(network));
    }
    await post({ fw: 7, ssid: 'Library\r\nreport: 201 created' + 'x'.repeat(40), network: 2 });
    const ssid = (await statusOf('ESP_A1B2C3'))?.info?.ssid;
    assert.ok(ssid !== null && ssid !== undefined && ssid.length <= 32 && !/[\r\n]/.test(ssid), ssid ?? '');
    await post({ fw: 7, ssid: 42, network: 2 });
    assert.deepEqual(await statusOf('ESP_A1B2C3').then((d) => [d?.info?.ssid, d?.info?.fallback]), [null, true]);
    // Alone it is still a self-report.
    await post({ network: 2 });
    assert.equal((await statusOf('ESP_A1B2C3'))?.info?.fallback, true);
  });

  test('a board on its fallback network is a note, never a Condition, an incident or an email (owner decision)', async () => {
    const notifying = await startServer(pool, testConfig({ notifications: NOTIFY }));
    try {
      for (let i = 0; i < 4; i++) {
        const response = await api(notifying).readings.add({ device: 'ESP_A1B2C3', temp: 71, humidity: 40, fw: 7, ssid: 'CISD-MAC', network: 2 });
        assert.equal(response.status, 201);
        await response.arrayBuffer();
      }
      const card = (await api(notifying).dashboard.get()).devices.find((d) => d.hostname === 'ESP_A1B2C3');
      assert.equal(card?.onFallbackNetwork, true);
      assert.deepEqual(card?.conditions, []);
      assert.deepEqual(card?.openIncidents, []);
      const counts = async () => {
        const [[incidents], [emails]] = await Promise.all([
          pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM incidents'),
          pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM notifications'),
        ]);
        return [incidents[0].n, emails[0].n];
      };
      assert.deepEqual(await counts(), [0, 0]);
      // The same server does open and queue one for a Condition, so the zeros above are not for want of email.
      const hot = await api(notifying).readings.add({ device: 'ESP_A1B2C3', temp: 95, humidity: 40, fw: 7, ssid: 'CISD-MAC', network: 2 });
      await hot.arrayBuffer();
      assert.deepEqual(await counts(), [1, 1]);
    } finally {
      await notifying.close();
    }
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
