import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'mysql2/promise';
import { createTestPool, resetDatabase } from './helpers/database';
import { startServer, testConfig, type RunningServer } from './helpers/server';
import { api, json, type Dashboard, type RecordedReading } from './helpers/api';

describe('GET /api/dashboard', () => {
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

  const addCampus = (name?: string, shortcode?: string) => client.campuses.create(name, shortcode);
  const addDevice = (campusId: number, hostname?: string, closet?: string) => client.devices.create(campusId, hostname, closet);
  const postReading = async (device: string, temp: number, humidity: number): Promise<RecordedReading> =>
    json<RecordedReading>(await client.readings.add({ device, temp, humidity }));

  test('reports the Report interval and no devices on a fresh database, without a token', async () => {
    const response = await fetch(client.dashboard.url());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { reportIntervalSeconds: 30, offlineAfterSeconds: 90, devices: [] } satisfies Dashboard);
  });

  test('lists each device with its campus, closet, IDF or MDF tag, and latest reading', async () => {
    const campus = await addCampus();
    const device = await addDevice(campus.id, 'ESP_A1B2C3', 'IDF 2');
    await postReading('ESP_A1B2C3', 70, 35);
    const latest = await postReading('ESP_A1B2C3', 72, 40);

    const { devices } = await client.dashboard.get();
    assert.equal(devices.length, 1);
    const [entry] = devices;
    assert.deepEqual(entry, {
      id: device.id,
      hostname: 'ESP_A1B2C3',
      campus,
      closet: 'IDF 2',
      closetType: 'IDF',
      latestReading: latest.reading,
      online: true,
      secondsSinceReading: entry.secondsSinceReading,
    });
    assert.ok(entry.secondsSinceReading !== null && entry.secondsSinceReading >= 0 && entry.secondsSinceReading <= 5, `just posted: ${entry.secondsSinceReading}`);
  });

  test('tags closets IDF or MDF by the start of their name, whatever the case, and leaves others untagged', async () => {
    const campus = await addCampus();
    await addDevice(campus.id, 'ESP_000001', 'idf 3');
    await addDevice(campus.id, 'ESP_000002', 'MDF');
    await addDevice(campus.id, 'ESP_000003', 'Server room');

    const { devices } = await client.dashboard.get();
    const tags = Object.fromEntries(devices.map((d) => [d.hostname, d.closetType]));
    assert.deepEqual(tags, { ESP_000001: 'IDF', ESP_000002: 'MDF', ESP_000003: null });
  });

  test('a device with no readings is listed offline with a null reading and no age', async () => {
    const campus = await addCampus();
    const device = await addDevice(campus.id, 'ESP_A1B2C3', 'MDF');

    const { devices } = await client.dashboard.get();
    assert.deepEqual(devices, [
      {
        id: device.id,
        hostname: 'ESP_A1B2C3',
        campus,
        closet: 'MDF',
        closetType: 'MDF',
        latestReading: null,
        online: false,
        secondsSinceReading: null,
      },
    ]);
  });

  describe('?campus= filter', () => {
    const seed = async () => {
      const central = await addCampus('Central High School', 'CHS');
      const west = await addCampus('West Elementary', 'WES');
      await addDevice(central.id, 'ESP_000001', 'IDF 1');
      await addDevice(central.id, 'ESP_000002', 'MDF');
      await addDevice(west.id, 'ESP_000003', 'MDF');
    };
    const hostnames = async (campus?: string) => (await client.dashboard.get(campus)).devices.map((d) => d.hostname);

    test('lists every device, ordered by campus name then closet, when no campus is given', async () => {
      await seed();
      assert.deepEqual(await hostnames(), ['ESP_000001', 'ESP_000002', 'ESP_000003']);
    });

    test('keeps only that campus, matching the shortcode in any case', async () => {
      await seed();
      assert.deepEqual(await hostnames('CHS'), ['ESP_000001', 'ESP_000002']);
      assert.deepEqual(await hostnames('chs'), ['ESP_000001', 'ESP_000002']);
      assert.deepEqual(await hostnames('Wes'), ['ESP_000003']);
    });

    test('returns an empty list for an unknown campus, and still reports the interval', async () => {
      await seed();
      assert.deepEqual(await client.dashboard.get('NOPE'), { reportIntervalSeconds: 30, offlineAfterSeconds: 90, devices: [] });
    });

    test('treats a blank campus as no filter', async () => {
      await seed();
      assert.equal((await hostnames('')).length, 3);
      assert.equal((await hostnames('  ')).length, 3);
    });
  });

  describe('online versus offline', () => {
    // The server's clock is pinned so the age of a reading is exact, not racing the test.
    const NOW = new Date('2026-09-05T12:00:00Z');
    let pinned: RunningServer;
    let pinnedClient: ReturnType<typeof api>;

    before(async () => {
      pinned = await startServer(pool, testConfig({ reportIntervalSeconds: 30 }), { now: () => NOW });
      pinnedClient = api(pinned);
    });
    after(() => pinned.close());

    // Ingest stamps the server's time, so an old reading can only be arranged by writing the row directly.
    const readingAgedSeconds = async (deviceId: number, ageSeconds: number, tempF = 72) => {
      await pool.query('INSERT INTO readings (device_id, temp_f, humidity, recorded_at) VALUES (?, ?, ?, ?)', [
        deviceId,
        tempF,
        40,
        new Date(NOW.getTime() - ageSeconds * 1000),
      ]);
    };
    const entryFor = async (hostname: string) => {
      const { devices } = await pinnedClient.dashboard.get();
      const entry = devices.find((d) => d.hostname === hostname);
      assert.ok(entry, `${hostname} is on the dashboard`);
      return entry;
    };

    test('is online while the last reading is within three Report intervals, offline once it is older', async () => {
      const campus = await addCampus();
      const within = await addDevice(campus.id, 'ESP_000001', 'IDF 1');
      const atBoundary = await addDevice(campus.id, 'ESP_000002', 'IDF 2');
      const beyond = await addDevice(campus.id, 'ESP_000003', 'IDF 3');
      await readingAgedSeconds(within.id, 89);
      await readingAgedSeconds(atBoundary.id, 90);
      await readingAgedSeconds(beyond.id, 91);

      const entries = [await entryFor('ESP_000001'), await entryFor('ESP_000002'), await entryFor('ESP_000003')];
      assert.deepEqual(
        entries.map((e) => [e.online, e.secondsSinceReading]),
        [
          [true, 89],
          [true, 90],
          [false, 91],
        ],
      );
    });

    test('judges online by the newest reading, not the newest row', async () => {
      const campus = await addCampus();
      const device = await addDevice(campus.id, 'ESP_000001', 'IDF 1');
      await readingAgedSeconds(device.id, 10, 75);
      // A late-arriving older reading inserted afterwards must not become "latest".
      await readingAgedSeconds(device.id, 600, 60);

      const entry = await entryFor('ESP_000001');
      assert.equal(entry.online, true);
      assert.equal(entry.secondsSinceReading, 10);
      assert.equal(entry.latestReading?.tempF, 75);
      assert.equal(entry.latestReading?.recordedAt, new Date(NOW.getTime() - 10_000).toISOString());
    });

    test('follows the configured Report interval rather than a constant', async () => {
      const slow = await startServer(pool, testConfig({ reportIntervalSeconds: 60 }), { now: () => NOW });
      try {
        const campus = await addCampus();
        const device = await addDevice(campus.id, 'ESP_000001', 'IDF 1');
        await readingAgedSeconds(device.id, 150);
        const { reportIntervalSeconds, offlineAfterSeconds, devices } = await api(slow).dashboard.get();
        assert.equal(reportIntervalSeconds, 60);
        assert.equal(offlineAfterSeconds, 180);
        assert.equal(devices[0].online, true);
        assert.equal((await entryFor('ESP_000001')).online, false, 'the 30 s server calls the same reading offline');
      } finally {
        await slow.close();
      }
    });

    test('a reading from the future counts as zero seconds old', async () => {
      const campus = await addCampus();
      const device = await addDevice(campus.id, 'ESP_000001', 'IDF 1');
      await readingAgedSeconds(device.id, -5);
      const entry = await entryFor('ESP_000001');
      assert.equal(entry.secondsSinceReading, 0);
      assert.equal(entry.online, true);
    });
  });

  test('the old /api/temperature/* and /api/history routes are gone', async () => {
    const campus = await addCampus();
    await addDevice(campus.id, 'ESP_A1B2C3', 'IDF 2');
    const gone = ['/api/temperature/ESP_A1B2C3', '/api/temperature/ESP_A1B2C3/history', '/api/history', '/api/history?device=ESP_A1B2C3'];
    for (const path of gone) {
      const response = await fetch(`${server.url}${path}`);
      assert.equal(response.status, 404, path);
      assert.deepEqual(await response.json(), { error: 'Not found' });
    }
  });
});
