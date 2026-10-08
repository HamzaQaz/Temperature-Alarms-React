import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { createTestPool, resetDatabase } from './helpers/database';
import { startServer, TEST_ADMIN_TOKEN, type RunningServer } from './helpers/server';
import { api, asAdmin, json } from './helpers/api';
import { check, image } from './helpers/firmware';
import { readHostname } from '../src/firmwareStore';
import { HOURLY_CHECK_MS, nextCheckText, progressDetail, progressOf, type ProgressFacts } from '../src/rollout';

const SECOND = 1000;
const MINUTE = 60_000;

/** The bench board of the ticket, and a second one: the update check names a board by its MAC, a Reading by its hostname. */
const BENCH = { hostname: 'ESP_64533B', mac: '5C:CF:7F:64:53:3B' };
const OTHER = { hostname: 'ESP_D4E5F6', mac: '5C:CF:7F:D4:E5:F6' };

interface Progress {
  hostname: string;
  device: { id: number; campus: { name: string; shortcode: string }; closet: string } | null;
  firmwareVersion: number | null;
  step: string;
  nextCheck: { by: 'reading' | 'hourly'; at: string | null } | null;
  sentAt: string | null;
  updateResult: string | null;
  lastReportAt: string | null;
  cleanReports: number;
}

interface Status {
  release: { version: number; only: string[] | null; offeredTo: string } | null;
  progress: { cleanReportsToWiden: number; devices: Progress[] } | null;
  devices: Array<{ hostname: string; checkedAt: string | null }>;
}

describe('the names a technician types for a Device', () => {
  test('the network hostname, any case, and the six hex digits alone are all the Device hostname', () => {
    for (const name of ['ESP-64533B', 'esp_64533b', '64533B', '64533b', 'ESP64533B', ' ESP_64533B ']) assert.equal(readHostname(name), 'ESP_64533B', name);
  });

  test('anything else is not a hostname', () => {
    for (const name of ['ESP_6453', 'ESP_64533G', 'ESP__64533B', 'bench board', '', 'ESP_64533B,ESP_D4E5F6']) assert.equal(readHostname(name), null, name);
  });
});

describe('where an offered Device is (rollout.ts)', () => {
  const now = new Date('2026-10-07T23:40:00Z');
  const before = (ms: number) => new Date(now.getTime() - ms);
  const release = { version: 7, publishedAt: before(10 * MINUTE), held: false };
  const device = (more: Partial<ProgressFacts> = {}): ProgressFacts => ({
    firmwareVersion: 4,
    checkedAt: before(45 * MINUTE),
    sentAt: null,
    updateResult: 'none newer',
    infoAt: before(20 * SECOND),
    lastReportAt: before(20 * SECOND),
    offline: false,
    ...more,
  });
  const timeOf = (at: Date) => at.toISOString().slice(11, 16);

  test('a board that says its version with its Readings checks at its next one, nudged; one before firmware 3 on its hourly check', () => {
    assert.deepEqual(progressOf(release, device(), 30), { step: 'waiting', nextCheck: { by: 'reading', at: new Date(now.getTime() + 10 * SECOND) } });
    assert.deepEqual(progressOf(release, device({ firmwareVersion: 2, infoAt: null }), 30), {
      step: 'waiting',
      nextCheck: { by: 'hourly', at: new Date(before(45 * MINUTE).getTime() + HOURLY_CHECK_MS) },
    });
  });

  test('the server sending it the image is downloading; then it runs the new version; a refusal it reported after the download is refused', () => {
    assert.deepEqual(progressOf(release, device({ sentAt: before(MINUTE) }), 30), { step: 'downloading', nextCheck: null });
    assert.deepEqual(progressOf(release, device({ sentAt: before(MINUTE), firmwareVersion: 7 }), 30), { step: 'running', nextCheck: null });
    assert.equal(progressOf(release, device({ sentAt: before(MINUTE), updateResult: 'failed, Bad signature' }), 30).step, 'refused');
    assert.equal(progressOf(release, device({ sentAt: before(MINUTE), updateResult: 'failed, Bad signature', infoAt: before(2 * MINUTE) }), 30).step, 'downloading', 'reported before the download');
    assert.equal(progressOf(release, device({ sentAt: before(20 * MINUTE) }), 30).step, 'waiting', 'sent an earlier release');
  });

  test('stuck: Offline first, with its hourly check while it has not taken it; never checked in; not registered; held', () => {
    assert.deepEqual(progressOf(release, device({ offline: true }), 30), {
      step: 'offline',
      nextCheck: { by: 'hourly', at: new Date(before(45 * MINUTE).getTime() + HOURLY_CHECK_MS) },
    });
    assert.deepEqual(progressOf(release, device({ offline: true, firmwareVersion: 7 }), 30), { step: 'offline', nextCheck: null });
    assert.deepEqual(progressOf(release, device({ checkedAt: null }), 30), { step: 'never-checked', nextCheck: null });
    assert.deepEqual(progressOf(release, null, 30), { step: 'unregistered', nextCheck: null });
    assert.deepEqual(progressOf({ ...release, held: true }, device(), 30), { step: 'held', nextCheck: null });
    assert.equal(progressOf({ ...release, held: true }, device({ sentAt: before(MINUTE), firmwareVersion: 7 }), 30).step, 'running', 'it took it before the hold');
  });

  test('the expected next check, in words, for a board on new and old firmware', () => {
    assert.equal(nextCheckText({ by: 'reading', at: new Date('2026-10-07T23:40:10Z') }, now, timeOf), 'at its next Reading, by 23:40');
    assert.equal(nextCheckText({ by: 'hourly', at: new Date('2026-10-07T23:55:00Z') }, now, timeOf), 'by 23:55, or restart the board');
    assert.equal(nextCheckText({ by: 'hourly', at: new Date('2026-10-07T23:35:00Z') }, now, timeOf), 'due by 23:35; restart the board');
  });

  test('each step says what comes next, or what is known about where it stopped', () => {
    const line = { nextCheck: null, sentAt: null, updateResult: null, lastReportAt: null, cleanReports: 0 };
    assert.equal(progressDetail({ ...line, step: 'waiting', nextCheck: { by: 'hourly', at: new Date('2026-10-07T23:55:00Z') } }, now, timeOf), 'by 23:55, or restart the board');
    assert.equal(progressDetail({ ...line, step: 'downloading', sentAt: new Date('2026-10-07T23:39:00Z') }, now, timeOf), 'the server sent the image at 23:39');
    assert.equal(progressDetail({ ...line, step: 'running', cleanReports: 4 }, now, timeOf), '4 of 10 clean Readings');
    assert.equal(progressDetail({ ...line, step: 'running', cleanReports: 37 }, now, timeOf), '10 of 10 clean Readings');
    assert.equal(progressDetail({ ...line, step: 'refused', updateResult: 'failed, Bad signature' }, now, timeOf), 'failed, Bad signature');
    assert.equal(
      progressDetail({ ...line, step: 'offline', lastReportAt: new Date('2026-10-07T22:10:00Z'), nextCheck: { by: 'hourly', at: new Date('2026-10-07T23:55:00Z') } }, now, timeOf),
      'last report at 22:10, next check by 23:55, or restart the board',
    );
    assert.equal(progressDetail({ ...line, step: 'offline' }, now, timeOf), 'it has never reported');
    assert.match(progressDetail({ ...line, step: 'never-checked' }, now, timeOf) ?? '', /USB/);
    assert.equal(progressDetail({ ...line, step: 'held' }, now, timeOf), null);
  });
});

describe('publishing says who it reaches, and the status where each of them is (POST and GET /api/firmware)', () => {
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

  const register = async () => {
    const campus = await client.campuses.create();
    await client.devices.create(campus.id, BENCH.hostname, 'IDF 2');
    await client.devices.create(campus.id, OTHER.hostname, 'MDF');
  };
  const upload = (version: number, query = '') =>
    fetch(`${server.url}/api/firmware${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${TEST_ADMIN_TOKEN}` },
      body: image(version),
    });
  const refusal = async (response: Response): Promise<string> => {
    assert.equal(response.status, 422);
    return (await json<{ error: string }>(response)).error;
  };
  const stored = async () => (await pool.query<RowDataPacket[]>('SELECT version FROM firmware_release'))[0].length;
  const status = async (): Promise<Status> => {
    const response = await fetch(`${server.url}/api/firmware/status`, asAdmin());
    assert.equal(response.status, 200);
    return json<Status>(response);
  };
  const progressOfDevice = async (hostname: string) => (await status()).progress?.devices.find((d) => d.hostname === hostname);
  /** The board's update check: 304 before the release names it, the image once it does. */
  const checkIn = async ({ mac }: { mac: string }, running: number) => (await check(server.url, { mac, version: String(running) })).arrayBuffer();
  const report = async (hostname: string, fields: Record<string, unknown> = {}) => {
    const response = await client.readings.add({ device: hostname, temp: 71, humidity: 40, ...fields });
    assert.equal(response.status, 201, await response.clone().text());
  };

  test('the forms a technician types name the registered Device, and the answer says who it is offered to', async () => {
    await register();
    await checkIn(BENCH, 4);
    const response = await upload(7, '?only=ESP-64533B,esp_d4e5f6,64533b');
    assert.equal(response.status, 201);
    const release = await json<{ only: string[]; offeredTo: string }>(response);
    assert.deepEqual(release.only, [BENCH.hostname, OTHER.hostname]);
    assert.equal(release.offeredTo, 'Offered to ESP_64533B (CHS IDF 2, running 4), ESP_D4E5F6 (CHS MDF, version not known yet)');
    assert.equal((await status()).release?.offeredTo, release.offeredTo);
  });

  test('a name no Device is registered under is refused naming it, as is one that is not a hostname, and nothing is stored', async () => {
    await register();
    assert.match(await refusal(await upload(7, '?only=ESP_64533B,64533C')), /no Device is registered as 64533C \(ESP_64533C\)/);
    assert.match(await refusal(await upload(7, '?only=ESP_64533B,ESP_00000F')), /no Device is registered as ESP_00000F;/);
    assert.match(await refusal(await upload(7, '?only=bench')), /^bench: not a Device hostname/);
    assert.equal(await stored(), 0);
  });

  test('every Device is counted; with none registered it would reach no Device and is refused', async () => {
    assert.match(await refusal(await upload(7)), /would reach no Device/);
    assert.equal(await stored(), 0);
    await register();
    const response = await upload(7);
    assert.equal(response.status, 201);
    assert.equal((await json<{ offeredTo: string }>(response)).offeredTo, 'Offered to every Device (2)');
  });

  test('a staged release lists only its named Devices, each with where it is: never checked in, then waiting, sent, running, counting', async () => {
    await register();
    // A board on firmware 6 reporting, which has not checked for an update yet.
    await report(BENCH.hostname, { fw: 6 });
    await upload(7, `?only=${BENCH.hostname}`).then((r) => r.arrayBuffer());
    const staged = await status();
    assert.deepEqual(staged.progress?.devices.map((d) => d.hostname), [BENCH.hostname]);
    assert.equal(staged.progress?.cleanReportsToWiden, 10);
    let bench: Progress | undefined = staged.progress?.devices[0];
    assert.equal(bench?.step, 'never-checked');
    assert.deepEqual(bench?.device?.campus.shortcode, 'CHS');

    // It has checked (before the release named it, say); a board that reports its version checks at its next Reading.
    await pool.query("UPDATE devices SET firmware_checked_at = UTC_TIMESTAMP() - INTERVAL 5 MINUTE WHERE hostname = 'ESP_64533B'");
    bench = await progressOfDevice(BENCH.hostname);
    assert.equal(bench?.step, 'waiting');
    assert.equal(bench?.nextCheck?.by, 'reading');
    assert.equal(new Date(bench?.nextCheck?.at ?? 0).getTime(), new Date(bench?.lastReportAt ?? 0).getTime() + 30 * SECOND);

    await checkIn(BENCH, 6);
    bench = await progressOfDevice(BENCH.hostname);
    assert.equal(bench?.step, 'downloading');
    assert.ok(bench?.sentAt !== null);

    await report(BENCH.hostname, { fw: 7 });
    bench = await progressOfDevice(BENCH.hostname);
    assert.deepEqual({ step: bench?.step, version: bench?.firmwareVersion, clean: bench?.cleanReports }, { step: 'running', version: 7, clean: 1 });
    await report(BENCH.hostname, { fw: 7 });
    await report(BENCH.hostname, { fw: 7 });
    assert.equal((await progressOfDevice(BENCH.hostname))?.cleanReports, 3);
  });

  test('a board before firmware 3 waits for its hourly check; one that refused the image says why; a silent one is Offline', async () => {
    await register();
    // Firmware 2 checked, and reports without saying its version.
    await checkIn(BENCH, 2);
    await report(BENCH.hostname);
    // The other checked and has been silent since.
    await checkIn(OTHER, 6);
    await upload(7).then((r) => r.arrayBuffer());
    const { progress, devices } = await status();
    const bench = progress?.devices.find((d) => d.hostname === BENCH.hostname);
    const checkedAt = new Date(devices.find((d) => d.hostname === BENCH.hostname)?.checkedAt ?? 0).getTime();
    assert.deepEqual(bench?.nextCheck, { by: 'hourly', at: new Date(checkedAt + HOURLY_CHECK_MS).toISOString() });
    assert.equal(bench?.step, 'waiting');
    // Stuck ones first.
    const other = progress?.devices[0];
    assert.equal(other?.hostname, OTHER.hostname);
    assert.equal(other?.step, 'offline');
    assert.equal(other?.nextCheck?.by, 'hourly');

    // The other takes the image and says with its next Reading that the update failed. A download takes
    // a while, and the self-report keeps whole seconds: published a minute ago, sent two seconds before.
    await checkIn(OTHER, 6);
    await pool.query('UPDATE firmware_release SET published_at = published_at - INTERVAL 1 MINUTE');
    await pool.query("UPDATE devices SET firmware_sent_at = firmware_sent_at - INTERVAL 2 SECOND WHERE hostname = 'ESP_D4E5F6'");
    await report(OTHER.hostname, { fw: 6, update: 'failed, Bad signature' });
    const refused = await progressOfDevice(OTHER.hostname);
    assert.deepEqual({ step: refused?.step, result: refused?.updateResult }, { step: 'refused', result: 'failed, Bad signature' });
  });
});
