import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { createTestPool, resetDatabase } from './helpers/database';
import { startServer, testConfig, TEST_ADMIN_TOKEN, type RunningServer } from './helpers/server';
import { api, asAdmin, asDevice, errorOf, json } from './helpers/api';
import { check, image } from './helpers/firmware';
import { startTestRelay, type TestRelay } from './helpers/smtp';
import type { Config } from '../src/config';
import { createMailer } from '../src/mailer';
import { runNotifierPass } from '../src/notifier';
import { runOfflineSweep } from '../src/offlineSweep';
import { CLEAN_REPORTS_TO_WIDEN, cleanReportsAfter, failedToInstall, readyFor } from '../src/rollout';
import { createBroadcaster } from '../src/sse';

const SECOND = 1000;
const MINUTE = 60_000;

/** The two boards: the update check names a board by its MAC, a Reading by its hostname. */
const A = { hostname: 'ESP_A1B2C3', mac: '5C:CF:7F:A1:B2:C3' };
const D = { hostname: 'ESP_D4E5F6', mac: '5C:CF:7F:D4:E5:F6' };

interface Hold {
  at: string;
  hostname: string;
  reason: 'Offline' | 'Sensor fault' | 'update failed';
  detail: string | null;
}

interface Release {
  version: number;
  only: string[] | null;
  staged: string[] | null;
  stage: 'named' | 'all';
  publishedAt: string;
  widenedAt: string | null;
  hold: Hold | null;
}

interface StagedDevice {
  hostname: string;
  id: number | null;
  firmwareVersion: number | null;
  lastReportAt: string | null;
  /** Offline and Sensor fault only, from its reports; none is Online. Null when no Device has the hostname. */
  conditions: Array<{ name: string; level: string }> | null;
  cleanReports: number;
  ready: boolean;
}

interface Status {
  release: Release | null;
  rollout: { cleanReportsToWiden: number; devices: StagedDevice[]; ready: boolean } | null;
}

describe('the rollout rules', () => {
  const at = new Date('2026-10-07T12:00:00Z');
  const before = (ms: number) => new Date(at.getTime() - ms);

  test('a Reading on the same version, on time, adds one; another version or a missed interval starts again; a fault report is not clean', () => {
    const previous = { version: 7, cleanReports: 4, lastReportAt: before(30 * SECOND) };
    assert.equal(cleanReportsAfter(previous, { version: 7, reading: true, at }, 30), 5);
    assert.equal(cleanReportsAfter(previous, { version: 8, reading: true, at }, 30), 1);
    assert.equal(cleanReportsAfter({ ...previous, lastReportAt: before(61 * SECOND) }, { version: 7, reading: true, at }, 30), 1);
    assert.equal(cleanReportsAfter({ ...previous, lastReportAt: null }, { version: 7, reading: true, at }, 30), 1);
    assert.equal(cleanReportsAfter(previous, { version: 7, reading: false, at }, 30), 0);
    assert.equal(cleanReportsAfter(previous, { version: null, reading: true, at }, 30), 0);
  });

  test('a named Device is ready on the version, or a later one, after ten clean Readings', () => {
    assert.equal(CLEAN_REPORTS_TO_WIDEN, 10);
    assert.equal(readyFor(7, { firmwareVersion: 7, cleanReports: 10 }), true);
    assert.equal(readyFor(7, { firmwareVersion: 8, cleanReports: 12 }), true);
    assert.equal(readyFor(7, { firmwareVersion: 7, cleanReports: 9 }), false);
    assert.equal(readyFor(7, { firmwareVersion: 6, cleanReports: 50 }), false);
    assert.equal(readyFor(7, { firmwareVersion: null, cleanReports: 0 }), false);
  });

  test('a failed update counts only when the report came after this release was sent and the board is still behind', () => {
    const release = { version: 7, publishedAt: before(10 * MINUTE) };
    const sent = { sentAt: before(MINUTE), version: 6 };
    assert.equal(failedToInstall(release, sent, 'failed, Bad signature', at), true);
    assert.equal(failedToInstall(release, sent, 'none newer', at), false);
    assert.equal(failedToInstall(release, sent, null, at), false);
    assert.equal(failedToInstall(release, { ...sent, sentAt: null }, 'failed, Bad signature', at), false, 'never sent it');
    assert.equal(failedToInstall(release, { ...sent, sentAt: before(11 * MINUTE) }, 'failed, Bad signature', at), false, 'sent an earlier release');
    assert.equal(failedToInstall(release, { ...sent, sentAt: at }, 'failed, Bad signature', before(SECOND)), false, 'reported before the download');
    assert.equal(failedToInstall(release, { ...sent, version: 7 }, 'failed, connection refused', at), false, 'already runs it');
  });
});

describe('staged rollout with an automatic hold (docs/adr/0007)', () => {
  let pool: Pool;
  let relay: TestRelay;
  let server: RunningServer;
  let client: ReturnType<typeof api>;
  let config: Config;
  const sse = createBroadcaster({ heartbeatMs: 60_000 });
  /** How far ahead of the wall clock the app's own clock runs: the status read when a sweep runs later. Ingest keeps the wall clock. */
  let ahead = 0;

  /** A fresh app on the same database, with email on (sent the moment it is due) or off. */
  const serve = async (notify: boolean) => {
    config = testConfig({ notifications: notify ? { ...relay.config(), coalesceSeconds: 0 } : undefined });
    server = await startServer(pool, config, { sse, now: () => new Date(Date.now() + ahead) });
    client = api(server);
  };

  before(async () => {
    pool = createTestPool();
    relay = await startTestRelay();
  });
  beforeEach(async () => {
    await resetDatabase(pool);
    relay.received.length = 0;
    ahead = 0;
    await serve(true);
    const campus = await client.campuses.create();
    await client.devices.create(campus.id, A.hostname, 'IDF 2');
    await client.devices.create(campus.id, D.hostname, 'MDF');
  });
  afterEach(() => server.close());
  after(async () => {
    await relay.close();
    await pool.end();
  });

  const upload = (version: number, only: string[] = []) =>
    fetch(`${server.url}/api/firmware${only.length > 0 ? `?only=${only.join(',')}` : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${TEST_ADMIN_TOKEN}` },
      body: image(version),
    });
  const publish = async (version: number, only: string[] = []): Promise<Release> => {
    const response = await upload(version, only);
    assert.equal(response.status, 201, await response.clone().text());
    return json<Release>(response);
  };
  const widen = (init: RequestInit = asAdmin()) => fetch(`${server.url}/api/firmware/widen`, { ...init, method: 'POST' });
  const status = async (): Promise<Status> => {
    const response = await fetch(`${server.url}/api/firmware/status`, asAdmin());
    assert.equal(response.status, 200);
    return json<Status>(response);
  };
  const staged = async (hostname: string): Promise<StagedDevice | undefined> => (await status()).rollout?.devices.find((d) => d.hostname === hostname);
  /** The board's update check finding the release waiting: it downloads the image. */
  const take = async ({ mac }: { mac: string }, running = 6) => {
    const response = await check(server.url, { mac, version: String(running) });
    assert.equal(response.status, 200);
    await response.arrayBuffer();
  };
  /** A Reading with the self-report a board running `fw` sends (firmware 3 and later). */
  const report = async (hostname: string, fw: number, extra: Record<string, unknown> = {}) => {
    const response = await client.readings.add({ device: hostname, temp: 71, humidity: 40, fw, ...extra });
    assert.equal(response.status, 201, await response.clone().text());
    return response;
  };
  const fault = async (hostname: string, fw: number) => {
    const response = await client.readings.add({ device: hostname, fault: 'sensor', fw });
    assert.equal(response.status, 202, await response.clone().text());
  };
  /** An Offline sweep pass `ms` from now, the app's clock moved on with it, as if the boards had been silent that long. */
  const sweepAfter = (ms: number) => {
    ahead = ms;
    return runOfflineSweep({ pool, config, sse, now: () => new Date(Date.now() + ms) });
  };
  const sendEmail = () => {
    assert.ok(config.notifications !== undefined, 'notifications are on');
    return runNotifierPass({ pool, config, mailer: createMailer(config.notifications), now: () => new Date(Date.now() + ahead) }, { timeZone: 'UTC' });
  };
  const queuedHolds = async () => {
    const [rows] = await pool.query<RowDataPacket[]>("SELECT incident_id AS incidentId, device_id AS deviceId FROM notifications WHERE kind = 'hold'");
    return rows;
  };
  const withoutTime = (hold: Hold | null | undefined) => (hold == null ? hold : { hostname: hold.hostname, reason: hold.reason, detail: hold.detail });
  const health = (device: StagedDevice | undefined) => device?.conditions?.map((c) => `${c.name} ${c.level}`);

  test('POST /api/firmware/widen turns a staged release into one for every Device, keeping who had it first and recording when', async () => {
    const published = await publish(7, [A.hostname]);
    assert.equal(published.stage, 'named');
    assert.deepEqual(published.staged, [A.hostname]);
    assert.deepEqual(published.only, [A.hostname]);
    assert.equal(published.widenedAt, null);
    const notYet = await check(server.url, { mac: D.mac, version: '6' });
    assert.equal(notYet.status, 304);
    await notYet.arrayBuffer();

    for (const init of [asDevice(), {}]) {
      const refused = await widen(init);
      assert.equal(refused.status, 401);
      await refused.arrayBuffer();
    }

    const response = await widen();
    assert.equal(response.status, 200);
    const widened = await json<Release>(response);
    assert.equal(widened.stage, 'all');
    assert.equal(widened.only, null);
    assert.deepEqual(widened.staged, [A.hostname]);
    assert.equal(widened.publishedAt, published.publishedAt);
    assert.ok(widened.widenedAt !== null && Math.abs(Date.parse(widened.widenedAt) - Date.now()) < 5 * SECOND, widened.widenedAt ?? 'null');
    await take(D);
    assert.equal((await status()).rollout, null, 'nothing staged is left to watch');

    // Again is no change; with nothing published there is nothing to widen.
    assert.equal((await json<Release>(await widen())).widenedAt, widened.widenedAt);
    await (await fetch(`${server.url}/api/firmware`, { method: 'DELETE', ...asAdmin() })).arrayBuffer();
    const none = await widen();
    assert.equal(none.status, 404);
    await none.arrayBuffer();
  });

  test('"Release to all" is offered once every named Device has sent ten clean Readings on the new version', async () => {
    await publish(7, [A.hostname, D.hostname]);
    await report(A.hostname, 6);
    await take(A);
    for (let i = 0; i < CLEAN_REPORTS_TO_WIDEN - 1; i++) await report(A.hostname, 7);
    const almost = await status();
    assert.equal(almost.rollout?.cleanReportsToWiden, CLEAN_REPORTS_TO_WIDEN);
    const a = almost.rollout?.devices.find((d) => d.hostname === A.hostname);
    assert.deepEqual(
      { firmwareVersion: a?.firmwareVersion, health: health(a), cleanReports: a?.cleanReports, ready: a?.ready },
      { firmwareVersion: 7, health: [], cleanReports: 9, ready: false },
    );
    assert.ok(a?.lastReportAt != null && Math.abs(Date.parse(a.lastReportAt) - Date.now()) < 5 * SECOND);
    assert.equal(almost.rollout?.ready, false);

    await report(A.hostname, 7);
    assert.equal((await staged(A.hostname))?.ready, true);
    assert.equal((await status()).rollout?.ready, false, 'the other named Device has not run it yet');

    // Flashed with it already over USB: its clean Readings count all the same.
    for (let i = 0; i < CLEAN_REPORTS_TO_WIDEN; i++) await report(D.hostname, 7);
    const both = await status();
    assert.deepEqual(both.rollout?.devices.map((d) => [d.hostname, d.ready]), [[A.hostname, true], [D.hostname, true]]);
    assert.equal(both.rollout?.ready, true);

    // One fault report is no Sensor fault, so nothing is held, but the count starts again.
    await fault(A.hostname, 7);
    const after = await status();
    assert.deepEqual(after.release?.hold, null);
    assert.equal(after.rollout?.devices.find((d) => d.hostname === A.hostname)?.cleanReports, 0);
    assert.equal(after.rollout?.ready, false);
  });

  test('hold on Offline: a named Device that took the new version and then goes Offline holds the release, which offers nothing more, and it is emailed', async () => {
    await publish(7, [A.hostname, D.hostname]);
    await report(A.hostname, 6);
    await take(A);
    await report(D.hostname, 6);
    // Both fall silent; only A had taken the build.
    await sweepAfter(2 * MINUTE);

    const held = await status();
    assert.deepEqual(withoutTime(held.release?.hold), { hostname: A.hostname, reason: 'Offline', detail: null });
    assert.ok(held.release?.hold?.at !== undefined && !Number.isNaN(Date.parse(held.release.hold.at)));
    assert.equal(held.rollout?.ready, false);
    assert.deepEqual(health(held.rollout?.devices.find((d) => d.hostname === A.hostname)), ['Offline warning']);

    // Nothing more is offered: D's check gets nothing, its Reading carries no nudge.
    const nothing = await check(server.url, { mac: D.mac, version: '6' });
    assert.equal(nothing.status, 304);
    await nothing.arrayBuffer();
    assert.equal((await report(D.hostname, 6)).headers.get('x-firmware-available'), null);

    // Neither "Release to all" nor publishing the same build again goes past it.
    const refused = await widen();
    assert.equal(refused.status, 409);
    assert.match(await errorOf(refused), /held.*ESP_A1B2C3.*Offline/);
    const again = await upload(7);
    assert.equal(again.status, 422);
    assert.match(await errorOf(again), /held/);

    // Emailed on its own, ahead of the Offline incidents' digest.
    assert.equal(await sendEmail(), 1);
    assert.equal(relay.received.length, 1);
    const [email] = relay.received;
    assert.equal(email.subject, '[Temperature Alarms] Firmware 7 held: ESP_A1B2C3 went Offline');
    assert.match(email.text, /Central High School \(CHS\), IDF 2, ESP_A1B2C3/);
    assert.match(email.text, /No other Device is offered it/);
    assert.match(email.text, /https:\/\/alarms\.district\.example\/settings\?tab=firmware/);
    assert.match(email.html, /Firmware 7 is held/);
    assert.ok((await sendEmail()) > 0, 'the incidents go next');

    // A higher version replaces it, and starts unheld.
    const next = await publish(8, [A.hostname]);
    assert.equal(next.hold, null);
    assert.equal(next.stage, 'named');
  });

  test("a hold goes to NOTIFY_TO, not the held Device's Campus list", async () => {
    await pool.query("UPDATE campuses SET notify_to = 'chs-techs@district.example'");
    await publish(7, [A.hostname]);
    await report(A.hostname, 6);
    await take(A);
    await sweepAfter(2 * MINUTE);

    // The hold to NOTIFY_TO and, being another list, the Offline incident to the Campus's own, in one pass.
    await sendEmail();
    const sent = relay.received.map((e) => ({ to: e.to, held: /Firmware 7 held/.test(e.subject) }));
    assert.deepEqual(sent.sort((a, b) => Number(b.held) - Number(a.held)), [
      { to: ['techs@district.example', 'oncall@district.example'], held: true },
      { to: ['chs-techs@district.example'], held: false },
    ]);
  });

  test('hold on a failed update: a named Device that reports after taking it that the update failed holds the release; with email off nothing is queued', async () => {
    await server.close();
    await serve(false);
    await publish(7, [A.hostname]);
    await report(A.hostname, 6);
    await take(A);
    await report(A.hostname, 6, { update: 'failed, Signature verification failed' });

    const { release } = await status();
    assert.deepEqual(withoutTime(release?.hold), { hostname: A.hostname, reason: 'update failed', detail: 'failed, Signature verification failed' });
    const nothing = await check(server.url, { mac: A.mac, version: '6' });
    assert.equal(nothing.status, 304, 'not offered to the board that failed it either');
    await nothing.arrayBuffer();
    assert.deepEqual(await queuedHolds(), []);
  });

  test('hold on Sensor fault, the third fault report in a row after taking it; a hold whose release is withdrawn before it is sent is dropped', async () => {
    await publish(7, [A.hostname]);
    await report(A.hostname, 6);
    await take(A);
    await report(A.hostname, 7);
    await fault(A.hostname, 7);
    await fault(A.hostname, 7);
    assert.equal((await status()).release?.hold, null, 'two are a hiccup');
    await fault(A.hostname, 7);

    const held = await status();
    assert.deepEqual(withoutTime(held.release?.hold), { hostname: A.hostname, reason: 'Sensor fault', detail: null });
    assert.deepEqual(health(held.rollout?.devices[0]), ['Sensor fault critical']);
    const holds = await queuedHolds();
    assert.equal(holds.length, 1);
    assert.equal(holds[0].incidentId, null, 'a hold is about the release, not an incident');

    await (await fetch(`${server.url}/api/firmware`, { method: 'DELETE', ...asAdmin() })).arrayBuffer();
    assert.equal(await sendEmail(), 1, 'only the Sensor fault incident goes');
    assert.equal(relay.received.length, 1);
    assert.doesNotMatch(relay.received[0].subject, /held/);
    assert.deepEqual(await queuedHolds(), []);
  });

  test('no hold for a Device that never took it: silent, or reporting a failure from before it was sent the release', async () => {
    await publish(7, [A.hostname]);
    await report(A.hostname, 6, { update: 'failed, HTTP error: connection refused' });
    assert.equal((await status()).release?.hold, null);
    await sweepAfter(2 * MINUTE);
    const { release, rollout } = await status();
    assert.equal(release?.hold, null);
    assert.deepEqual(health(rollout?.devices[0]), ['Offline warning'], 'Offline, but it never had the build');
    assert.deepEqual(await queuedHolds(), []);
  });

  test('once widened, a release is not held by the Devices it went to first', async () => {
    await publish(7, [A.hostname]);
    await report(A.hostname, 6);
    await take(A);
    await report(A.hostname, 7);
    await (await widen()).arrayBuffer();
    await sweepAfter(2 * MINUTE);
    assert.equal((await status()).release?.hold, null);
  });

  test('publishing the same build again for every Device widens a staged release, as before', async () => {
    const first = await publish(7, [A.hostname]);
    const again = await publish(7);
    assert.equal(again.stage, 'all');
    assert.equal(again.only, null);
    assert.deepEqual(again.staged, [A.hostname]);
    assert.equal(again.publishedAt, first.publishedAt);
    assert.ok(again.widenedAt !== null);
  });
});
