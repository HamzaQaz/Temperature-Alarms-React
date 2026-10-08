import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { createTestPool, resetDatabase } from './helpers/database';
import { startServer, testConfig, TEST_ADMIN_TOKEN, TEST_DEVICE_TOKEN, type RunningServer } from './helpers/server';
import { api, asAdmin } from './helpers/api';
import { check, image } from './helpers/firmware';
import { subscribe, type SseClient } from './helpers/sse';
import type { Config } from '../src/config';
import { runOfflineSweep } from '../src/offlineSweep';
import { CLEAN_REPORTS_TO_WIDEN, reportMovesRollout } from '../src/rollout';
import { createBroadcaster, type Broadcaster } from '../src/sse';

const MINUTE = 60_000;

/** The two boards: the update check names a board by its MAC, a Reading by its hostname. */
const A = { hostname: 'ESP_A1B2C3', mac: '5C:CF:7F:A1:B2:C3' };
const D = { hostname: 'ESP_D4E5F6', mac: '5C:CF:7F:D4:E5:F6' };

/** What the stream sends, exactly: a signal, never the status behind the Admin token. */
const FIRMWARE = '{"type":"firmware"}';

describe('which reports move the Firmware tab', () => {
  const before = { version: 6, updateResult: 'none newer', cleanReports: 3 };

  test('a new version or update result does, for any Device', () => {
    assert.equal(reportMovesRollout(before, { ...before, version: 7 }, false), true);
    assert.equal(reportMovesRollout(before, { ...before, updateResult: 'v7 offered, downloading' }, false), true);
    assert.equal(reportMovesRollout(before, { ...before, updateResult: null }, false), true);
    assert.equal(reportMovesRollout(before, before, false), false);
  });

  test('a clean-Readings count does only for a Device the release is offered to, and only up to the ten the tab counts to', () => {
    assert.equal(reportMovesRollout(before, { ...before, cleanReports: 4 }, true), true);
    assert.equal(reportMovesRollout(before, { ...before, cleanReports: 0 }, true), true);
    assert.equal(reportMovesRollout(before, { ...before, cleanReports: 4 }, false), false);
    const ready = { ...before, cleanReports: CLEAN_REPORTS_TO_WIDEN - 1 };
    assert.equal(reportMovesRollout(ready, { ...ready, cleanReports: CLEAN_REPORTS_TO_WIDEN }, true), true);
    const past = { ...before, cleanReports: CLEAN_REPORTS_TO_WIDEN };
    assert.equal(reportMovesRollout(past, { ...past, cleanReports: CLEAN_REPORTS_TO_WIDEN + 1 }, true), false);
    assert.equal(reportMovesRollout({ ...past, cleanReports: 14 }, { ...past, cleanReports: 1 }, true), true, 'a missed interval starts it again');
  });
});

describe('the stream says when firmware status can have changed (a `firmware` event)', () => {
  let pool: Pool;
  let server: RunningServer;
  let client: ReturnType<typeof api>;
  let config: Config;
  let sse: Broadcaster;
  const open: SseClient[] = [];

  before(() => {
    pool = createTestPool();
  });
  beforeEach(async () => {
    await resetDatabase(pool);
    config = testConfig();
    // A shorter window than the 1 s the server uses, so each trigger does not wait a second; the burst test uses the default.
    sse = createBroadcaster({ heartbeatMs: 60_000, firmwareEveryMs: 200 });
    server = await startServer(pool, config, { sse });
    client = api(server);
    const campus = await client.campuses.create();
    await client.devices.create(campus.id, A.hostname, 'IDF 2');
    await client.devices.create(campus.id, D.hostname, 'MDF');
  });
  afterEach(async () => {
    for (const stream of open.splice(0)) stream.close();
    sse.close();
    await server.close();
  });
  after(() => pool.end());

  const listen = async (): Promise<SseClient> => {
    const stream = await subscribe(client.dashboard.url('/stream'));
    open.push(stream);
    await stream.next(); // the opening comment
    return stream;
  };
  /** Every message in the next `windowMs`, as sent: long enough for a change just made to have gone out. */
  const messages = async (stream: SseClient, windowMs = 600): Promise<string[]> =>
    (await stream.collect(windowMs)).flatMap((event) => (event.kind === 'message' ? [event.data] : []));
  const firmwareEvents = async (stream: SseClient, windowMs?: number): Promise<string[]> =>
    (await messages(stream, windowMs)).filter((data) => (JSON.parse(data) as { type: string }).type === 'firmware');

  const upload = (version: number, only: string[] = []) =>
    fetch(`${server.url}/api/firmware${only.length > 0 ? `?only=${only.join(',')}` : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${TEST_ADMIN_TOKEN}` },
      body: image(version),
    });
  const publish = async (version: number, only: string[] = []) => {
    const response = await upload(version, only);
    assert.equal(response.status, 201, await response.clone().text());
    await response.arrayBuffer();
  };
  const widen = async () => {
    const response = await fetch(`${server.url}/api/firmware/widen`, { ...asAdmin(), method: 'POST' });
    assert.equal(response.status, 200, await response.clone().text());
    await response.arrayBuffer();
  };
  const withdraw = async () => {
    const response = await fetch(`${server.url}/api/firmware`, { ...asAdmin(), method: 'DELETE' });
    assert.equal(response.status, 204);
  };
  /** The board's update check, answered `expected`: 304, or 200 with the image. */
  const checkIn = async ({ mac }: { mac: string }, running: number, expected: number) => {
    const response = await check(server.url, { mac, version: String(running) });
    assert.equal(response.status, expected);
    await response.arrayBuffer();
  };
  /** A Reading, with what a board running firmware 3 or later says about itself. */
  const report = async (hostname: string, info: Record<string, unknown> = {}) => {
    const response = await client.readings.add({ device: hostname, temp: 71, humidity: 40, ...info });
    assert.equal(response.status, 201, await response.clone().text());
    await response.arrayBuffer();
  };
  const fault = async (hostname: string, info: Record<string, unknown> = {}) => {
    const response = await client.readings.add({ device: hostname, fault: 'sensor', ...info });
    assert.equal(response.status, 202, await response.clone().text());
    await response.arrayBuffer();
  };

  test('publishing, widening, and withdrawing each send one, carrying its type and nothing else; a refused change sends none', async () => {
    // Something for the event to leak if it carried Device data: a network name, a version, an update result.
    await report(A.hostname, { fw: 6, ssid: 'CISD-MAC', network: 2, update: 'none newer' });
    const stream = await listen();

    await publish(7, [A.hostname]);
    const [published, ...more] = await firmwareEvents(stream);
    assert.deepEqual(more, []);
    assert.equal(published, FIRMWARE);
    for (const secret of [A.hostname, D.hostname, 'CISD-MAC', TEST_DEVICE_TOKEN, TEST_ADMIN_TOKEN]) assert.ok(!published.includes(secret), secret);

    await widen();
    assert.deepEqual(await firmwareEvents(stream), [FIRMWARE]);

    const refused = await upload(5);
    assert.equal(refused.status, 422);
    await refused.arrayBuffer();
    assert.deepEqual(await firmwareEvents(stream), []);

    await withdraw();
    assert.deepEqual(await firmwareEvents(stream), [FIRMWARE]);
  });

  test("a board's update check sends one, answered 304 or with the image; an unregistered board's sends none", async () => {
    await publish(7, [A.hostname]);
    const stream = await listen();

    await checkIn(D, 6, 304);
    assert.deepEqual(await firmwareEvents(stream), [FIRMWARE]);
    await checkIn(A, 6, 200);
    assert.deepEqual(await firmwareEvents(stream), [FIRMWARE]);
    await checkIn({ mac: '5C:CF:7F:FF:FF:FF' }, 6, 404);
    assert.deepEqual(await firmwareEvents(stream), []);
  });

  test("a Reading sends one when its self-report changes the Device's version or update result, and none otherwise", async () => {
    const stream = await listen();

    await report(A.hostname, { fw: 6 });
    const first = await messages(stream);
    assert.deepEqual(first.map((data) => (JSON.parse(data) as { type: string }).type), ['reading', 'firmware'], 'the Reading itself goes out as before');

    await report(A.hostname, { fw: 6, update: 'none newer for ESP_A1B2C3 (running 6)' });
    assert.deepEqual(await firmwareEvents(stream), [FIRMWARE]);
    await report(A.hostname, { fw: 7, update: 'none newer for ESP_A1B2C3 (running 6)' });
    assert.deepEqual(await firmwareEvents(stream), [FIRMWARE]);

    // The same again, a board that says nothing about itself, a fault report: the tab has nothing new to show.
    await report(A.hostname, { fw: 7, update: 'none newer for ESP_A1B2C3 (running 6)', rssi: -60, uptime: 120 });
    await report(A.hostname);
    await fault(A.hostname, { fw: 7, update: 'none newer for ESP_A1B2C3 (running 6)' });
    assert.deepEqual(await firmwareEvents(stream), []);
  });

  test('a Reading on the new version moves the count of clean Readings a staged release waits on: one event each, up to ten', async () => {
    await publish(7, [A.hostname]);
    await report(A.hostname, { fw: 6 });
    await report(D.hostname, { fw: 6 });
    await checkIn(A, 6, 200);
    const stream = await listen();

    // The first Reading on it is a new version; each after it moves the count.
    await report(A.hostname, { fw: 7 });
    assert.deepEqual(await firmwareEvents(stream), [FIRMWARE]);
    await report(A.hostname, { fw: 7 });
    assert.deepEqual(await firmwareEvents(stream), [FIRMWARE]);

    // A Device the release is not offered to moves nothing on the tab with the same.
    await report(D.hostname, { fw: 6 });
    await report(D.hostname, { fw: 6 });
    assert.deepEqual(await firmwareEvents(stream), []);

    for (let count = 2; count < CLEAN_REPORTS_TO_WIDEN; count++) await report(A.hostname, { fw: 7 });
    assert.ok((await firmwareEvents(stream)).length > 0, 'the tenth enables Release to all');
    // Past ten the tab has nothing more to count.
    await report(A.hostname, { fw: 7 });
    assert.deepEqual(await firmwareEvents(stream), []);
  });

  test('a hold sends one, from ingest (Sensor fault after taking it) and from the Offline sweep (Offline after taking it)', async () => {
    await publish(7, [A.hostname]);
    await report(A.hostname, { fw: 6 });
    await checkIn(A, 6, 200);
    await report(A.hostname, { fw: 7 });
    await fault(A.hostname, { fw: 7 });
    await fault(A.hostname, { fw: 7 });
    const stream = await listen();

    // The third fault report in a row is a Sensor fault, and the hold.
    await fault(A.hostname, { fw: 7 });
    assert.deepEqual(await firmwareEvents(stream), [FIRMWARE]);
    const [[{ heldReason }]] = await pool.query<(RowDataPacket & { heldReason: string })[]>('SELECT held_reason AS heldReason FROM firmware_release');
    assert.equal(heldReason, 'Sensor fault');

    // A new build for the next try; D took it, went silent, and the sweep holds it.
    await publish(8, [D.hostname]);
    await report(D.hostname, { fw: 6 });
    await checkIn(D, 6, 200);
    await firmwareEvents(stream);
    const sweep = () => runOfflineSweep({ pool, config, sse, now: () => new Date(Date.now() + 2 * MINUTE) });
    await sweep();
    assert.deepEqual(await firmwareEvents(stream), [FIRMWARE]);
    // Held already: the next pass holds nothing, and says nothing.
    await sweep();
    assert.deepEqual(await firmwareEvents(stream), []);
  });

  test('a change made while no one is listening is not sent to whoever connects later: the tab reads the status as it opens', async () => {
    await publish(7);
    const stream = await listen();
    assert.deepEqual(await firmwareEvents(stream), [], 'the publish before anyone listened is not sent later');
  });
});

describe('the `firmware` event is coalesced on the server (sse.ts)', () => {
  let pool: Pool;
  let server: RunningServer;
  let sse: Broadcaster;
  let stream: SseClient | undefined;

  before(() => {
    pool = createTestPool();
  });
  beforeEach(async () => {
    await resetDatabase(pool);
    sse = createBroadcaster({ heartbeatMs: 60_000 });
    server = await startServer(pool, testConfig(), { sse });
    const client = api(server);
    const campus = await client.campuses.create();
    await client.devices.create(campus.id, A.hostname, 'IDF 2');
    await client.devices.create(campus.id, D.hostname, 'MDF');
    const response = await fetch(`${server.url}/api/firmware`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${TEST_ADMIN_TOKEN}` },
      body: image(7),
    });
    assert.equal(response.status, 201);
    await response.arrayBuffer();
    stream = await subscribe(client.dashboard.url('/stream'));
    await stream.next();
  });
  afterEach(async () => {
    stream?.close();
    sse.close();
    await server.close();
  });
  after(() => pool.end());

  const checks = (count: number) =>
    Promise.all(
      Array.from({ length: count }, async (_, i) => {
        const response = await check(server.url, { mac: (i % 2 === 0 ? A : D).mac, version: '7' });
        assert.equal(response.status, 304);
        await response.arrayBuffer();
      }),
    );

  test('at most one a second by default', () => {
    assert.equal(createBroadcaster().firmwareEveryMs, 1000);
  });

  test('a burst of changes sends one event', async () => {
    await checks(20);
    const events = (await (stream as SseClient).collect(1_600)).filter((e) => e.kind === 'message');
    assert.deepEqual(events, [{ kind: 'message', event: 'message', data: FIRMWARE }]);
  });

  test('a steady flow of changes sends one a second, never more, and never goes quiet', async () => {
    const arrivals: number[] = [];
    const start = Date.now();
    const listening = (async () => {
      for (;;) {
        const remaining = start + 3_700 - Date.now();
        if (remaining <= 0) return;
        try {
          const event = await (stream as SseClient).next(remaining);
          if (event.kind === 'message') arrivals.push(Date.now());
        } catch {
          return;
        }
      }
    })();
    while (Date.now() - start < 3_000) {
      await checks(2);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await listening;
    assert.ok(arrivals.length >= 2 && arrivals.length <= 4, `${arrivals.length} events in 3.7 s`);
    for (let i = 1; i < arrivals.length; i++) assert.ok(arrivals[i] - arrivals[i - 1] >= 900, `${arrivals[i] - arrivals[i - 1]} ms apart`);
  });
});
