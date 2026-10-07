import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { createTestPool, resetDatabase } from './helpers/database';
import { startServer, testConfig, type RunningServer } from './helpers/server';
import { api, asAdmin, errorOf, json, type DashboardDevice, type Incident, type RecordedReading } from './helpers/api';
import { subscribe, type SseClient } from './helpers/sse';
import { createBroadcaster, type FaultEvent, type ReadingEvent } from '../src/sse';
import { runOfflineSweep } from '../src/offlineSweep';
import { publishFirmware } from '../src/firmwareStore';

const MINUTE = 60_000;
const DAY_MS = 86_400_000;
/** Three Report intervals of 30 seconds: Offline begins the second after. */
const OFFLINE_AFTER_MS = 90_000;

/** A signed-looking image (firmware.test.ts has the format). */
function image(version: number): Buffer {
  const body = Buffer.concat([Buffer.from([0xe9, 1, 2, 3]), Buffer.from(`TA-FIRMWARE-VERSION=${version}\0`), Buffer.alloc(100, 0x55)]);
  const length = Buffer.alloc(4);
  length.writeUInt32LE(256);
  return Buffer.concat([body, Buffer.alloc(256, 0x5a), length]);
}

describe('fault reports (docs/adr/0009)', () => {
  let pool: Pool;
  let server: RunningServer;
  let client: ReturnType<typeof api>;
  let sse: ReturnType<typeof createBroadcaster>;
  /** The dashboard's clock; ingest stamps with the real one. */
  let clock: Date | undefined;
  const open: SseClient[] = [];

  before(() => {
    pool = createTestPool();
  });
  // A fresh server per test so the write rate limiter starts from zero every time.
  beforeEach(async () => {
    await resetDatabase(pool);
    clock = undefined;
    sse = createBroadcaster({ heartbeatMs: 60_000 });
    server = await startServer(pool, testConfig(), { sse, now: () => clock ?? new Date() });
    client = api(server);
    const campus = await client.campuses.create();
    await client.devices.create(campus.id, 'ESP_A1B2C3', 'IDF 2');
  });
  afterEach(async () => {
    for (const c of open.splice(0)) c.close();
    await server.close();
  });
  after(() => pool.end());

  const postFault = async (extra: Record<string, unknown> = {}, device = 'ESP_A1B2C3') => {
    const response = await client.readings.add({ device, fault: 'sensor', ...extra });
    assert.equal(response.status, 202, await response.clone().text());
    return response;
  };
  const postReading = async (temp: number, humidity = 40): Promise<RecordedReading> => {
    const response = await client.readings.add({ device: 'ESP_A1B2C3', temp, humidity });
    assert.equal(response.status, 201, await response.clone().text());
    return json<RecordedReading>(response);
  };
  const card = async (): Promise<DashboardDevice> => {
    const [device] = (await client.dashboard.get()).devices;
    return device;
  };
  const allIncidents = async (): Promise<Incident[]> => (await client.incidents.list(new Date(Date.now() - DAY_MS), new Date(Date.now() + 60 * MINUTE))).incidents;
  const countReadings = async (): Promise<number> => {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM readings');
    return Number(rows[0].n);
  };

  describe('ingest', () => {
    test('is accepted with the Device token as 202, and writes no Reading', async () => {
      const response = await postFault();
      assert.deepEqual(await response.json(), { device: 'ESP_A1B2C3', fault: 'sensor' });
      assert.equal(await countReadings(), 0);
    });

    test('is refused without the Device token, and the Admin token does not count', async () => {
      const without = await client.readings.add({ device: 'ESP_A1B2C3', fault: 'sensor' }, { headers: { 'Content-Type': 'application/json' } });
      assert.equal(without.status, 401);
      const admin = await client.readings.add({ device: 'ESP_A1B2C3', fault: 'sensor' }, asAdmin());
      assert.equal(admin.status, 401);
      assert.equal((await card()).lastReportAt, null, 'a refused report is not hearing from the board');
    });

    test('from an unregistered board is refused with 404 and lists it to be adopted', async () => {
      const response = await client.readings.add({ device: 'ESP_D4E5F6', fault: 'sensor' });
      assert.equal(response.status, 404);
      const pending = await json<{ hostname: string; lastReading: unknown }[]>(await fetch(client.devices.url('/pending'), asAdmin()));
      assert.deepEqual(pending.map((p) => [p.hostname, p.lastReading]), [['ESP_D4E5F6', null]]);
    });

    test('any other fault, or a fault mixed with values, is refused with 422', async () => {
      const cases: [Record<string, unknown>, RegExp][] = [
        [{ fault: 'wifi' }, /fault must be "sensor"/],
        [{ fault: null }, /fault must be "sensor"/],
        [{ fault: 'sensor', temp: 72 }, /no temp or humidity/],
        [{ fault: 'sensor', humidity: 40 }, /no temp or humidity/],
        [{ fault: 'sensor', temp: 72, humidity: 40 }, /no temp or humidity/],
      ];
      for (const [body, message] of cases) {
        const response = await client.readings.add({ device: 'ESP_A1B2C3', ...body });
        assert.equal(response.status, 422, JSON.stringify(body));
        assert.match(await errorOf(response), message, JSON.stringify(body));
      }
      assert.equal((await card()).lastReportAt, null);
    });

    test('updates what the board says about itself, and says when a newer build is waiting', async () => {
      await publishFirmware(pool, image(5), ['ESP_A1B2C3']);
      const response = await postFault({ fw: 4, rssi: -70, uptime: 120, heap: 20000, reset: 'Power On', update: 'none newer' });
      assert.equal(response.headers.get('x-firmware-available'), '5', 'a board with a dead sensor can still be updated');
      const status = await json<{ devices: { hostname: string; firmwareVersion: number | null; info: { rssi: number | null; uptimeSeconds: number | null } | null }[] }>(
        await fetch(`${server.url}/api/firmware/status`, asAdmin()),
      );
      const device = status.devices.find((d) => d.hostname === 'ESP_A1B2C3');
      assert.equal(device?.firmwareVersion, 4);
      assert.equal(device?.info?.rssi, -70);
      assert.equal(device?.info?.uptimeSeconds, 120);
    });

    test('shares the Device\'s limit of 20 a minute with its Readings', async () => {
      for (let i = 0; i < 10; i += 1) await postReading(72);
      for (let i = 0; i < 10; i += 1) await postFault();
      const limited = await client.readings.add({ device: 'ESP_A1B2C3', fault: 'sensor' });
      assert.equal(limited.status, 429);
    });

    test('old-firmware bodies are unchanged: a Reading is 201 with its Reading, and stored', async () => {
      const posted = await postReading(72);
      assert.deepEqual(Object.keys(posted).sort(), ['device', 'reading']);
      assert.equal(await countReadings(), 1);
      const device = await card();
      assert.equal(device.lastReportAt, posted.reading.recordedAt, 'a Reading is a report');
      assert.deepEqual(device.conditions, []);
    });
  });

  describe('the Sensor fault Condition and Incident', () => {
    test('keeps the Device Online while the Reading ages: Offline counts from the last report', async () => {
      const [device] = await client.devices.list();
      const old = new Date(Math.floor((Date.now() - 10 * MINUTE) / 1000) * 1000);
      await pool.query('INSERT INTO readings (device_id, temp_f, humidity, recorded_at) VALUES (?, 72, 40, ?)', [device.id, old]);
      assert.equal((await card()).online, false);

      await postFault();
      const after = await card();
      assert.equal(after.online, true);
      assert.ok(after.secondsSinceReading !== null && after.secondsSinceReading >= 600, 'the Reading keeps its age');
      assert.ok(after.secondsSinceReport !== null && after.secondsSinceReport <= 5);
      assert.deepEqual(after.latestReading?.recordedAt, old.toISOString(), 'the last good Reading stays');
    });

    test('two fault reports raise nothing; the third raises Sensor fault at critical and opens its Incident', async () => {
      const good = await postReading(72);
      await postFault();
      await postFault();
      assert.deepEqual((await card()).conditions, []);
      assert.deepEqual(await allIncidents(), []);

      await postFault();
      assert.deepEqual((await card()).conditions, [{ name: 'Sensor fault', level: 'critical' }]);
      const [incident] = await allIncidents();
      assert.equal(incident.condition, 'Sensor fault');
      assert.equal(incident.level, 'critical');
      assert.equal(incident.end, null);
      assert.deepEqual(incident.peak, { value: null, tempF: 72, humidity: 40, recordedAt: good.reading.recordedAt }, 'the peak is the last good Reading');

      await postFault();
      assert.equal((await allIncidents()).length, 1, 'a fourth continues it');
    });

    test('a good Reading clears the Condition, and two in a row close the Incident, ending at the first', async () => {
      await postReading(72);
      for (let i = 0; i < 3; i += 1) await postFault();
      const first = await postReading(73);
      assert.deepEqual((await card()).conditions, [], 'the count is back to zero');
      assert.equal((await allIncidents())[0].end, null, 'one good Reading is a blip');
      await postReading(73);
      assert.equal((await allIncidents())[0].end, first.reading.recordedAt);

      await postFault();
      await postFault();
      assert.deepEqual((await card()).conditions, [], 'the count started again');
    });

    test('a Device that was Hot and then faults is no longer Hot; its Hot incident waits for Readings', async () => {
      await postReading(91);
      assert.deepEqual((await card()).conditions, [{ name: 'Hot', level: 'critical' }]);
      for (let i = 0; i < 3; i += 1) await postFault();
      assert.deepEqual((await card()).conditions, [{ name: 'Sensor fault', level: 'critical' }]);
      const incidents = await allIncidents();
      assert.deepEqual(incidents.map((i) => [i.condition, i.end]), [['Hot', null], ['Sensor fault', null]]);

      await postReading(72);
      await postReading(72);
      assert.ok((await allIncidents()).every((i) => i.end !== null), 'both close by the usual rule once Readings return');
    });

    test('silence after fault reports goes Offline on time, by the dashboard and by the sweep', async () => {
      await postReading(72);
      for (let i = 0; i < 3; i += 1) await postFault();
      const lastReportAt = (await card()).lastReportAt;
      assert.ok(lastReportAt !== null);
      const last = new Date(lastReportAt).getTime();

      clock = new Date(last + OFFLINE_AFTER_MS);
      assert.equal((await card()).online, true, 'exactly three intervals after the last fault report is still Online');
      clock = new Date(last + OFFLINE_AFTER_MS + 1000);
      const silent = await card();
      assert.equal(silent.online, false);
      assert.deepEqual(silent.conditions, [{ name: 'Sensor fault', level: 'critical' }, { name: 'Offline', level: 'warning' }]);

      const sweep = (now: Date) => runOfflineSweep({ pool, config: testConfig(), sse, now: () => now });
      assert.equal(await sweep(new Date(last + OFFLINE_AFTER_MS)), 0);
      assert.equal(await sweep(new Date(last + OFFLINE_AFTER_MS + 5000)), 1);
      const offline = (await allIncidents()).find((i) => i.condition === 'Offline');
      assert.equal(offline?.start, new Date(last + OFFLINE_AFTER_MS + 1000).toISOString(), 'silence counts from the last fault report, not the last Reading');
    });
  });

  test('a fault report ends an open Offline incident: the board is heard from', async () => {
    const [device] = await client.devices.list();
    await pool.query('INSERT INTO readings (device_id, temp_f, humidity, recorded_at) VALUES (?, 72, 40, ?)', [device.id, new Date(Date.now() - 5 * MINUTE)]);
    assert.equal(await runOfflineSweep({ pool, config: testConfig(), sse }), 1);
    await postFault();
    const [offline] = await allIncidents();
    assert.equal(offline.condition, 'Offline');
    assert.notEqual(offline.end, null);
    assert.equal((await card()).online, true);
  });

  describe('the stream', () => {
    const listen = async (): Promise<SseClient> => {
      const c = await subscribe(client.dashboard.url('/stream'));
      open.push(c);
      await c.next(); // the opening comment
      return c;
    };
    /** The next message of one type, skipping the others. */
    const nextOf = async <T extends { type: string }>(stream: SseClient, type: T['type']): Promise<T> => {
      for (;;) {
        const event = await stream.nextMessage<T>();
        if (event.type === type) return event;
      }
    };

    test('carries a `fault` message with the Device\'s Conditions, and Readings carry when they were the last report', async () => {
      const stream = await listen();
      const posted = await postReading(91);
      const reading = await nextOf<ReadingEvent>(stream, 'reading');
      assert.equal(reading.lastReportAt, posted.reading.recordedAt);

      await postFault();
      await nextOf<FaultEvent>(stream, 'fault');
      await postFault();
      const second = await nextOf<FaultEvent>(stream, 'fault');
      assert.deepEqual(second.conditions, [{ name: 'Hot', level: 'critical' }], 'below the count the last Reading still counts');
      await postFault();
      const third = await nextOf<FaultEvent>(stream, 'fault');
      assert.equal(third.device, 'ESP_A1B2C3');
      assert.equal(third.fault, 'sensor');
      assert.equal(third.online, true);
      assert.deepEqual(third.conditions, [{ name: 'Sensor fault', level: 'critical' }]);
      assert.equal(third.lastReportAt, (await card()).lastReportAt);
      const opened = await nextOf<{ type: 'incident'; change: string; incident: Incident }>(stream, 'incident');
      assert.equal(opened.change, 'opened');
      assert.equal(opened.incident.condition, 'Sensor fault');
    });
  });
});
