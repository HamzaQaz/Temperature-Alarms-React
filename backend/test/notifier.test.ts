import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { createTestPool, resetDatabase, testDatabaseConfig } from './helpers/database';
import { startServer, testConfig, type RunningServer } from './helpers/server';
import { api, asAdmin, json, type Campus, type Device, type RecordedReading } from './helpers/api';
import { startTestRelay, type TestRelay } from './helpers/smtp';
import { createGate, settlesWithin } from './helpers/gate';
import { createPool } from '../src/db';
import type { Config, NotificationsConfig } from '../src/config';
import { createListening, type Listening } from '../src/listening';
import { createMailer, MailerError, type Mailer } from '../src/mailer';
import { runNotifierPass, startNotifier, type NotifierOptions } from '../src/notifier';
import { runOfflineSweep } from '../src/offlineSweep';
import { deleteReadingsPastWindow } from '../src/retention';
import { createBroadcaster } from '../src/sse';
import { byRecipients, DEFAULT_RETRY, givesUp, listKey, notificationKinds, readyToSend, recipientLists, recipientsFor, reminderDue, retryDelayMs, type ChangeFacts } from '../src/outbox';

const SECOND = 1000;
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY_MS = 86_400_000;
/** Three Report intervals of 30 seconds: Offline begins the second after. */
const OFFLINE_AFTER_MS = 90_000;

interface OutboxRow {
  incidentId: number;
  kind: 'opened' | 'worse' | 'closed' | 'reminder';
  level: string;
  attempts: number;
  createdAt: Date;
  nextAttemptAt: Date;
  sentAt: Date | null;
  failedAt: Date | null;
  lastError: string | null;
  subject: string | null;
}

interface NotificationStatus {
  enabled: boolean;
  lastSent: { at: string; subject: string } | null;
  lastFailure: { at: string; error: string } | null;
  pending: number;
  failed: number;
  lists: {
    recipients: string[];
    campuses: string[];
    isDefault: boolean;
    lastResult: ({ at: string } & ({ sent: true; subject: string } | { sent: false; error: string })) | null;
  }[];
}

const whole = (ms: number) => new Date(Math.floor(ms / 1000) * 1000);

describe('email notifications: the outbox and the sender (docs/adr/0008)', () => {
  let pool: Pool;
  let relay: TestRelay;
  let server: RunningServer;
  let client: ReturnType<typeof api>;
  let config: Config;
  let mailer: Mailer | undefined;
  let running = false;
  const sse = createBroadcaster({ heartbeatMs: 60_000 });
  const extraRelays: TestRelay[] = [];

  /** Notifications through `smtp`, sent the moment they are due unless a test sets a window. */
  const notifyingConfig = (smtp: TestRelay, overrides: Partial<NotificationsConfig> = {}): Config =>
    testConfig({ notifications: { ...smtp.config(), coalesceSeconds: 0, ...overrides } });

  /** A fresh app on the same database, as after a restart, with its own relay client. */
  const serve = async (next: Config, listening?: Listening) => {
    if (running) await server.close();
    config = next;
    server = await startServer(pool, config, { sse, ...(listening === undefined ? {} : { listening }) });
    running = true;
    client = api(server);
    mailer = config.notifications === undefined ? undefined : createMailer(config.notifications);
  };

  before(async () => {
    pool = createTestPool();
    relay = await startTestRelay();
  });
  beforeEach(async () => {
    await resetDatabase(pool);
    relay.received.length = 0;
    await serve(notifyingConfig(relay));
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

  const registerDevice = async (hostname = 'ESP_A1B2C3', campus?: Campus, closet = 'IDF 2'): Promise<Device> => {
    const at = campus ?? (await client.campuses.create());
    return client.devices.create(at.id, hostname, closet);
  };
  const postReading = async (temp: number, humidity = 40, device = 'ESP_A1B2C3'): Promise<RecordedReading> => {
    const response = await client.readings.add({ device, temp, humidity });
    assert.equal(response.status, 201, await response.clone().text());
    return json<RecordedReading>(response);
  };
  const postFault = async (device = 'ESP_A1B2C3') => {
    const response = await client.readings.add({ device, fault: 'sensor' });
    assert.equal(response.status, 202, await response.clone().text());
  };
  // Ingest stamps the server's time, so a Reading at a chosen instant can only be arranged by writing the row directly.
  const readingAt = async (deviceId: number, recordedAt: Date, tempF = 71, humidity = 44) => {
    await pool.query('INSERT INTO readings (device_id, temp_f, humidity, recorded_at) VALUES (?, ?, ?, ?)', [deviceId, tempF, humidity, recordedAt]);
  };
  const sweep = (now = new Date(), listening?: Listening) => runOfflineSweep({ pool, config, sse, now: () => now, listening });
  /** One sender pass at `now` (the wall clock by default), its times written in UTC. */
  const pass = (now?: Date, options: NotifierOptions = {}) => {
    assert.ok(mailer !== undefined, 'notifications are on');
    return runNotifierPass({ pool, config, mailer, now: now === undefined ? undefined : () => now }, { timeZone: 'UTC', ...options });
  };
  const outbox = async (): Promise<OutboxRow[]> => {
    const [rows] = await pool.query<(OutboxRow & RowDataPacket)[]>(
      `SELECT incident_id AS incidentId, kind, level, attempts, created_at AS createdAt, next_attempt_at AS nextAttemptAt,
              sent_at AS sentAt, failed_at AS failedAt, last_error AS lastError, subject
       FROM notifications ORDER BY id`,
    );
    return rows;
  };
  const kinds = async () => (await outbox()).map((r) => `${r.kind} ${r.level}`);
  const subjects = () => relay.received.map((e) => e.subject);
  const status = async () => json<NotificationStatus>(await fetch(`${server.url}/api/notifications/status`, asAdmin()));

  describe('what is queued', () => {
    test('an incident opening queues one row and one email arrives, then the row is sent and not sent again', async () => {
      await registerDevice();
      await postReading(72);
      assert.deepEqual(await outbox(), [], 'a calm Reading queues nothing');

      await postReading(85);
      assert.deepEqual(await kinds(), ['opened warning']);
      assert.equal(await pass(), 1);
      assert.deepEqual(subjects(), ['[Temperature Alarms] CHS IDF 2: Hot warning (85 °F)']);
      assert.deepEqual(relay.received[0].to, ['techs@district.example', 'oncall@district.example']);
      const [row] = await outbox();
      assert.notEqual(row.sentAt, null);
      assert.equal(row.subject, '[Temperature Alarms] CHS IDF 2: Hot warning (85 °F)');

      assert.equal(await pass(), 0);
      assert.equal(relay.received.length, 1, 'sent once');
    });

    test('a level rising to a new worst sends "worse"; falling back, or rising again to a level already reached, sends nothing', async () => {
      await registerDevice();
      await postReading(85);
      await pass();
      await postReading(91);
      assert.deepEqual(await kinds(), ['opened warning', 'worse critical']);
      await pass();
      assert.equal(subjects()[1], '[Temperature Alarms] CHS IDF 2: Hot critical, got worse (91 °F)');

      await postReading(86);
      await postReading(92);
      assert.deepEqual(await kinds(), ['opened warning', 'worse critical'], 'a fall, and a swing back up to critical, queue nothing');
      assert.equal(await pass(), 0);
      assert.equal(relay.received.length, 2);
    });

    test('closing sends "resolved", with the end and how long it lasted', async () => {
      await registerDevice();
      await postReading(91);
      await pass();
      await postReading(72);
      assert.deepEqual(await kinds(), ['opened critical'], 'one clean Reading is a blip');
      await postReading(72);
      assert.deepEqual(await kinds(), ['opened critical', 'closed critical']);
      await pass();
      assert.equal(subjects()[1], '[Temperature Alarms] CHS IDF 2: Hot critical, resolved (91 °F)');
      assert.match(relay.received[1].text, /Ended: .*, after under a minute/);
    });

    test('Offline opens through the sweep and closes on the next Reading, each emailed', async () => {
      const device = await registerDevice();
      await readingAt(device.id, whole(Date.now() - 5 * MINUTE));
      assert.equal(await sweep(), 1);
      assert.deepEqual(await kinds(), ['opened warning']);
      await pass();
      assert.equal(subjects()[0], '[Temperature Alarms] CHS IDF 2: Offline');
      assert.match(relay.received[0].text, /Offline: opened \(the server has not heard from the board\)/);
      assert.match(relay.received[0].text, /Last Reading before the silence: 71 °F, 44% at /);

      await postReading(72);
      await pass();
      assert.equal(subjects()[1], '[Temperature Alarms] CHS IDF 2: Offline, resolved');
    });

    test('an Offline stretch ingest records already closed is emailed once, as opened and resolved', async () => {
      const device = await registerDevice();
      // Offline began 9 seconds ago, inside the sweep's period, and no pass has run since.
      await readingAt(device.id, whole(Date.now() - OFFLINE_AFTER_MS - 10_000));
      await postReading(72);
      assert.deepEqual(await kinds(), ['opened warning', 'closed warning']);
      assert.equal(await pass(), 2);
      assert.deepEqual(subjects(), ['[Temperature Alarms] CHS IDF 2: Offline, opened and resolved']);
    });

    test('a Sensor fault is emailed like any other, saying what it means and the last good Reading', async () => {
      await registerDevice();
      await postReading(72, 40);
      await postFault();
      await postFault();
      assert.deepEqual(await outbox(), []);
      await postFault();
      assert.deepEqual(await kinds(), ['opened critical']);
      await pass();
      const [email] = relay.received;
      assert.equal(email.subject, '[Temperature Alarms] CHS IDF 2: Sensor fault');
      assert.match(email.text, /Sensor fault: opened \(the board is online but its sensor is not answering\)/);
      assert.match(email.text, /Last good Reading: 72 °F, 40% at /);

      await postReading(72);
      await postReading(72);
      await pass();
      assert.equal(subjects()[1], '[Temperature Alarms] CHS IDF 2: Sensor fault, resolved');
    });

    test('a Device on the Bench stays silent: its incidents are recorded, nothing is queued', async () => {
      const bench = await client.campuses.create('Bench', 'bench');
      const device = await registerDevice('ESP_A1B2C3', bench, 'Shelf');
      await postReading(91);
      await readingAt(device.id, whole(Date.now() - 5 * MINUTE));
      const other = await registerDevice('ESP_D4E5F6', bench, 'Shelf');
      await readingAt(other.id, whole(Date.now() - 5 * MINUTE));
      assert.equal(await sweep(), 1, 'the silent one goes Offline');
      const [incidents] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM incidents');
      assert.equal(incidents[0].n, 2, 'both incidents are recorded');
      assert.deepEqual(await outbox(), []);
      assert.equal(await pass(), 0);
      assert.equal(relay.received.length, 0);
    });

    test('with notifications off nothing is queued, from ingest or the sweep', async () => {
      await serve(testConfig());
      const device = await registerDevice();
      await postReading(91);
      const silent = await registerDevice('ESP_D4E5F6', device.campus);
      await readingAt(silent.id, whole(Date.now() - 5 * MINUTE));
      assert.equal(await sweep(), 1);
      assert.deepEqual(await outbox(), []);
      assert.equal(await runNotifierPass({ pool, config, mailer: createMailer(relay.config()) }), 0, 'and the sender does nothing');
      assert.equal(relay.received.length, 0);
    });

    test('Reset history and deleting the Device take pending rows with them', async () => {
      const device = await registerDevice();
      await postReading(91);
      assert.equal((await outbox()).length, 1);
      assert.equal((await client.devices.resetHistory(device.id)).status, 204);
      assert.deepEqual(await outbox(), []);

      await postReading(91);
      assert.equal((await outbox()).length, 1);
      assert.equal((await fetch(client.devices.url(`/${device.id}`), { ...asAdmin(), method: 'DELETE' })).status, 204);
      assert.deepEqual(await outbox(), []);
      assert.equal(await pass(), 0);
    });
  });

  describe('delivery', () => {
    test('SMTP down leaves the row pending with backoff; once the relay is back it is delivered once', async () => {
      const flaky = await startTestRelay();
      extraRelays.push(flaky);
      await serve(notifyingConfig(flaky));
      await registerDevice();
      await postReading(85);
      await flaky.close();

      const failedAt = new Date();
      await assert.rejects(pass(failedAt), MailerError);
      let [row] = await outbox();
      assert.equal(row.sentAt, null);
      assert.equal(row.attempts, 1);
      assert.equal(row.nextAttemptAt.getTime() - failedAt.getTime(), 30 * SECOND, 'the first retry waits 30 s');
      assert.match(row.lastError ?? '', /ECONNREFUSED|connect/i);
      let shown = await status();
      assert.equal(shown.pending, 1);
      assert.equal(shown.lastSent, null);
      assert.match(shown.lastFailure?.error ?? '', /ECONNREFUSED|connect/i);

      assert.equal(await pass(new Date(failedAt.getTime() + 10 * SECOND)), 0, 'not due yet');
      await assert.rejects(pass(new Date(failedAt.getTime() + 30 * SECOND)), MailerError);
      [row] = await outbox();
      assert.equal(row.attempts, 2);
      assert.equal(row.nextAttemptAt.getTime() - failedAt.getTime(), 90 * SECOND, 'the second waits a minute');

      const back = await startTestRelay({ port: flaky.port });
      extraRelays.push(back);
      assert.equal(await pass(new Date(failedAt.getTime() + 90 * SECOND)), 1);
      assert.equal(await pass(new Date(failedAt.getTime() + 200 * SECOND)), 0);
      assert.deepEqual(back.received.map((e) => e.subject), ['[Temperature Alarms] CHS IDF 2: Hot warning (85 °F)'], 'delivered once');
      [row] = await outbox();
      assert.notEqual(row.sentAt, null);
      shown = await status();
      assert.equal(shown.pending, 0);
      assert.equal(shown.lastSent?.subject, '[Temperature Alarms] CHS IDF 2: Hot warning (85 °F)');
      assert.ok(shown.lastFailure !== null, 'the failure stays on record');
    });

    test('backoff doubles to its cap, and a day after it was queued the row is given up and shown as failed', async () => {
      const flaky = await startTestRelay();
      await flaky.close();
      await serve(notifyingConfig(flaky));
      await registerDevice();
      await postReading(85);
      const [{ createdAt }] = await outbox();
      const retry = { firstMs: 30 * SECOND, maxMs: 15 * MINUTE, giveUpMs: DAY_MS };

      const waits: number[] = [];
      let at = createdAt;
      for (let i = 0; i < 7; i++) {
        await assert.rejects(pass(at, { retry }));
        const [row] = await outbox();
        waits.push((row.nextAttemptAt.getTime() - at.getTime()) / SECOND);
        at = row.nextAttemptAt;
      }
      assert.deepEqual(waits, [30, 60, 120, 240, 480, 900, 900]);
      assert.equal((await outbox())[0].failedAt, null);

      const dayLater = new Date(createdAt.getTime() + DAY_MS);
      await assert.rejects(pass(dayLater, { retry }));
      const [row] = await outbox();
      assert.deepEqual(row.failedAt, dayLater);
      assert.equal(await pass(new Date(dayLater.getTime() + DAY_MS), { retry }), 0, 'a failed row is not tried again');
      const shown = await status();
      assert.equal(shown.pending, 0);
      assert.equal(shown.failed, 1);
      assert.match(shown.lastFailure?.error ?? '', /^Given up after a day of retries: /);
    });

    test('a restart with pending rows delivers them once', async () => {
      await registerDevice();
      await postReading(85);
      await postReading(91);
      // The process stops before its sender ran; a new one starts on the same database.
      await serve(config);
      assert.equal(await pass(), 2);
      assert.equal(await pass(), 0);
      assert.equal(relay.received.length, 1, 'one email for both');
      assert.equal(relay.received[0].subject, '[Temperature Alarms] CHS IDF 2: Hot critical (91 °F)');
      assert.equal((await status()).lastSent?.subject, '[Temperature Alarms] CHS IDF 2: Hot critical (91 °F)', 'read from the outbox, so it outlives the process');
    });

    test('a pass cut short before it marked its rows leaves them for the next, which delivers them once', async () => {
      await registerDevice();
      await postReading(85);
      const dying: Mailer = {
        send: async () => {
          throw new Error('the process went away');
        },
      };
      await assert.rejects(runNotifierPass({ pool, config, mailer: dying }), /went away/);
      const [row] = await outbox();
      assert.equal(row.sentAt, null);
      assert.equal(row.attempts, 0, 'rolled back, so not counted as a try');
      assert.equal(await pass(), 1);
      assert.equal(await pass(), 0);
      assert.equal(relay.received.length, 1);
    });

    test('the scheduled sender delivers on its own', async () => {
      await registerDevice();
      await postReading(85);
      assert.ok(mailer !== undefined);
      const notifier = startNotifier({ pool, config, mailer }, { intervalMs: 100, timeZone: 'UTC' });
      try {
        for (let i = 0; i < 50 && relay.received.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 50));
      } finally {
        await notifier.stop();
      }
      assert.equal(relay.received.length, 1);
    });

    test('stop waits for a send in flight, which marks its rows sent, so the next process does not send them again', async () => {
      await registerDevice();
      await postReading(85);
      assert.ok(mailer !== undefined);
      const relayMailer = mailer;
      const gate = createGate();
      const slow: Mailer = {
        send: async (email) => {
          await gate.wait();
          return relayMailer.send(email);
        },
      };
      const notifier = startNotifier({ pool, config, mailer: slow }, { intervalMs: 50, timeZone: 'UTC' });

      await gate.reached;
      const stopped = notifier.stop();
      try {
        assert.equal(await settlesWithin(stopped, 150), false, 'stop waits for the send');
      } finally {
        // Otherwise the held claim's row locks would block every later test's reset.
        gate.open();
      }
      await stopped;
      assert.equal(relay.received.length, 1);
      const [row] = await outbox();
      assert.notEqual(row.sentAt, null, 'marked sent before the stop resolved');
      assert.equal(await pass(), 0, 'nothing left to send again');
      assert.equal(relay.received.length, 1);
    });
  });

  describe('the server\'s own downtime sends nothing (docs/adr/0006)', () => {
    test('a restart continues an open incident without emailing it again', async () => {
      await registerDevice();
      await postReading(85);
      await pass();
      await serve(config);
      await postReading(86);
      await postReading(84);
      assert.deepEqual(await kinds(), ['opened warning']);
      assert.equal(await pass(), 0);
      assert.equal(relay.received.length, 1);
    });

    test('after a start, Devices silent through the downtime get a whole Offline window: nothing is queued', async () => {
      const device = await registerDevice();
      const started = whole(Date.now() - MINUTE);
      await readingAt(device.id, new Date(started.getTime() - 4 * MINUTE));
      const listening = createListening(started);
      assert.equal(await sweep(new Date(), listening), 0);
      assert.equal(await sweep(new Date(started.getTime() + OFFLINE_AFTER_MS), listening), 0);
      assert.deepEqual(await outbox(), []);
      assert.equal(await pass(), 0);
    });

    test('a database outage restarts the count: the first good pass queues nothing', async () => {
      const device = await registerDevice();
      await readingAt(device.id, whole(Date.now() - 5 * MINUTE));
      const listening = createListening(new Date(Date.now() - DAY_MS));
      const unreachable = createPool({ ...testDatabaseConfig(), host: '127.0.0.1', port: 1 });
      try {
        await assert.rejects(runOfflineSweep({ pool: unreachable, config, sse, listening }));
      } finally {
        await unreachable.end();
      }
      assert.equal(await sweep(whole(Date.now()), listening), 0);
      assert.deepEqual(await outbox(), []);
      assert.equal(await pass(), 0);
    });

    test('a Device back right after a database outage queues no Offline stretch for it', async () => {
      const listening = createListening(new Date(Date.now() - DAY_MS));
      await serve(config, listening);
      const device = await registerDevice();
      await readingAt(device.id, whole(Date.now() - OFFLINE_AFTER_MS - 10_000));
      listening.lost();
      await postReading(72);
      assert.deepEqual(await outbox(), []);
      assert.equal(await pass(), 0);
      assert.equal(relay.received.length, 0);
    });
  });

  describe('one email per burst', () => {
    test('twenty Offline incidents in one sweep arrive as one email, once the window has passed', async () => {
      await serve(notifyingConfig(relay, { coalesceSeconds: 60 }));
      const campus = await client.campuses.create();
      for (let i = 0; i < 20; i++) {
        const device = await registerDevice(`ESP_0000${String(i).padStart(2, '0')}`, campus, `IDF ${i + 1}`);
        await readingAt(device.id, whole(Date.now() - 5 * MINUTE));
      }
      const at = whole(Date.now());
      assert.equal(await sweep(at), 20);
      assert.equal(await pass(new Date(at.getTime() + 59 * SECOND)), 0, 'inside the window, nothing yet');
      assert.equal(await pass(new Date(at.getTime() + 60 * SECOND)), 20);
      assert.equal(relay.received.length, 1);
      const [email] = relay.received;
      assert.equal(email.subject, '[Temperature Alarms] 20 incidents: 20 Offline');
      assert.equal(email.text.match(/^Offline: opened/gm)?.length, 20, 'every closet listed');
      assert.match(email.html, /<a href="https:\/\/alarms\.district\.example\/history\/\d+\?date=\d{4}-\d{2}-\d{2}">/);
    });

    test('an incident that opens and closes inside the window is listed once, as opened and resolved, worst first', async () => {
      await serve(notifyingConfig(relay, { coalesceSeconds: 60 }));
      const device = await registerDevice();
      await postReading(91);
      await postReading(72);
      await postReading(72);
      const silent = await registerDevice('ESP_D4E5F6', device.campus, 'MDF');
      await readingAt(silent.id, whole(Date.now() - 5 * MINUTE));
      await sweep();
      assert.equal(await pass(), 0, 'the window has not passed');
      assert.equal(await pass(new Date(Date.now() + 61 * SECOND)), 3);
      assert.equal(relay.received.length, 1);
      const [email] = relay.received;
      assert.equal(email.subject, '[Temperature Alarms] 2 incidents: 1 Hot, 1 Offline (1 resolved)');
      assert.match(email.text, /^Hot critical: opened and resolved\r?\n[^]*^Offline: opened/m, 'critical before warning');
      assert.equal(email.text.match(/^Hot critical/gm)?.length, 1);
    });

    test('a burst that keeps arriving still sends each notification within two windows', async () => {
      const window = 60 * SECOND;
      await serve(notifyingConfig(relay, { coalesceSeconds: 60 }));
      const campus = await client.campuses.create();
      const start = whole(Date.now() - 30 * MINUTE);
      // One closet goes Offline every 20 seconds for three minutes.
      for (let i = 0; i < 9; i++) {
        const device = await registerDevice(`ESP_0000${String(i).padStart(2, '0')}`, campus, `IDF ${i + 1}`);
        await readingAt(device.id, new Date(start.getTime() - OFFLINE_AFTER_MS - SECOND + i * 20 * SECOND));
      }
      // The sweep every 30 s and the sender every 5 s, over five minutes.
      for (let t = 0; t <= 5 * MINUTE; t += 5 * SECOND) {
        const at = new Date(start.getTime() + t);
        if (t % (30 * SECOND) === 0) await sweep(at);
        await pass(at);
      }
      const rows = await outbox();
      assert.equal(rows.length, 9);
      for (const row of rows) {
        assert.ok(row.sentAt !== null, 'all sent');
        assert.ok(row.sentAt.getTime() - row.createdAt.getTime() < 2 * window, `sent ${(row.sentAt.getTime() - row.createdAt.getTime()) / SECOND} s after it was queued`);
      }
      assert.ok(relay.received.length <= 3, `${relay.received.length} emails for nine incidents`);
    });
  });

  describe('recipients per Campus', () => {
    const CHS_TO = 'chs-techs@district.example';
    const MHS_TO = 'mhs-techs@district.example';
    const NOTIFY_TO = 'techs@district.example, oncall@district.example';
    const campusWith = async (name: string, shortcode: string, notifyTo?: string): Promise<Campus> => {
      const response = await client.campuses.add({ name, shortcode, notifyTo });
      assert.equal(response.status, 201, await response.clone().text());
      return json<Campus>(response);
    };
    /** Two Campuses with their own lists, each with a Device in a Hot incident, Central's queued first. */
    const twoOutages = async () => {
      const chs = await campusWith('Central High School', 'CHS', CHS_TO);
      const mhs = await campusWith('Maple High School', 'MHS', MHS_TO);
      await registerDevice('ESP_A1B2C3', chs, 'IDF 2');
      await registerDevice('ESP_D4E5F6', mhs, 'MDF');
      await postReading(85, 40, 'ESP_A1B2C3');
      await postReading(91, 40, 'ESP_D4E5F6');
      return { chs, mhs };
    };
    const delivered = () => relay.received.map((e) => `${e.to.join(', ')}: ${e.subject}`);
    const lastResultOf = (shown: NotificationStatus, recipients: string) => shown.lists.find((l) => l.recipients.join(', ') === recipients)?.lastResult;

    test('two Campuses, two lists, one outage each: two emails, each to its own list only', async () => {
      await twoOutages();
      assert.equal(await pass(), 2);
      assert.deepEqual(delivered().sort(), [
        `${CHS_TO}: [Temperature Alarms] CHS IDF 2: Hot warning (85 °F)`,
        `${MHS_TO}: [Temperature Alarms] MHS MDF: Hot critical (91 °F)`,
      ]);
      assert.equal(await pass(), 0);
      assert.equal(relay.received.length, 2, 'each sent once');
    });

    test('Campuses without a list of their own share one email to NOTIFY_TO, apart from one with its own; Settings shows who is on which', async () => {
      const chs = await campusWith('Central High School', 'CHS');
      const mhs = await campusWith('Maple High School', 'MHS');
      const nhs = await campusWith('North High School', 'NHS', 'nhs-techs@district.example');
      await registerDevice('ESP_A1B2C3', chs);
      await registerDevice('ESP_D4E5F6', mhs);
      await registerDevice('ESP_0A0B0C', nhs);
      for (const device of ['ESP_A1B2C3', 'ESP_D4E5F6', 'ESP_0A0B0C']) await postReading(85, 40, device);
      assert.equal(await pass(), 3);
      assert.deepEqual(delivered().sort(), [
        'nhs-techs@district.example: [Temperature Alarms] NHS IDF 2: Hot warning (85 °F)',
        `${NOTIFY_TO}: [Temperature Alarms] 2 incidents: 2 Hot`,
      ]);
      const shown = await status();
      assert.deepEqual(
        shown.lists.map(({ recipients, campuses, isDefault }) => ({ recipients, campuses, isDefault })),
        [
          { recipients: ['techs@district.example', 'oncall@district.example'], campuses: ['CHS', 'MHS'], isDefault: true },
          { recipients: ['nhs-techs@district.example'], campuses: ['NHS'], isDefault: false },
        ],
      );
      assert.equal(lastResultOf(shown, NOTIFY_TO)?.sent, true);
      const nhsResult = lastResultOf(shown, 'nhs-techs@district.example');
      assert.ok(nhsResult !== undefined && nhsResult !== null);
      assert.deepEqual(nhsResult, { at: nhsResult.at, sent: true, subject: '[Temperature Alarms] NHS IDF 2: Hot warning (85 °F)' });
    });

    test('a failing list retries without resending the other, and Settings gives the last result of each', async () => {
      await twoOutages();
      relay.refuse.add(CHS_TO);
      const failedAt = new Date();
      await assert.rejects(pass(failedAt), MailerError);
      assert.deepEqual(delivered(), [`${MHS_TO}: [Temperature Alarms] MHS MDF: Hot critical (91 °F)`], 'the other list still went');
      let [chsRow, mhsRow] = await outbox();
      assert.equal(chsRow.sentAt, null);
      assert.equal(chsRow.attempts, 1);
      assert.equal(chsRow.nextAttemptAt.getTime() - failedAt.getTime(), 30 * SECOND, 'its own backoff');
      assert.notEqual(mhsRow.sentAt, null);
      let shown = await status();
      const failure = lastResultOf(shown, CHS_TO);
      assert.ok(failure !== undefined && failure !== null && !failure.sent);
      assert.match(failure.error, /mailbox unavailable/);
      assert.equal(lastResultOf(shown, MHS_TO)?.sent, true);
      assert.equal(lastResultOf(shown, NOTIFY_TO), null, 'NOTIFY_TO, on no Campus here, has sent nothing');
      assert.equal(shown.pending, 1);

      relay.refuse.clear();
      assert.equal(await pass(new Date(failedAt.getTime() + 10 * SECOND)), 0, 'not due yet');
      assert.equal(await pass(new Date(failedAt.getTime() + 30 * SECOND)), 1);
      assert.deepEqual(
        delivered(),
        [`${MHS_TO}: [Temperature Alarms] MHS MDF: Hot critical (91 °F)`, `${CHS_TO}: [Temperature Alarms] CHS IDF 2: Hot warning (85 °F)`],
        'the retry sent only the list that failed',
      );
      [chsRow, mhsRow] = await outbox();
      assert.notEqual(chsRow.sentAt, null);
      assert.equal(mhsRow.attempts, 1, 'the other was not tried again');
      shown = await status();
      assert.equal(lastResultOf(shown, CHS_TO)?.sent, true);
    });

    test('each list waits its own window: a retry in one does not hurry another', async () => {
      await serve(notifyingConfig(relay, { coalesceSeconds: 60 }));
      await twoOutages();
      const [{ createdAt: t0 }, mhsRow] = await outbox();
      const at = (seconds: number) => new Date(t0.getTime() + seconds * SECOND);
      // The Maple row arrives 40 s after the Central one.
      await pool.query('UPDATE notifications SET created_at = ?, next_attempt_at = ? WHERE incident_id = ?', [at(40), at(40), mhsRow.incidentId]);
      relay.refuse.add(CHS_TO);
      await assert.rejects(pass(at(60)), MailerError);
      relay.refuse.clear();
      assert.equal(await pass(at(90)), 1, 'the retry goes at once; Maple has waited only 50 s');
      assert.deepEqual(delivered(), [`${CHS_TO}: [Temperature Alarms] CHS IDF 2: Hot warning (85 °F)`]);
      assert.equal(await pass(at(99)), 0);
      assert.equal(await pass(at(100)), 1);
      assert.equal(delivered()[1], `${MHS_TO}: [Temperature Alarms] MHS MDF: Hot critical (91 °F)`);
    });

    test('NOTIFY_TO_ALL keeps NOTIFY_TO on every email', async () => {
      await serve(notifyingConfig(relay, { toAll: true }));
      await twoOutages();
      assert.equal(await pass(), 2);
      assert.deepEqual(delivered().sort(), [
        `${CHS_TO}, ${NOTIFY_TO}: [Temperature Alarms] CHS IDF 2: Hot warning (85 °F)`,
        `${MHS_TO}, ${NOTIFY_TO}: [Temperature Alarms] MHS MDF: Hot critical (91 °F)`,
      ]);
    });

    test('a list changed while a row waits sends it to the list as it stands, and emptied falls back on NOTIFY_TO', async () => {
      const { chs, mhs } = await twoOutages();
      const put = (id: number, notifyTo: string) => fetch(client.campuses.url(`/${id}`), { ...asAdmin(), method: 'PATCH', body: JSON.stringify({ notifyTo }) });
      assert.equal((await put(chs.id, 'new-chs@district.example')).status, 200);
      assert.equal((await put(mhs.id, '')).status, 200);
      assert.equal(await pass(), 2);
      assert.deepEqual(delivered().sort(), [
        'new-chs@district.example: [Temperature Alarms] CHS IDF 2: Hot warning (85 °F)',
        `${NOTIFY_TO}: [Temperature Alarms] MHS MDF: Hot critical (91 °F)`,
      ]);
    });
  });

  describe('reminders for long incidents', () => {
    /** Reminders every four hours, sent the moment they are due. */
    const reminding = () => serve(notifyingConfig(relay, { remindHours: 4 }));
    /** A Hot critical incident whose start is moved back to `start`, with nothing left in the outbox. Returns its id. */
    const hotSince = async (start: Date, hostname = 'ESP_A1B2C3', campus?: Campus, closet = 'IDF 2'): Promise<number> => {
      await registerDevice(hostname, campus, closet);
      await postReading(91, 40, hostname);
      const [[{ id }]] = await pool.query<RowDataPacket[]>(
        'SELECT i.id FROM incidents i JOIN devices d ON d.id = i.device_id WHERE d.hostname = ? AND i.ended_at IS NULL',
        [hostname],
      );
      await pool.query('UPDATE incidents SET started_at = ? WHERE id = ?', [start, id]);
      await pool.query('DELETE FROM notifications');
      return id as number;
    };
    const reminders = async () => (await outbox()).filter((r) => r.kind === 'reminder');

    test('one reminder per period, counted from the start, emailed as still open', async () => {
      await reminding();
      const start = whole(Date.now() - 4 * HOUR - 10 * MINUTE);
      await hotSince(start);
      await sweep(new Date(start.getTime() + 4 * HOUR - SECOND));
      assert.deepEqual(await reminders(), [], 'not before a whole period');

      await sweep(new Date(start.getTime() + 4 * HOUR + 10 * MINUTE));
      assert.deepEqual((await reminders()).map((r) => `${r.kind} ${r.level}`), ['reminder critical']);
      await sweep(new Date(start.getTime() + 4 * HOUR + 11 * MINUTE));
      assert.equal((await reminders()).length, 1, 'a second pass in the same period queues nothing');
      assert.equal(await pass(), 1);
      assert.deepEqual(subjects(), ['[Temperature Alarms] Still open: CHS IDF 2 Hot critical, 4 h']);
      assert.match(relay.received[0].text, /^Hot critical: still open after 4 h$/m);
      assert.match(relay.received[0].text, /^Not acknowledged yet: acknowledging it on the Dashboard stops these reminders$/m);

      // The next is due 8 h after the start, not 4 h after the first reminder was queued.
      await sweep(new Date(start.getTime() + 8 * HOUR - SECOND));
      assert.equal((await reminders()).length, 1);
      await sweep(new Date(start.getTime() + 8 * HOUR));
      assert.equal((await reminders()).length, 2);
    });

    test('a gap of several periods queues one reminder, not one for each', async () => {
      await reminding();
      const start = whole(Date.now() - 13 * HOUR);
      const id = await hotSince(start);
      await sweep();
      assert.equal((await reminders()).length, 1);
      const [[{ lastRemindedAt }]] = await pool.query<RowDataPacket[]>('SELECT last_reminded_at AS lastRemindedAt FROM incidents WHERE id = ?', [id]);
      assert.deepEqual(lastRemindedAt, new Date(start.getTime() + 12 * HOUR), 'the next is due 16 h after the start');
      await pass();
      assert.deepEqual(subjects(), ['[Temperature Alarms] Still open: CHS IDF 2 Hot critical, 13 h']);
    });

    test('an acknowledged incident gets no reminder, and one queued before the acknowledgement is dropped unsent', async () => {
      await serve(notifyingConfig(relay, { remindHours: 4, coalesceSeconds: 60 }));
      const start = whole(Date.now() - 5 * HOUR);
      const id = await hotSince(start);
      await sweep();
      assert.equal((await reminders()).length, 1);
      assert.equal((await client.incidents.acknowledge(id, { by: 'Sam' })).status, 200);
      assert.equal(await pass(new Date(Date.now() + 61 * SECOND)), 0);
      assert.equal(relay.received.length, 0, 'nothing sent');
      assert.deepEqual(await outbox(), [], 'the stale reminder is gone');

      await sweep(new Date(start.getTime() + 9 * HOUR));
      assert.deepEqual(await reminders(), [], 'and no more are queued');
    });

    test('a closed incident gets no reminder, and one queued before the close gives way to the closing email', async () => {
      await reminding();
      const campus = await client.campuses.create();
      await hotSince(whole(Date.now() - 5 * HOUR), 'ESP_A1B2C3', campus);
      await postReading(72);
      await postReading(72);
      assert.deepEqual(await kinds(), ['closed critical']);
      await sweep();
      assert.deepEqual(await reminders(), []);

      await pool.query('DELETE FROM notifications');
      await hotSince(whole(Date.now() - 5 * HOUR), 'ESP_D4E5F6', campus, 'MDF');
      await sweep();
      assert.equal((await reminders()).length, 1);
      await postReading(72, 40, 'ESP_D4E5F6');
      await postReading(72, 40, 'ESP_D4E5F6');
      assert.equal(await pass(), 1, 'the reminder is dropped, the close is sent');
      assert.deepEqual(subjects(), ['[Temperature Alarms] CHS MDF: Hot critical, resolved (91 °F)']);
    });

    test('a restart neither repeats a reminder nor starts the count again', async () => {
      await reminding();
      const campus = await client.campuses.create();
      await hotSince(whole(Date.now() - 4 * HOUR - 10 * MINUTE), 'ESP_A1B2C3', campus);
      const youngStart = whole(Date.now() - 3 * HOUR);
      const young = await hotSince(youngStart, 'ESP_D4E5F6', campus, 'MDF');
      await sweep();
      assert.equal((await reminders()).length, 1);
      await pass();

      await serve(config);
      await sweep();
      assert.equal((await reminders()).length, 1, 'the reminder already queued is not queued again');
      // The younger incident is due 4 h after its own start, whenever the process started.
      await sweep(new Date(youngStart.getTime() + 4 * HOUR));
      assert.deepEqual((await reminders()).map((r) => r.incidentId).slice(1), [young]);
    });

    test('a Device on the Bench gets no reminder', async () => {
      await reminding();
      const bench = await client.campuses.create('Bench', 'bench');
      await hotSince(whole(Date.now() - 5 * HOUR), 'ESP_A1B2C3', bench, 'Shelf');
      await sweep();
      assert.deepEqual(await outbox(), []);
    });

    test('off by default: no reminder however long an incident stays open', async () => {
      await hotSince(whole(Date.now() - 50 * HOUR));
      await sweep();
      assert.deepEqual(await outbox(), []);
    });

    test('a reminder coalesces with an opening into one email', async () => {
      await serve(notifyingConfig(relay, { remindHours: 4, coalesceSeconds: 60 }));
      const campus = await client.campuses.create();
      await hotSince(whole(Date.now() - 6 * HOUR), 'ESP_A1B2C3', campus, 'IDF 2');
      const silent = await registerDevice('ESP_D4E5F6', campus, 'MDF');
      await readingAt(silent.id, whole(Date.now() - 5 * MINUTE));
      await sweep();
      assert.deepEqual((await kinds()).sort(), ['opened warning', 'reminder critical']);
      assert.equal(await pass(new Date(Date.now() + 61 * SECOND)), 2);
      assert.deepEqual(subjects(), ['[Temperature Alarms] 2 incidents: 1 Hot, 1 Offline (1 still open)']);
    });
  });

  test('retention removes rows sent or given up more than a week ago, and keeps pending ones however old', async () => {
    const device = await registerDevice();
    await postReading(85);
    await postReading(91);
    await postReading(72);
    await postReading(72);
    const now = new Date();
    const ago = (days: number) => new Date(now.getTime() - days * DAY_MS);
    const [rows] = await pool.query<RowDataPacket[]>('SELECT id FROM notifications ORDER BY id');
    const [sentLongAgo, sentRecently, failedLongAgo] = rows.map((r) => r.id as number);
    await pool.query('UPDATE notifications SET sent_at = ? WHERE id = ?', [ago(8), sentLongAgo]);
    await pool.query('UPDATE notifications SET sent_at = ? WHERE id = ?', [ago(6), sentRecently]);
    await pool.query('UPDATE notifications SET failed_at = ? WHERE id = ?', [ago(8), failedLongAgo]);
    // A pending row for an incident that is still open stays however old.
    await postReading(85);
    await pool.query('UPDATE notifications SET created_at = ?, next_attempt_at = ? WHERE sent_at IS NULL AND failed_at IS NULL', [ago(30), ago(30)]);

    const lines: string[] = [];
    await deleteReadingsPastWindow({ pool, config, now: () => now }, { log: (line) => lines.push(line) });
    const left = await outbox();
    assert.deepEqual(left.map((r) => r.kind), ['worse', 'opened']);
    assert.equal(left[0].sentAt?.getTime(), ago(6).getTime());
    assert.match(lines[0], /and 2 notifications sent or given up on more than 7 days ago/);
    assert.ok(device);
  });
});

describe('the outbox rules (pure)', () => {
  const facts = (overrides: Partial<ChangeFacts>): ChangeFacts => ({
    change: 'opened',
    created: false,
    level: 'warning',
    segmentLevels: ['warning'],
    campusShortcode: 'CHS',
    ...overrides,
  });

  test('opened and closed always notify; an Offline stretch recorded already closed queues both', () => {
    assert.deepEqual(notificationKinds(facts({ change: 'opened' })), ['opened']);
    assert.deepEqual(notificationKinds(facts({ change: 'closed' })), ['closed']);
    assert.deepEqual(notificationKinds(facts({ change: 'closed', created: true })), ['opened', 'closed']);
  });

  test('a level change notifies only when it reaches a new worst', () => {
    assert.deepEqual(notificationKinds(facts({ change: 'level', level: 'critical', segmentLevels: ['warning', 'critical'] })), ['worse']);
    assert.deepEqual(notificationKinds(facts({ change: 'level', level: 'critical', segmentLevels: ['warning', 'critical', 'warning'] })), [], 'a fall');
    assert.deepEqual(notificationKinds(facts({ change: 'level', level: 'critical', segmentLevels: ['warning', 'critical', 'warning', 'critical'] })), [], 'back up to a level already reached');
  });

  test('the Bench is silent, in any case', () => {
    for (const campusShortcode of ['BENCH', 'bench', ' Bench ']) {
      assert.deepEqual(notificationKinds(facts({ campusShortcode })), []);
      assert.deepEqual(notificationKinds(facts({ campusShortcode, change: 'closed', created: true })), []);
    }
    assert.deepEqual(notificationKinds(facts({ campusShortcode: 'BENCHMARK' })), ['opened']);
  });

  test('a reminder is due each whole period after the start, once, however late the pass', () => {
    const start = new Date('2026-10-06T00:00:00Z');
    const h = (hours: number) => new Date(start.getTime() + hours * HOUR);
    assert.equal(reminderDue(start, null, h(3.99), 4 * HOUR), null);
    assert.deepEqual(reminderDue(start, null, h(4), 4 * HOUR), h(4));
    assert.deepEqual(reminderDue(start, null, h(4.5), 4 * HOUR), h(4), 'on the schedule, not at the pass');
    assert.equal(reminderDue(start, h(4), h(7.99), 4 * HOUR), null);
    assert.deepEqual(reminderDue(start, h(4), h(8), 4 * HOUR), h(8));
    assert.deepEqual(reminderDue(start, h(4), h(21), 4 * HOUR), h(20), 'one reminder for several missed periods');
    // The period shortened after a reminder: the next comes one new period after the last.
    assert.equal(reminderDue(start, h(8), h(9.5), 2 * HOUR), null);
    assert.deepEqual(reminderDue(start, h(8), h(10), 2 * HOUR), h(10));
    assert.equal(reminderDue(start, null, h(100), 0), null, 'off');
  });

  test('backoff is 30 s doubling, capped at 15 min; given up a day after it was queued', () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 40].map((n) => retryDelayMs(n, DEFAULT_RETRY) / 1000), [30, 60, 120, 240, 480, 900, 900, 900]);
    const queued = new Date('2026-10-06T00:00:00Z');
    assert.equal(givesUp(queued, new Date('2026-10-06T23:59:59Z'), DEFAULT_RETRY), false);
    assert.equal(givesUp(queued, new Date('2026-10-07T00:00:00Z'), DEFAULT_RETRY), true);
  });

  test('a Campus with its own list emails it, one without (or a row with no Campus) NOTIFY_TO; NOTIFY_TO_ALL adds NOTIFY_TO to every list', () => {
    const defaults = ['techs@district.example', 'oncall@district.example'];
    assert.deepEqual(recipientsFor([], defaults, false), defaults);
    assert.deepEqual(recipientsFor(['chs@district.example'], defaults, false), ['chs@district.example']);
    assert.deepEqual(recipientsFor(['chs@district.example'], defaults, true), ['chs@district.example', ...defaults]);
    assert.deepEqual(recipientsFor([], defaults, true), defaults);
    assert.deepEqual(
      recipientsFor(['Techs@District.example', 'b@district.example', 'b@district.example'], defaults, true),
      ['Techs@District.example', 'b@district.example', 'oncall@district.example'],
      'each address once, whatever its case',
    );
    // The same people, in any order or case, are one list.
    assert.equal(listKey(['b@district.example', 'A@district.example']), listKey(['a@district.example', 'B@district.example']));
    assert.notEqual(listKey(['a@district.example']), listKey(['a@district.example', 'b@district.example']));
  });

  test('Settings lists NOTIFY_TO first, then each list once with the Campuses that email it, the Bench on none', () => {
    const defaults = ['techs@district.example'];
    const campuses = [
      { shortcode: 'BENCH', notifyTo: [] },
      { shortcode: 'CHS', notifyTo: ['chs@district.example'] },
      { shortcode: 'MHS', notifyTo: [] },
      { shortcode: 'NHS', notifyTo: ['CHS@district.example'] },
    ];
    assert.deepEqual(recipientLists(campuses, defaults, false), [
      { recipients: ['techs@district.example'], campuses: ['MHS'], isDefault: true },
      { recipients: ['chs@district.example'], campuses: ['CHS', 'NHS'], isDefault: false },
    ]);
    assert.deepEqual(recipientLists(campuses, defaults, true), [
      { recipients: ['techs@district.example'], campuses: ['MHS'], isDefault: true },
      { recipients: ['chs@district.example', 'techs@district.example'], campuses: ['CHS', 'NHS'], isDefault: false },
    ]);
    assert.deepEqual(recipientLists([], defaults, false), [{ recipients: ['techs@district.example'], campuses: [], isDefault: true }], 'NOTIFY_TO even with no Campus on it');
  });

  test('due notifications group by recipient list, in the order each list first appears', () => {
    const rows = [
      { id: 1, to: ['b@district.example'] },
      { id: 2, to: ['a@district.example'] },
      { id: 3, to: ['b@district.example'] },
    ];
    assert.deepEqual(
      byRecipients(rows, (r) => r.to).map((g) => ({ recipients: g.recipients, ids: g.due.map((r) => r.id) })),
      [
        { recipients: ['b@district.example'], ids: [1, 3] },
        { recipients: ['a@district.example'], ids: [2] },
      ],
    );
    assert.deepEqual(byRecipients([], (r: { to: string[] }) => r.to), []);
  });

  test('a batch is ready once its oldest has waited the window, or at once when any is a retry', () => {
    const at = new Date('2026-10-06T12:00:00Z');
    const ago = (seconds: number, attempts = 0) => ({ createdAt: new Date(at.getTime() - seconds * 1000), attempts });
    assert.equal(readyToSend([], at, 60_000), false);
    assert.equal(readyToSend([ago(59), ago(10)], at, 60_000), false);
    assert.equal(readyToSend([ago(60), ago(1)], at, 60_000), true, 'everything due goes with the oldest');
    assert.equal(readyToSend([ago(1, 2)], at, 60_000), true);
    assert.equal(readyToSend([ago(0)], at, 0), true, 'no window sends at once');
  });
});
