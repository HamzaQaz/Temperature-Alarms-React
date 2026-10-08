import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'mysql2/promise';
import { createTestPool, resetDatabase } from './helpers/database';
import { startServer, testConfig, type RunningServer } from './helpers/server';
import { api, asAdmin, json } from './helpers/api';
import type { AppDeps } from '../src/deps';
import type { NotificationsConfig } from '../src/config';
import { publishFirmware } from '../src/firmwareStore';
import { backupStatus, diskStatus } from '../src/systemHealth';

type CheckStatus = 'ok' | 'off' | 'attention';

interface DeviceRef {
  id: number;
  hostname: string;
  closet: string;
  campus: { id: number; name: string; shortcode: string };
}

interface SystemHealth {
  checkedAt: string;
  database: { status: CheckStatus; sizeBytes: number; storing: boolean };
  disk: { status: CheckStatus; freeBytes: number | null; totalBytes: number | null; minFreePercent: number; error: string | null };
  backup: { status: CheckStatus; at: string | null; file: string | null; sizeBytes: number | null; maxAgeDays: number };
  notifications: {
    status: CheckStatus;
    enabled: boolean;
    lastSent: { at: string; subject: string } | null;
    lastFailure: { at: string; error: string } | null;
    pending: number;
    failed: number;
  };
  firmware: {
    status: CheckStatus;
    release: { version: number; publishedAt: string; only: string[] | null } | null;
    offered: number;
    current: number;
    behind: Array<DeviceRef & { firmwareVersion: number | null }>;
  };
  wifi: { status: CheckStatus; belowDbm: number; forHours: number; weak: Array<DeviceRef & { rssi: number; since: string }> };
  server: { status: CheckStatus; version: string | null; startedAt: string; uptimeSeconds: number };
}

const HOUR = 3600_000;
const GB = 1024 ** 3;

/** A signed-looking image (firmware.test.ts has the format). */
function image(version: number): Buffer {
  const body = Buffer.concat([Buffer.from([0xe9, 1, 2, 3]), Buffer.from(`TA-FIRMWARE-VERSION=${version}\0`), Buffer.alloc(100, 0x55)]);
  const length = Buffer.alloc(4);
  length.writeUInt32LE(256);
  return Buffer.concat([body, Buffer.alloc(256, 0x5a), length]);
}

const notifications: NotificationsConfig = {
  smtp: { host: '127.0.0.1', port: 2525, secure: 'none', auth: undefined },
  from: 'alarms@district.example',
  to: ['techs@district.example'],
  toAll: false,
  publicUrl: 'https://alarms.district.example',
  coalesceSeconds: 0,
  remindHours: 0,
  monthlyReport: false,
};

describe('system health (GET /api/system)', () => {
  let pool: Pool;
  let server: RunningServer;
  let client: ReturnType<typeof api>;
  /** The server's clock for /api/system; Readings still take the wall clock. */
  let now: Date;
  let disk: { freeBytes: number; totalBytes: number } | Error;

  before(() => {
    pool = createTestPool();
  });
  after(() => pool.end());

  const serve = async (overrides: Partial<Omit<AppDeps, 'pool' | 'config'>> = {}, config = testConfig()) => {
    server = await startServer(pool, config, {
      now: () => now,
      startedAt: new Date(now.getTime() - 3 * HOUR - 5000),
      version: '03c4700 2026-10-07',
      diskSpace: async () => {
        if (disk instanceof Error) throw disk;
        return disk;
      },
      ...overrides,
    });
    client = api(server);
  };
  const system = async () => {
    const response = await fetch(`${server.url}/api/system`, asAdmin());
    assert.equal(response.status, 200, await response.clone().text());
    return json<SystemHealth>(response);
  };
  const report = async (hostname: string, body: Record<string, unknown> = {}) => {
    const response = await client.readings.add({ device: hostname, temp: 71, humidity: 40, ...body });
    assert.equal(response.status, 201, await response.clone().text());
  };

  beforeEach(async () => {
    await resetDatabase(pool);
    now = new Date();
    disk = { freeBytes: 120 * GB, totalBytes: 200 * GB };
  });
  afterEach(() => server.close());

  test('needs the Admin token', async () => {
    await serve();
    assert.equal((await fetch(`${server.url}/api/system`)).status, 401);
    assert.equal((await fetch(`${server.url}/api/system`, { headers: { Authorization: 'Bearer not-the-token' } })).status, 401);
  });

  test('a fresh install: every line, with only the missing backup to act on', async () => {
    await serve();
    const health = await system();
    assert.equal(health.checkedAt, now.toISOString());
    assert.equal(health.database.status, 'ok');
    assert.equal(health.database.storing, true);
    assert.ok(Number.isInteger(health.database.sizeBytes) && health.database.sizeBytes > 0, `size ${health.database.sizeBytes}`);
    assert.deepEqual(health.disk, { status: 'ok', freeBytes: 120 * GB, totalBytes: 200 * GB, minFreePercent: 10, error: null });
    assert.deepEqual(health.backup, { status: 'attention', at: null, file: null, sizeBytes: null, maxAgeDays: 2 });
    assert.deepEqual(health.notifications, { status: 'off', enabled: false, lastSent: null, lastFailure: null, pending: 0, failed: 0 });
    assert.deepEqual(health.firmware, { status: 'ok', release: null, offered: 0, current: 0, behind: [] });
    assert.deepEqual(health.wifi, { status: 'ok', belowDbm: -80, forHours: 24, weak: [] });
    assert.deepEqual(health.server, {
      status: 'ok',
      version: '03c4700 2026-10-07',
      startedAt: new Date(now.getTime() - 3 * HOUR - 5000).toISOString(),
      uptimeSeconds: 3 * 3600 + 5,
    });
  });

  test('no version when the image was built without one', async () => {
    await serve({ version: undefined });
    assert.equal((await system()).server.version, null);
  });

  describe('the last backup, from the marker deploy backup writes', () => {
    /** Whole seconds, as deploy writes it: MySQL would round a fraction. */
    const ago = (hours: number) => new Date(Math.floor((now.getTime() - hours * HOUR) / 1000) * 1000);
    const mark = (hoursAgo: number) =>
      pool.query("REPLACE INTO last_backup (id, finished_at, file, size_bytes) VALUES (1, ?, 'ta_20261005-020000.sql.gz', 5242880)", [ago(hoursAgo)]);

    test('a day old is fine, with its file and size', async () => {
      await serve();
      await mark(24);
      const { backup } = await system();
      assert.deepEqual(backup, {
        status: 'ok',
        at: ago(24).toISOString(),
        file: 'ta_20261005-020000.sql.gz',
        sizeBytes: 5242880,
        maxAgeDays: 2,
      });
    });

    test('older than two days needs one', async () => {
      await serve();
      await mark(49);
      assert.equal((await system()).backup.status, 'attention');
    });
  });

  test('free disk under 10 % needs room, and a disk that cannot be measured says why', async () => {
    disk = { freeBytes: 19 * GB, totalBytes: 200 * GB };
    await serve();
    assert.deepEqual((await system()).disk, { status: 'attention', freeBytes: 19 * GB, totalBytes: 200 * GB, minFreePercent: 10, error: null });
    disk = new Error('ENOSYS: function not implemented, statfs');
    assert.deepEqual((await system()).disk, {
      status: 'attention',
      freeBytes: null,
      totalBytes: null,
      minFreePercent: 10,
      error: 'ENOSYS: function not implemented, statfs',
    });
  });

  test('Readings that cannot be stored need the database looked at', async () => {
    await serve({ ingest: { succeeded: () => {}, failed: () => {}, failing: () => true } });
    const { database } = await system();
    assert.equal(database.status, 'attention');
    assert.equal(database.storing, false);
  });

  describe('notifications', () => {
    const queueOne = async () => {
      const campus = await client.campuses.create();
      await client.devices.create(campus.id, 'ESP_A1B2C3');
      // Hot critical: an Incident opens, and its email is queued.
      await report('ESP_A1B2C3', { temp: 95 });
    };

    test('on, with the last email sent, is fine; waiting ones are counted', async () => {
      await serve({}, testConfig({ notifications }));
      await queueOne();
      let health = await system();
      assert.deepEqual(health.notifications, { status: 'ok', enabled: true, lastSent: null, lastFailure: null, pending: 1, failed: 0 });
      const sentAt = new Date(Math.floor(now.getTime() / 1000) * 1000 - HOUR);
      await pool.query("UPDATE notifications SET sent_at = ?, subject = '[Temperature Alarms] Hot critical: CHS IDF 2'", [sentAt]);
      health = await system();
      assert.equal(health.notifications.status, 'ok');
      assert.deepEqual(health.notifications.lastSent, { at: sentAt.toISOString(), subject: '[Temperature Alarms] Hot critical: CHS IDF 2' });
      assert.equal(health.notifications.pending, 0);
    });

    test('the latest try failing needs the relay looked at; one sent since clears it', async () => {
      await serve({}, testConfig({ notifications }));
      await queueOne();
      const failedAt = new Date(Math.floor(now.getTime() / 1000) * 1000 - HOUR);
      await pool.query("UPDATE notifications SET attempts = 1, last_attempt_at = ?, last_error = 'connect ECONNREFUSED 127.0.0.1:2525'", [failedAt]);
      let health = await system();
      assert.equal(health.notifications.status, 'attention');
      assert.deepEqual(health.notifications.lastFailure, { at: failedAt.toISOString(), error: 'connect ECONNREFUSED 127.0.0.1:2525' });
      await pool.query("UPDATE notifications SET sent_at = ?, subject = 'Hot'", [new Date(failedAt.getTime() + 60_000)]);
      health = await system();
      assert.equal(health.notifications.status, 'ok');
    });
  });

  describe('firmware', () => {
    const setVersion = (hostname: string, version: number | null, checked = true) =>
      pool.query('UPDATE devices SET firmware_version = ?, firmware_checked_at = ? WHERE hostname = ?', [version, checked ? now : null, hostname]);

    test('boards the release is offered to that still run an older build, Bench and never-checked boards aside', async () => {
      await serve();
      const chs = await client.campuses.create();
      const bench = await client.campuses.create('Bench', 'BENCH');
      await client.devices.create(chs.id, 'ESP_000001', 'IDF 1');
      await client.devices.create(chs.id, 'ESP_000002', 'IDF 2');
      await client.devices.create(chs.id, 'ESP_000003', 'MDF');
      await client.devices.create(bench.id, 'ESP_000004', 'Shelf');
      await setVersion('ESP_000001', 6);
      await setVersion('ESP_000002', 5);
      await setVersion('ESP_000003', null, false);
      await setVersion('ESP_000004', 5);

      assert.deepEqual((await system()).firmware, { status: 'ok', release: null, offered: 0, current: 0, behind: [] });

      const release = await publishFirmware(pool, image(6));
      let { firmware } = await system();
      assert.equal(firmware.status, 'attention');
      assert.deepEqual(firmware.release, { version: 6, publishedAt: release.publishedAt.toISOString(), only: null });
      // The board never checked is offered it but counts neither as running it nor as behind.
      assert.deepEqual([firmware.offered, firmware.current], [3, 1]);
      assert.deepEqual(
        firmware.behind.map(({ hostname, closet, campus, firmwareVersion }) => ({ hostname, closet, campus: campus.shortcode, firmwareVersion })),
        [{ hostname: 'ESP_000002', closet: 'IDF 2', campus: 'CHS', firmwareVersion: 5 }],
      );

      // Staged to the board already on it: nothing is behind.
      await publishFirmware(pool, image(6), ['ESP_000001']);
      ({ firmware } = await system());
      assert.deepEqual([firmware.status, firmware.offered, firmware.current, firmware.behind.length, firmware.release?.only], ['ok', 1, 1, 0, ['ESP_000001']]);

      await setVersion('ESP_000002', 6);
      await publishFirmware(pool, image(6));
      assert.equal((await system()).firmware.status, 'ok');
    });
  });

  describe('weak WiFi', () => {
    test('a board under -80 dBm for a day, until a Reading at a better signal', async () => {
      await serve();
      const chs = await client.campuses.create();
      const bench = await client.campuses.create('Bench', 'BENCH');
      await client.devices.create(chs.id, 'ESP_000001', 'IDF 1');
      await client.devices.create(chs.id, 'ESP_000002', 'IDF 2');
      await client.devices.create(bench.id, 'ESP_000003', 'Shelf');
      const started = new Date();
      await report('ESP_000001', { fw: 5, rssi: -86 });
      await report('ESP_000002', { fw: 5, rssi: -80 });
      await report('ESP_000003', { fw: 5, rssi: -90 });
      // A second weak Reading keeps when it began.
      await report('ESP_000001', { fw: 5, rssi: -84 });

      now = new Date(started.getTime() + 23 * HOUR);
      assert.deepEqual((await system()).wifi, { status: 'ok', belowDbm: -80, forHours: 24, weak: [] });

      now = new Date(started.getTime() + 25 * HOUR);
      const { wifi } = await system();
      assert.equal(wifi.status, 'attention');
      assert.deepEqual(
        wifi.weak.map(({ hostname, closet, campus, rssi }) => ({ hostname, closet, campus: campus.shortcode, rssi })),
        [{ hostname: 'ESP_000001', closet: 'IDF 1', campus: 'CHS', rssi: -84 }],
      );
      const since = new Date(wifi.weak[0].since).getTime();
      assert.ok(since >= started.getTime() - 1000 && since <= Date.now(), `since ${wifi.weak[0].since}`);

      // One Reading at -79 dBm ends it; a board without a signal figure is not judged.
      await report('ESP_000001', { fw: 5, rssi: -79 });
      assert.deepEqual((await system()).wifi.weak, []);
      await report('ESP_000001', { fw: 5, rssi: -88 });
      await report('ESP_000001', { fw: 5 });
      assert.equal((await pool.query<import('mysql2/promise').RowDataPacket[]>("SELECT weak_signal_since AS since FROM devices WHERE hostname = 'ESP_000001'"))[0][0].since, null);
    });
  });
});

describe('system health thresholds', () => {
  const now = new Date('2026-10-07T12:00:00Z');

  test('a backup is due when none is recorded or the last is over two days old', () => {
    assert.equal(backupStatus(null, now), 'attention');
    assert.equal(backupStatus(new Date(now.getTime() - 48 * HOUR), now), 'ok');
    assert.equal(backupStatus(new Date(now.getTime() - 48 * HOUR - 1000), now), 'attention');
  });

  test('the disk needs room under 10 % free', () => {
    assert.equal(diskStatus({ freeBytes: 10, totalBytes: 100 }), 'ok');
    assert.equal(diskStatus({ freeBytes: 9.99, totalBytes: 100 }), 'attention');
    assert.equal(diskStatus({ freeBytes: 0, totalBytes: 0 }), 'attention');
  });
});
