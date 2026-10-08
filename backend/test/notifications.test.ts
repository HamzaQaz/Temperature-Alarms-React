import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'mysql2/promise';
import { createTestPool, resetDatabase } from './helpers/database';
import { startServer, testConfig, type RunningServer } from './helpers/server';
import { asAdmin, errorOf, json } from './helpers/api';
import { startTestRelay, type TestRelay } from './helpers/smtp';
import type { NotificationsConfig } from '../src/config';
import type { Mailer } from '../src/mailer';

interface NotificationStatus {
  enabled: boolean;
  relay: { host: string; port: number; secure: string } | null;
  from: string | null;
  recipients: string[];
  toAll: boolean;
  lists: { recipients: string[]; campuses: string[]; isDefault: boolean; lastResult: unknown }[];
  monthlyReport: boolean;
  lastSent: { at: string; subject: string } | null;
  lastFailure: { at: string; error: string } | null;
  pending: number;
  failed: number;
}

interface TestResult {
  sentAt: string;
  accepted: string[];
  rejected: string[];
  response: string;
}

describe('email notifications: the test email and the status (/api/notifications)', () => {
  let pool: Pool;
  const servers: RunningServer[] = [];
  const relays: TestRelay[] = [];

  // The status reads the outbox, so it starts empty.
  before(async () => {
    pool = createTestPool();
    await resetDatabase(pool);
  });
  after(async () => {
    await Promise.all(servers.map((s) => s.close()));
    await Promise.all(relays.map((r) => r.close()));
    await pool.end();
  });

  /** A fresh app, so each test has its own one-a-minute allowance. */
  const serve = async (notifications: NotificationsConfig | undefined, mailer?: Mailer) => {
    const server = await startServer(pool, testConfig({ notifications }), mailer === undefined ? {} : { mailer });
    servers.push(server);
    return {
      status: (init: RequestInit = asAdmin()) => fetch(`${server.url}/api/notifications/status`, init),
      sendTest: (init: RequestInit = asAdmin()) => fetch(`${server.url}/api/notifications/test`, { ...init, method: 'POST' }),
    };
  };
  const relay = async (options?: Parameters<typeof startTestRelay>[0]) => {
    const started = await startTestRelay(options);
    relays.push(started);
    return started;
  };

  test('off without SMTP_HOST: the status says so, and the test button explains how to turn it on', async () => {
    const client = await serve(undefined);
    const response = await client.status();
    assert.equal(response.status, 200);
    assert.deepEqual(await json<NotificationStatus>(response), {
      enabled: false,
      relay: null,
      from: null,
      recipients: [],
      toAll: false,
      lists: [],
      monthlyReport: false,
      lastSent: null,
      lastFailure: null,
      pending: 0,
      failed: 0,
    });
    const refused = await client.sendTest();
    assert.equal(refused.status, 409);
    assert.match(await errorOf(refused), /off.*SMTP_HOST/);
  });

  test('both routes need the Admin token, and a refused request sends nothing', async () => {
    const smtp = await relay();
    const client = await serve(smtp.config());
    for (const init of [{}, { headers: { Authorization: 'Bearer wrong-token' } }, { headers: { Authorization: 'Bearer test-device-token' } }]) {
      assert.equal((await client.status(init)).status, 401);
      assert.equal((await client.sendTest(init)).status, 401);
    }
    assert.equal(smtp.received.length, 0);
    // Refusals do not spend the minute's allowance.
    assert.equal((await client.sendTest()).status, 200);
  });

  test('the test email arrives at every recipient, from NOTIFY_FROM, and the relay reply comes back', async () => {
    const smtp = await relay();
    const client = await serve(smtp.config());
    const response = await client.sendTest();
    assert.equal(response.status, 200);
    const result = await json<TestResult>(response);
    assert.deepEqual(result.accepted, ['techs@district.example', 'oncall@district.example']);
    assert.deepEqual(result.rejected, []);
    assert.match(result.response, /^250/);

    assert.equal(smtp.received.length, 1);
    const [email] = smtp.received;
    assert.equal(email.from, 'alarms@district.example');
    assert.equal(email.fromHeader, 'alarms@district.example');
    assert.deepEqual(email.to, ['techs@district.example', 'oncall@district.example']);
    assert.equal(email.subject, '[Temperature Alarms] Test email');
    assert.match(email.text, /Dashboard: https:\/\/alarms\.district\.example\r?\n/);

    const status = await json<NotificationStatus>(await client.status());
    assert.equal(status.enabled, true);
    assert.deepEqual(status.relay, { host: '127.0.0.1', port: smtp.port, secure: 'none' });
    assert.equal(status.from, 'alarms@district.example');
    assert.deepEqual(status.recipients, ['techs@district.example', 'oncall@district.example']);
    assert.deepEqual(status.lastSent, { at: result.sentAt, subject: '[Temperature Alarms] Test email' });
    assert.equal(status.lastFailure, null);
    assert.equal(status.pending, 0);
    assert.equal(status.toAll, false);
    assert.deepEqual(status.lists, [
      {
        recipients: ['techs@district.example', 'oncall@district.example'],
        campuses: [],
        isDefault: true,
        lastResult: { at: result.sentAt, sent: true, subject: '[Temperature Alarms] Test email' },
      },
    ], 'the test email went to NOTIFY_TO, so it is the last result of that list');
  });

  test('a relay that wants a login gets it', async () => {
    const login = { user: 'svc-alarms', password: 'right-password' };
    const smtp = await relay({ login });
    const client = await serve(smtp.config());
    assert.equal((await client.sendTest()).status, 200);
    assert.equal(smtp.received.length, 1);
  });

  test('one test email a minute: the second is refused and nothing more arrives', async () => {
    const smtp = await relay();
    const client = await serve(smtp.config());
    assert.equal((await client.sendTest()).status, 200);
    const refused = await client.sendTest();
    assert.equal(refused.status, 429);
    assert.match(await errorOf(refused), /one test email a minute/i);
    assert.ok(refused.headers.get('retry-after') !== null, 'says when to try again');
    assert.equal(smtp.received.length, 1);
  });

  test('a relay refusing the login: a 502 with its reason, never the password, and the failure on the status', async () => {
    const smtp = await relay({ login: { user: 'svc-alarms', password: 'right-password' } });
    const client = await serve(smtp.config({ auth: { user: 'svc-alarms', password: 'smtp-secret-wrong' } }));
    const response = await client.sendTest();
    assert.equal(response.status, 502);
    const body = await response.text();
    assert.match(body, /Invalid login/);
    assert.match(body, /with password \*{8}/, 'the relay echoed the password, and it was masked');
    assert.ok(!body.includes('smtp-secret-wrong'), body);
    assert.ok(!body.includes(Buffer.from('smtp-secret-wrong').toString('base64')), body);
    assert.equal(smtp.received.length, 0);

    const status = await json<NotificationStatus>(await client.status());
    assert.equal(status.lastSent, null);
    assert.match(status.lastFailure?.error ?? '', /Invalid login/);
    assert.ok(!JSON.stringify(status).includes('smtp-secret-wrong'));
  });

  test('STARTTLS is required unless SMTP_SECURE=none: a relay without it is refused, not sent to in plain text', async () => {
    const smtp = await relay();
    const client = await serve(smtp.config({ secure: 'starttls' }));
    const response = await client.sendTest();
    assert.equal(response.status, 502);
    assert.match(await errorOf(response), /STARTTLS/);
    assert.equal(smtp.received.length, 0);
  });

  test('a relay that is down: a 502 saying it could not be reached', async () => {
    const smtp = await relay();
    const config = smtp.config();
    await smtp.close();
    const client = await serve(config);
    const response = await client.sendTest();
    assert.equal(response.status, 502);
    assert.match(await errorOf(response), /ECONNREFUSED|connect/i);
  });

  test('the mailer is a seam: the routes send through whichever one the app is given', async () => {
    const sent: string[] = [];
    const fake: Mailer = {
      send: async ({ subject }) => {
        sent.push(subject);
        return { messageId: '<1@test>', response: '250 queued', accepted: ['techs@district.example'], rejected: [] };
      },
    };
    const client = await serve((await relay()).config(), fake);
    assert.equal((await client.sendTest()).status, 200);
    assert.deepEqual(sent, ['[Temperature Alarms] Test email']);
  });
});
