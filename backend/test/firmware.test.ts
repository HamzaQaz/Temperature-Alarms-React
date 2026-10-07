import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { createTestPool, resetDatabase, testDatabaseConfig } from './helpers/database';
import { startServer, testConfig, TEST_ADMIN_TOKEN, TEST_DEVICE_TOKEN, type RunningServer } from './helpers/server';
import { api, asAdmin, json } from './helpers/api';
import { DEVICE_AUTH_FAILURE_LIMIT } from '../src/routes/readings';
import { FirmwareImageError, parseFirmwareImage, publishFirmware, withdrawFirmware } from '../src/firmwareStore';

const PREVIOUS = 'test-device-token-previous';

/** A firmware image as the Arduino build signs it: ESP image magic, the version marker, a signature, its length. */
function image(version: number, { signatureLength = 256, marker = true, magic = 0xe9 } = {}): Buffer {
  const body = Buffer.concat([
    Buffer.from([magic, 0x01, 0x02, 0x03]),
    Buffer.alloc(1000, 0x55),
    Buffer.from(marker ? `TA-FIRMWARE-VERSION=${version}\0` : 'nothing here\0'),
    Buffer.alloc(500, 0xaa),
  ]);
  const signature = Buffer.alloc(signatureLength, 0x5a);
  const length = Buffer.alloc(4);
  length.writeUInt32LE(signatureLength);
  return Buffer.concat([body, signature, length]);
}

const md5 = (data: Buffer) => createHash('md5').update(data).digest('hex');

/** As the board's update check sends it: the Device token as Basic credentials, its MAC and version. */
const check = (url: string, { mac = '5C:CF:7F:A1:B2:C3', version = '1', token = TEST_DEVICE_TOKEN, address }: { mac?: string; version?: string; token?: string; address?: string } = {}) =>
  fetch(`${url}/api/firmware`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`device:${token}`).toString('base64')}`,
      'x-ESP8266-STA-MAC': mac,
      'x-ESP8266-version': version,
      ...(address === undefined ? {} : { 'X-Forwarded-For': address }),
    },
  });

describe('firmware images', () => {
  test('a signed image with a version marker is read', () => {
    assert.deepEqual(parseFirmwareImage(image(7)), { version: 7, md5: md5(image(7)), size: image(7).length });
  });

  test('an unsigned image, one without a version, or not an ESP8266 image is refused', () => {
    assert.throws(() => parseFirmwareImage(image(7, { signatureLength: 0 })), (e: unknown) => e instanceof FirmwareImageError && /signed/.test(e.message));
    assert.throws(() => parseFirmwareImage(image(7, { marker: false })), (e: unknown) => e instanceof FirmwareImageError && /FIRMWARE_VERSION/.test(e.message));
    assert.throws(() => parseFirmwareImage(image(7, { magic: 0x00 })), (e: unknown) => e instanceof FirmwareImageError && /ESP8266/.test(e.message));
    assert.throws(() => parseFirmwareImage(Buffer.alloc(2 * 1024 * 1024, 0xe9)), FirmwareImageError);
  });
});

describe('over-the-air firmware (GET /api/firmware)', () => {
  let pool: Pool;
  let server: RunningServer;
  let client: ReturnType<typeof api>;

  before(() => {
    pool = createTestPool();
  });
  beforeEach(async () => {
    await resetDatabase(pool);
    server = await startServer(pool, testConfig({ deviceTokenPrevious: PREVIOUS }));
    client = api(server);
    const campus = await client.campuses.create();
    await client.devices.create(campus.id, 'ESP_A1B2C3');
    await client.devices.create(campus.id, 'ESP_D4E5F6');
  });
  afterEach(() => server.close());
  after(() => pool.end());

  test('with nothing published, a board is told there is nothing new (304), and its version is recorded', async () => {
    const response = await check(server.url, { version: '3' });
    assert.equal(response.status, 304);
    const [[row]] = await pool.query<RowDataPacket[]>("SELECT firmware_version AS v, firmware_checked_at AS at FROM devices WHERE hostname = 'ESP_A1B2C3'");
    assert.equal(row.v, 3);
    assert.ok(row.at instanceof Date);
  });

  test('a newer published image is sent whole, with its MD5, to a board on an older version', async () => {
    const published = image(2);
    await publishFirmware(pool, published);
    const response = await check(server.url, { version: '1' });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/octet-stream');
    assert.equal(response.headers.get('x-md5'), md5(published));
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), published);
  });

  test('a board already on the published version, or a newer one, gets a 304', async () => {
    await publishFirmware(pool, image(2));
    assert.equal((await check(server.url, { version: '2' })).status, 304);
    assert.equal((await check(server.url, { version: '5' })).status, 304);
  });

  test('a release for named Devices reaches only those; publishing it again for all widens it', async () => {
    await publishFirmware(pool, image(2), ['ESP_D4E5F6']);
    assert.equal((await check(server.url, { mac: '5C:CF:7F:A1:B2:C3' })).status, 304);
    const named = await check(server.url, { mac: '5C:CF:7F:D4:E5:F6' });
    assert.equal(named.status, 200);
    await named.arrayBuffer();
    await publishFirmware(pool, image(2));
    const all = await check(server.url, { mac: '5C:CF:7F:A1:B2:C3' });
    assert.equal(all.status, 200);
    await all.arrayBuffer();
  });

  test('an older version than the one published is refused, and a withdrawn release is offered to nobody', async () => {
    await publishFirmware(pool, image(3));
    await assert.rejects(publishFirmware(pool, image(2)), (e: unknown) => e instanceof FirmwareImageError && /older/.test(e.message));
    await withdrawFirmware(pool);
    assert.equal((await check(server.url, { version: '1' })).status, 304);
  });

  test('the previous Device token works during a rotation; a Bearer header works too', async () => {
    await publishFirmware(pool, image(2));
    const previous = await check(server.url, { token: PREVIOUS });
    assert.equal(previous.status, 200);
    await previous.arrayBuffer();
    const bearer = await fetch(`${server.url}/api/firmware`, {
      headers: { Authorization: `Bearer ${TEST_DEVICE_TOKEN}`, 'x-ESP8266-STA-MAC': '5C:CF:7F:A1:B2:C3', 'x-ESP8266-version': '1' },
    });
    assert.equal(bearer.status, 200);
    await bearer.arrayBuffer();
  });

  test('no token, the Admin token, or a wrong one is a 401, and wrong ones share the Readings refusal limit', async () => {
    await publishFirmware(pool, image(2));
    const none = await fetch(`${server.url}/api/firmware`, { headers: { 'x-ESP8266-STA-MAC': '5C:CF:7F:A1:B2:C3' } });
    assert.equal(none.status, 401);
    await none.arrayBuffer();
    const admin = await check(server.url, { token: TEST_ADMIN_TOKEN });
    assert.equal(admin.status, 401);
    await admin.arrayBuffer();
    for (let i = 0; i < DEVICE_AUTH_FAILURE_LIMIT - 1; i++) {
      const guess = await check(server.url, { token: `guess-${i}`, address: '203.0.113.30' });
      assert.equal(guess.status, 401, `guess ${i + 1}`);
      await guess.arrayBuffer();
    }
    // The last one of the allowance, at the Readings route: the limit is one per address, whatever the route.
    const reading = await client.readings.add({ device: 'ESP_A1B2C3', temp: 70, humidity: 40 }, {
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer guess-x', 'X-Forwarded-For': '203.0.113.30' },
    });
    assert.equal(reading.status, 401);
    await reading.arrayBuffer();
    const limited = await check(server.url, { address: '203.0.113.30' });
    assert.equal(limited.status, 429);
    await limited.arrayBuffer();
  });

  test('a missing or malformed MAC is a 400, and an unregistered board a 404; neither gets the image', async () => {
    await publishFirmware(pool, image(2));
    const noMac = await fetch(`${server.url}/api/firmware`, { headers: { Authorization: `Bearer ${TEST_DEVICE_TOKEN}`, 'x-ESP8266-version': '1' } });
    assert.equal(noMac.status, 400);
    await noMac.arrayBuffer();
    const bad = await check(server.url, { mac: 'not-a-mac' });
    assert.equal(bad.status, 400);
    await bad.arrayBuffer();
    const unknown = await check(server.url, { mac: '5C:CF:7F:00:00:01' });
    assert.equal(unknown.status, 404);
    await unknown.arrayBuffer();
  });

  test('the Admin sees the release and each Device\'s version (GET /api/firmware/status); others get 401', async () => {
    await publishFirmware(pool, image(2), ['ESP_A1B2C3']);
    await (await check(server.url, { version: '1' })).arrayBuffer();
    const refused = await fetch(`${server.url}/api/firmware/status`, { headers: { Authorization: `Bearer ${TEST_DEVICE_TOKEN}` } });
    assert.equal(refused.status, 401);
    await refused.arrayBuffer();
    const response = await fetch(`${server.url}/api/firmware/status`, asAdmin());
    assert.equal(response.status, 200);
    const body = await json<{
      release: { version: number; size: number; md5: string; publishedAt: string; only: string[] | null } | null;
      devices: Array<{ hostname: string; firmwareVersion: number | null; checkedAt: string | null }>;
    }>(response);
    assert.equal(body.release?.version, 2);
    assert.deepEqual(body.release?.only, ['ESP_A1B2C3']);
    assert.equal(body.release?.md5, md5(image(2)));
    const byHost = new Map(body.devices.map((d) => [d.hostname, d]));
    assert.equal(byHost.get('ESP_A1B2C3')?.firmwareVersion, 1);
    assert.equal(byHost.get('ESP_D4E5F6')?.firmwareVersion, null);
    assert.equal(byHost.get('ESP_D4E5F6')?.checkedAt, null);
  });
});

describe('publishing from Settings (POST and DELETE /api/firmware, Admin token)', () => {
  let pool: Pool;
  let server: RunningServer;

  before(() => {
    pool = createTestPool();
  });
  beforeEach(async () => {
    await resetDatabase(pool);
    server = await startServer(pool);
  });
  afterEach(() => server.close());
  after(() => pool.end());

  const upload = (body: Buffer, { token = TEST_ADMIN_TOKEN, query = '' } = {}) =>
    fetch(`${server.url}/api/firmware${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${token}` },
      body,
    });

  test('the Admin publishes a signed image, for named Devices or every Device', async () => {
    const response = await upload(image(5), { query: '?only=esp_a1b2c3,ESP_D4E5F6' });
    assert.equal(response.status, 201);
    const release = await json<{ version: number; only: string[] | null; md5: string }>(response);
    assert.equal(release.version, 5);
    assert.deepEqual(release.only, ['ESP_A1B2C3', 'ESP_D4E5F6']);
    const widened = await upload(image(5));
    assert.equal(widened.status, 201);
    assert.equal((await json<{ only: string[] | null }>(widened)).only, null);
  });

  test('an unsigned or older image is a 422 saying why, and nothing changes', async () => {
    const unsigned = await upload(image(5, { signatureLength: 0 }));
    assert.equal(unsigned.status, 422);
    assert.match((await json<{ error: string }>(unsigned)).error, /not signed/);
    await (await upload(image(5))).arrayBuffer();
    const older = await upload(image(4));
    assert.equal(older.status, 422);
    assert.match((await json<{ error: string }>(older)).error, /older/);
    const [[row]] = await pool.query<RowDataPacket[]>('SELECT version FROM firmware_release');
    assert.equal(row.version, 5);
  });

  test('the Device token, or none, cannot publish or withdraw', async () => {
    for (const token of [TEST_DEVICE_TOKEN, 'nothing']) {
      const posted = await upload(image(5), { token });
      assert.equal(posted.status, 401);
      await posted.arrayBuffer();
      const deleted = await fetch(`${server.url}/api/firmware`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      assert.equal(deleted.status, 401);
      await deleted.arrayBuffer();
    }
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM firmware_release');
    assert.equal(rows.length, 0);
  });

  test('a body over 1 MB is a 413', async () => {
    const response = await upload(Buffer.alloc(1024 * 1024 + 1, 0xe9));
    assert.equal(response.status, 413);
    await response.arrayBuffer();
  });

  test('the Admin withdraws the release', async () => {
    await (await upload(image(5))).arrayBuffer();
    const response = await fetch(`${server.url}/api/firmware`, { method: 'DELETE', ...asAdmin() });
    assert.equal(response.status, 204);
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM firmware_release');
    assert.equal(rows.length, 0);
  });
});

describe('firmware command line (deploy.sh publish-firmware, firmware-status, withdraw-firmware)', () => {
  let pool: Pool;
  before(() => {
    pool = createTestPool();
  });
  beforeEach(() => resetDatabase(pool));
  after(() => pool.end());

  const run = (args: string[], input = '') => {
    const backendDir = path.resolve(__dirname, '..');
    const db = testDatabaseConfig();
    return spawnSync(process.execPath, ['--require', 'ts-node/register/transpile-only', path.join(backendDir, 'src', 'firmwareCli.ts'), ...args], {
      cwd: os.tmpdir(),
      input,
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        PATH: process.env.PATH ?? '',
        NODE_PATH: path.join(backendDir, 'node_modules'),
        TS_NODE_PROJECT: path.join(backendDir, 'tsconfig.json'),
        DB_HOST: db.host,
        DB_PORT: String(db.port),
        DB_USER: db.user,
        DB_PASSWORD: db.password,
        DB_NAME: db.database,
        ADMIN_TOKEN: TEST_ADMIN_TOKEN,
        DEVICE_TOKEN: TEST_DEVICE_TOKEN,
      },
    });
  };

  test('publishes base64 from stdin, reports status, and withdraws', async () => {
    const published = run(['publish', '--only', 'esp-a1b2c3'], image(4).toString('base64').replace(/(.{76})/g, '$1\n'));
    assert.equal(published.status, 0, published.stderr);
    assert.match(published.stdout, /Published version 4 .*offered to ESP_A1B2C3/);
    const [[row]] = await pool.query<RowDataPacket[]>('SELECT version, only_hostnames AS only FROM firmware_release');
    assert.deepEqual({ ...row }, { version: 4, only: 'ESP_A1B2C3' });

    const status = run(['status']);
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /Published: version 4/);

    const withdrawn = run(['withdraw']);
    assert.equal(withdrawn.status, 0, withdrawn.stderr);
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM firmware_release');
    assert.equal(rows.length, 0);
  });

  test('refuses an unsigned image, saying why, and publishes nothing', async () => {
    const result = run(['publish'], image(4, { signatureLength: 0 }).toString('base64'));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Refused: the image is not signed/);
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM firmware_release');
    assert.equal(rows.length, 0);
  });
});
