import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { createTestPool, resetDatabase } from './helpers/database';
import { startServer, testConfig, type RunningServer } from './helpers/server';
import { api, asAdmin, errorOf, json, type Device } from './helpers/api';
import { startTestRelay, type TestRelay } from './helpers/smtp';
import type { Config, NotificationsConfig } from '../src/config';
import { holdRelease } from '../src/firmwareStore';
import { insertIncident } from '../src/incidentStore';
import type { IncidentState } from '../src/incidents';
import { createMailer, MailerError } from '../src/mailer';
import { queueMonthlyReport, queueScheduledReport } from '../src/monthlyReport';
import { runNotifierPass } from '../src/notifier';
import { deleteNotificationsBefore } from '../src/outboxStore';

const CHICAGO = 'America/Chicago';
const SECOND = 1000;
const DAY_MS = 86_400_000;

/** Midnight on October 1 in Chicago (CDT): September has just ended there. */
const OCTOBER_1 = new Date('2026-10-01T05:00:00Z');

interface ReportRow {
  kind: string;
  month: string | null;
  incidentId: number | null;
  attempts: number;
  nextAttemptAt: Date;
  sentAt: Date | null;
  failedAt: Date | null;
  lastError: string | null;
  subject: string | null;
}

interface NotificationStatus {
  monthlyReport: boolean;
  lastSent: { at: string; subject: string } | null;
  lastFailure: { at: string; error: string } | null;
  pending: number;
  failed: number;
  lists: { recipients: string[]; isDefault: boolean; lastResult: { at: string; sent: boolean; subject?: string } | null }[];
}

describe('the monthly report: queued once a month through the outbox, and sent (docs/adr/0008)', () => {
  let pool: Pool;
  let relay: TestRelay;
  let server: RunningServer;
  let config: Config;
  let running = false;
  const extraRelays: TestRelay[] = [];

  const reportingConfig = (smtp: TestRelay, overrides: Partial<NotificationsConfig> = {}): Config =>
    testConfig({ notifications: { ...smtp.config(), coalesceSeconds: 0, monthlyReport: true, ...overrides } });

  /** A fresh app on the same database, its clock pinned when `now` is given. */
  const serve = async (next: Config, now?: () => Date) => {
    if (running) await server.close();
    config = next;
    server = await startServer(pool, config, now === undefined ? {} : { now });
    running = true;
  };

  before(async () => {
    pool = createTestPool();
    relay = await startTestRelay();
  });
  beforeEach(async () => {
    await resetDatabase(pool);
    relay.received.length = 0;
    await serve(reportingConfig(relay));
  });
  afterEach(async () => {
    await server.close();
    running = false;
    await Promise.all(extraRelays.splice(0).map((r) => r.close()));
  });
  after(async () => {
    await relay.close();
    await pool.end();
  });

  /** One pass of the sender at `now` (the wall clock's by default), months cut in Chicago, with a relay client made from the current config. */
  const pass = (now?: Date, current = config) => {
    assert.ok(current.notifications !== undefined, 'notifications are on');
    const clock = now === undefined ? {} : { now: () => now };
    return runNotifierPass({ pool, config: current, mailer: createMailer(current.notifications), ...clock }, { timeZone: CHICAGO });
  };
  const reports = async (): Promise<ReportRow[]> => {
    const [rows] = await pool.query<(ReportRow & RowDataPacket)[]>(
      `SELECT kind, report_month AS month, incident_id AS incidentId, attempts, next_attempt_at AS nextAttemptAt,
              sent_at AS sentAt, failed_at AS failedAt, last_error AS lastError, subject
       FROM notifications ORDER BY id`,
    );
    return rows;
  };
  const subjects = (smtp = relay) => smtp.received.map((e) => e.subject);
  const delivered = () => relay.received.map((e) => `${e.to.join(', ')}: ${e.subject}`);
  const status = async () => json<NotificationStatus>(await fetch(`${server.url}/api/notifications/status`, asAdmin()));

  const addDevice = async (hostname: string, closet: string, campus: { name: string; shortcode: string }): Promise<Device> => {
    const client = api(server);
    const existing = (await client.campuses.list()).find((c) => c.shortcode === campus.shortcode);
    const at = existing ?? (await client.campuses.create(campus.name, campus.shortcode));
    return client.devices.create(at.id, hostname, closet);
  };
  const readingAt = async (deviceId: number, iso: string, tempF: number, humidity = 40) => {
    await pool.query('INSERT INTO readings (device_id, temp_f, humidity, recorded_at) VALUES (?, ?, ?, ?)', [deviceId, tempF, humidity, new Date(iso)]);
  };
  const incidentAt = async (deviceId: number, condition: IncidentState['condition'], startIso: string, endIso: string | null) => {
    const start = new Date(startIso);
    const end = endIso === null ? null : new Date(endIso);
    const peak = { tempF: 71, humidity: 40, recordedAt: start };
    await insertIncident(pool, deviceId, { condition, level: 'critical', start, end, peak, segments: [{ level: 'critical', start, end }], cleanReadings: 0, firstCleanAt: null });
  };

  describe('the schedule', () => {
    test("the first pass on the 1st queues the month just ended and sends it once; later passes and a restart send nothing", async () => {
      assert.equal(await pass(new Date(OCTOBER_1.getTime() - SECOND)), 1, 'on September 30 the report due is August');
      assert.deepEqual(subjects(), ['[Temperature Alarms] Monthly report, August 2026: no incidents, no closet ran warm']);
      relay.received.length = 0;

      assert.equal(await pass(OCTOBER_1), 1);
      assert.deepEqual(subjects(), ['[Temperature Alarms] Monthly report, September 2026: no incidents, no closet ran warm']);
      const rows = await reports();
      assert.deepEqual(rows.map((r) => [r.kind, r.month, r.incidentId]), [['report', '2026-08', null], ['report', '2026-09', null]]);
      assert.ok(rows.every((r) => r.sentAt !== null && r.subject !== null), 'each row marked sent with its subject');

      // The same day, a week on, and after a restart (a new app and relay client on the same database).
      assert.equal(await pass(new Date(OCTOBER_1.getTime() + 15 * SECOND)), 0);
      await serve(reportingConfig(relay));
      assert.equal(await pass(new Date(OCTOBER_1.getTime() + 7 * DAY_MS)), 0);
      assert.equal(relay.received.length, 1, 'September sent once');
      assert.equal((await reports()).length, 2);
    });

    test('the month is remembered after the outbox prunes the sent row, so it is still not sent again', async () => {
      assert.equal(await pass(OCTOBER_1), 1);
      const later = new Date(OCTOBER_1.getTime() + 10 * DAY_MS);
      assert.ok((await deleteNotificationsBefore(pool, new Date(later.getTime() - 7 * DAY_MS))) >= 1);
      assert.deepEqual(await reports(), []);
      assert.equal(await pass(later), 0);
      assert.equal(relay.received.length, 1);
      // November 1 brings October's.
      assert.equal(await pass(new Date('2026-11-01T05:00:00Z')), 1);
      assert.equal(subjects()[1], '[Temperature Alarms] Monthly report, October 2026: no incidents, no closet ran warm');
    });

    test('two processes reaching the 1st at once queue it once', async () => {
      const queued = await Promise.all([queueScheduledReport(pool, OCTOBER_1, CHICAGO), queueScheduledReport(pool, OCTOBER_1, CHICAGO)]);
      assert.deepEqual(queued.filter((m) => m !== null), ['2026-09']);
      assert.equal((await reports()).length, 1);
    });

    test('off by default: no report is queued, though one asked for is still sent', async () => {
      await serve(reportingConfig(relay, { monthlyReport: false }));
      assert.equal(await pass(OCTOBER_1), 0);
      assert.deepEqual(await reports(), []);
      await queueMonthlyReport(pool, '2026-09', OCTOBER_1);
      assert.equal(await pass(OCTOBER_1), 1);
      assert.equal(relay.received.length, 1);
    });

    test('nothing happens while notifications are off', async () => {
      await queueMonthlyReport(pool, '2026-09', OCTOBER_1);
      assert.equal(await runNotifierPass({ pool, config: testConfig(), mailer: createMailer(relay.config()), now: () => OCTOBER_1 }), 0);
      assert.equal(relay.received.length, 0);
    });
  });

  test("the report is built from the month's Incidents and Readings, in the server's zone, leaving out the Bench and Devices added since", async () => {
    const chs = { name: 'Central High School', shortcode: 'CHS' };
    const idf2 = await addDevice('ESP_A1B2C3', 'IDF 2', chs);
    const mdf = await addDevice('ESP_D4E5F6', 'MDF', chs);
    const bench = await addDevice('ESP_BE0001', 'Shelf', { name: 'Bench', shortcode: 'BENCH' });
    // Readings either side of the month in Chicago: only September's count.
    await readingAt(idf2.id, '2026-09-01T04:59:59Z', 99);
    await readingAt(idf2.id, '2026-09-15T20:05:00Z', 91, 45);
    await readingAt(idf2.id, '2026-09-15T20:05:30Z', 91, 46);
    await readingAt(idf2.id, '2026-09-20T12:00:00Z', 80, 52);
    await readingAt(idf2.id, '2026-09-21T12:00:00Z', 70, 50);
    await readingAt(idf2.id, '2026-10-01T05:00:00Z', 99);
    await readingAt(mdf.id, '2026-09-10T18:00:00Z', 74, 61);
    await readingAt(bench.id, '2026-09-10T18:00:00Z', 95, 90);
    await incidentAt(idf2.id, 'Hot', '2026-09-15T19:00:00Z', '2026-09-15T21:00:00Z');
    await incidentAt(mdf.id, 'Offline', '2026-09-30T05:00:00Z', null);
    await incidentAt(bench.id, 'Offline', '2026-09-02T00:00:00Z', null);
    await incidentAt(idf2.id, 'Hot', '2026-10-02T00:00:00Z', null);
    // Added after September ended, with nothing in it; the API stamps the wall clock, so the date is set here.
    const added = await addDevice('ESP_0C70BE', 'IDF 9', chs);
    await pool.query('UPDATE devices SET created_at = ? WHERE id = ?', [new Date('2026-10-03T12:00:00Z'), added.id]);

    assert.equal(await pass(OCTOBER_1), 1);
    const [email] = relay.received;
    assert.equal(email.subject, '[Temperature Alarms] Monthly report, September 2026: 2 incidents, 1 closet ran warm');
    assert.deepEqual(email.to, ['techs@district.example', 'oncall@district.example'], 'to NOTIFY_TO');
    assert.match(email.text, /^Monthly report for September 2026: 2 closets at 1 Campus\./);
    assert.match(email.text, /Hot: 1 incident, 2 h in all\r?\nOffline: 1 incident, 1 d in all/);
    assert.match(email.text, /Central High School \(CHS\), IDF 2: 91 °F at Tue, Sep 15, 3:05 PM CDT\r?\nHistory: https:\/\/alarms\.district\.example\/history\/\d+\?date=2026-09-15/);
    assert.match(email.text, /Central High School \(CHS\), MDF: 61% at Thu, Sep 10, 1:00 PM CDT/);
    assert.match(email.text, /IDF 2: 75% of its Readings at 79 °F or above \(3 of 4\)/);
    assert.match(email.text, /Central High School \(CHS\), MDF, ESP_D4E5F6: Offline 1 d \(1 incident\)/);
    assert.doesNotMatch(email.text, /Bench|ESP_BE0001|IDF 9|99 °F|95 °F/);
    assert.match(email.html, new RegExp(`<a href="https://alarms\\.district\\.example/history/${idf2.id}\\?date=2026-09-15">Central High School \\(CHS\\), IDF 2</a>`));
  });

  test('SMTP down leaves the report pending with backoff and on the status; once the relay is back it is sent once', async () => {
    const flaky = await startTestRelay();
    extraRelays.push(flaky);
    await serve(reportingConfig(flaky));
    await flaky.close();

    await assert.rejects(pass(OCTOBER_1), MailerError);
    let [row] = await reports();
    assert.equal(row.sentAt, null);
    assert.equal(row.attempts, 1);
    assert.equal(row.nextAttemptAt.getTime() - OCTOBER_1.getTime(), 30 * SECOND, 'the first retry waits 30 s');
    assert.match(row.lastError ?? '', /ECONNREFUSED|connect/i);
    let shown = await status();
    assert.equal(shown.monthlyReport, true);
    assert.equal(shown.pending, 1);
    assert.match(shown.lastFailure?.error ?? '', /ECONNREFUSED|connect/i);
    assert.equal(await pass(new Date(OCTOBER_1.getTime() + 10 * SECOND)), 0, 'not due yet, and not queued again');
    assert.equal((await reports()).length, 1);

    const back = await startTestRelay({ port: flaky.port });
    extraRelays.push(back);
    assert.equal(await pass(new Date(OCTOBER_1.getTime() + 30 * SECOND)), 1);
    assert.equal(await pass(new Date(OCTOBER_1.getTime() + 90 * SECOND)), 0);
    assert.deepEqual(subjects(back), ['[Temperature Alarms] Monthly report, September 2026: no incidents, no closet ran warm']);
    [row] = await reports();
    assert.equal(row.attempts, 2);
    shown = await status();
    assert.equal(shown.pending, 0);
    assert.equal(shown.lastSent?.subject, '[Temperature Alarms] Monthly report, September 2026: no incidents, no closet ran warm');
    assert.deepEqual(
      shown.lists.map((l) => [l.isDefault, l.lastResult?.sent, l.lastResult?.subject]),
      [[true, true, '[Temperature Alarms] Monthly report, September 2026: no incidents, no closet ran warm']],
      "the result is NOTIFY_TO's",
    );
  });

  test('a report the relay never takes is given up on after a day, and Settings counts it', async () => {
    const flaky = await startTestRelay();
    extraRelays.push(flaky);
    await serve(reportingConfig(flaky));
    await flaky.close();
    await assert.rejects(pass(OCTOBER_1), MailerError);
    await assert.rejects(pass(new Date(OCTOBER_1.getTime() + DAY_MS)), MailerError);
    const [row] = await reports();
    assert.notEqual(row.failedAt, null);
    assert.equal(await pass(new Date(OCTOBER_1.getTime() + 2 * DAY_MS)), 0);
    assert.equal((await status()).failed, 1);
  });

  test('a report on a month that cannot be read is given up at once, and the next report still goes', async () => {
    await serve(reportingConfig(relay, { monthlyReport: false }));
    await queueMonthlyReport(pool, '2026-13', OCTOBER_1);
    assert.equal(await pass(OCTOBER_1), 0);
    const [row] = await reports();
    assert.notEqual(row.failedAt, null);
    assert.equal(row.lastError, 'Not a month: "2026-13"');
    await queueMonthlyReport(pool, '2026-09', OCTOBER_1);
    assert.equal(await pass(OCTOBER_1), 1);
    assert.equal(relay.received.length, 1);
  });

  test("a report is an email of its own to NOTIFY_TO alone, never in an Incident digest or with a hold: each takes NOTIFY_TO's turn in a pass", async () => {
    const NOTIFY_TO = 'techs@district.example, oncall@district.example';
    await serve(reportingConfig(relay, { monthlyReport: false }));
    const idf2 = await addDevice('ESP_A1B2C3', 'IDF 2', { name: 'Central High School', shortcode: 'CHS' });
    const mdf = await addDevice('ESP_D4E5F6', 'MDF', { name: 'Maple High School', shortcode: 'MHS' });
    // Central has a list of its own; Maple emails NOTIFY_TO.
    await pool.query("UPDATE campuses SET notify_to = 'chs-techs@district.example' WHERE shortcode = 'CHS'");
    for (const device of [idf2, mdf]) assert.equal((await api(server).readings.add({ device: device.hostname, temp: 85, humidity: 40 })).status, 201);
    // A staged release Maple's MDF fails, held by itself with its email queued; then the report.
    await pool.query("INSERT INTO firmware_release (id, version, md5, size, image, only_hostnames, published_at) VALUES (1, 7, REPEAT('0', 32), 1, 'x', ?, ?)", [
      mdf.hostname,
      new Date(Date.now() - 60 * SECOND),
    ]);
    assert.notEqual(await holdRelease(pool, 7, { hostname: mdf.hostname, reason: 'Offline', detail: null }, new Date(), true), null);
    await queueMonthlyReport(pool, '2026-09', new Date());

    assert.equal(await pass(), 2, "the hold takes NOTIFY_TO's turn; Central's list has its own");
    assert.equal(await pass(), 1, 'then the report');
    assert.equal(await pass(), 1, "then NOTIFY_TO's Incidents");
    assert.equal(await pass(), 0);
    const sent = delivered();
    assert.equal(sent.length, 4);
    assert.equal(sent[0], `${NOTIFY_TO}: [Temperature Alarms] Firmware 7 held: ESP_D4E5F6 went Offline`);
    assert.equal(sent[1], 'chs-techs@district.example: [Temperature Alarms] CHS IDF 2: Hot warning (85 °F)');
    // The Hot incidents began at the wall clock's now, so whether they fall in September is the clock's business.
    assert.ok(sent[2].startsWith(`${NOTIFY_TO}: [Temperature Alarms] Monthly report, September 2026: `), sent[2]);
    assert.equal(sent[3], `${NOTIFY_TO}: [Temperature Alarms] MHS MDF: Hot warning (85 °F)`);
    assert.doesNotMatch(relay.received[2].text, /Firmware 7 is held|Hot warning \(85/, 'the report carries neither the hold nor an Incident email');
  });

  describe("Settings: POST /api/notifications/report (send last month's report now)", () => {
    const press = (init: RequestInit = asAdmin()) => fetch(`${server.url}/api/notifications/report`, { ...init, method: 'POST' });

    test("queues last month's report and answers 202 with the month; the sender sends it, even with the schedule off", async () => {
      await serve(reportingConfig(relay, { monthlyReport: false }), () => new Date('2026-10-15T17:00:00Z'));
      const response = await press();
      assert.equal(response.status, 202);
      assert.deepEqual(await json(response), { month: '2026-09', queuedAt: '2026-10-15T17:00:00.000Z' });
      assert.deepEqual((await reports()).map((r) => [r.kind, r.month, r.sentAt]), [['report', '2026-09', null]]);
      assert.equal((await status()).pending, 1);
      assert.equal(await pass(new Date('2026-10-15T17:00:05Z')), 1);
      assert.deepEqual(subjects(), ['[Temperature Alarms] Monthly report, September 2026: no incidents, no closet ran warm']);
    });

    test('needs the Admin token, allows one a minute, and explains itself while email is off', async () => {
      for (const init of [{}, { headers: { Authorization: 'Bearer wrong-token' } }, { headers: { Authorization: 'Bearer test-device-token' } }]) {
        assert.equal((await press(init)).status, 401);
      }
      assert.equal((await press()).status, 202, 'refusals do not spend the allowance');
      const refused = await press();
      assert.equal(refused.status, 429);
      assert.match(await errorOf(refused), /one report a minute/i);
      assert.equal((await reports()).length, 1);

      await serve(testConfig());
      const off = await press();
      assert.equal(off.status, 409);
      assert.match(await errorOf(off), /off.*SMTP_HOST/);
    });
  });
});
