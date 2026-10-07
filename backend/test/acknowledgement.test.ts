import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { createTestPool, resetDatabase } from './helpers/database';
import { startServer, testConfig, type RunningServer } from './helpers/server';
import { api, asAdmin, errorOf, json, type DashboardDevice, type Incident, type RecordedReading } from './helpers/api';
import { subscribe, type SseClient } from './helpers/sse';
import { startTestRelay, type TestRelay } from './helpers/smtp';
import { createBroadcaster, type IncidentEvent } from '../src/sse';
import { createMailer } from '../src/mailer';
import { runNotifierPass } from '../src/notifier';
import { parseAcknowledgement, ACKNOWLEDGED_BY_MAX } from '../src/acknowledgementInput';

const MINUTE = 60_000;
const DAY_MS = 86_400_000;

describe('acknowledging an incident (POST /api/incidents/:id/acknowledge)', () => {
  let pool: Pool;
  let relay: TestRelay;
  let server: RunningServer;
  let client: ReturnType<typeof api>;
  let sse: ReturnType<typeof createBroadcaster>;
  /** The clock the app runs on; a test moves it to see the acknowledgement's time. */
  let clock: Date;
  const open: SseClient[] = [];
  const config = () => testConfig({ notifications: { ...relay.config(), coalesceSeconds: 0 } });

  before(async () => {
    pool = createTestPool();
    relay = await startTestRelay();
  });
  beforeEach(async () => {
    await resetDatabase(pool);
    relay.received.length = 0;
    sse = createBroadcaster({ heartbeatMs: 60_000 });
    clock = new Date(Math.floor(Date.now() / 1000) * 1000);
    server = await startServer(pool, config(), { sse, now: () => clock });
    client = api(server);
  });
  afterEach(async () => {
    for (const c of open.splice(0)) c.close();
    await server.close();
  });
  after(async () => {
    await relay.close();
    await pool.end();
  });

  const registerDevice = async (hostname = 'ESP_A1B2C3') => {
    const campus = await client.campuses.create();
    return client.devices.create(campus.id, hostname, 'IDF 2');
  };
  const postReading = async (temp: number, humidity = 40, device = 'ESP_A1B2C3'): Promise<RecordedReading> => {
    const response = await client.readings.add({ device, temp, humidity });
    assert.equal(response.status, 201, await response.clone().text());
    return json<RecordedReading>(response);
  };
  const allIncidents = async (): Promise<Incident[]> => (await client.incidents.list(new Date(Date.now() - DAY_MS), new Date(Date.now() + 60 * MINUTE))).incidents;
  const only = async (): Promise<Incident> => {
    const incidents = await allIncidents();
    assert.equal(incidents.length, 1, JSON.stringify(incidents));
    return incidents[0];
  };
  /** A Hot warning incident, open. */
  const hotIncident = async (): Promise<Incident> => {
    await registerDevice();
    await postReading(85);
    return only();
  };
  const listen = async (): Promise<SseClient> => {
    const c = await subscribe(client.dashboard.url('/stream'));
    open.push(c);
    await c.next(); // the opening comment
    return c;
  };
  const sendPass = () => runNotifierPass({ pool, config: config(), mailer: createMailer(relay.config()) }, { timeZone: 'UTC' });

  test('records who acknowledged it and when, trimmed, and the log shows it', async () => {
    const incident = await hotIncident();
    assert.equal(incident.acknowledgement, null, 'a new incident is not acknowledged');

    const response = await client.incidents.acknowledge(incident.id, { by: '  Sam  ' });
    assert.equal(response.status, 200, await response.clone().text());
    const acknowledged = await json<Incident>(response);
    assert.deepEqual(acknowledged.acknowledgement, { by: 'Sam', at: clock.toISOString() });
    assert.deepEqual(await only(), acknowledged, 'GET /api/incidents carries the same');
  });

  test('needs the Admin token', async () => {
    const incident = await hotIncident();
    const none = await client.incidents.acknowledge(incident.id, { by: 'Sam' }, { headers: { 'Content-Type': 'application/json' } });
    assert.equal(none.status, 401);
    const wrong = await client.incidents.acknowledge(incident.id, { by: 'Sam' }, { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer nope' } });
    assert.equal(wrong.status, 401);
    assert.equal((await only()).acknowledgement, null);
  });

  test('a name of 1 to 60 characters with no control characters (422 otherwise)', async () => {
    const incident = await hotIncident();
    const cases: [unknown, RegExp][] = [
      [{}, /Give a name/],
      [{ by: '' }, /Give a name/],
      [{ by: '   ' }, /Give a name/],
      [{ by: 42 }, /Give a name/],
      [{ by: 'x'.repeat(61) }, /at most 60 characters/],
      [{ by: 'Sam\nBcc: everyone' }, /control characters/],
      [{ by: 'Sam\u202Emal' }, /control characters/],
      [{ by: 'Sam\u2028History: http://example.invalid' }, /control characters/],
    ];
    for (const [body, message] of cases) {
      const response = await client.incidents.acknowledge(incident.id, body);
      assert.equal(response.status, 422, JSON.stringify(body));
      assert.match(await errorOf(response), message, JSON.stringify(body));
    }
    assert.equal((await only()).acknowledgement, null);
    const longest = await client.incidents.acknowledge(incident.id, { by: 'é'.repeat(60) });
    assert.equal(longest.status, 200, 'sixty characters, counted as characters, not bytes');
  });

  test('is idempotent: the first acknowledgement stands, and a repeat changes nothing and sends nothing', async () => {
    const incident = await hotIncident();
    const first = await json<Incident>(await client.incidents.acknowledge(incident.id, { by: 'Sam' }));
    const stream = await listen();
    clock = new Date(clock.getTime() + 5 * MINUTE);

    const again = await client.incidents.acknowledge(incident.id, { by: 'Alex' });
    assert.equal(again.status, 200);
    assert.deepEqual((await json<Incident>(again)).acknowledgement, first.acknowledgement);
    assert.deepEqual((await only()).acknowledgement, { by: 'Sam', at: first.acknowledgement?.at });
    assert.deepEqual(await stream.collect(300), [], 'no stream message for a repeat');
  });

  test('an ended incident cannot be acknowledged (409), and an unknown one is 404', async () => {
    const incident = await hotIncident();
    await postReading(72);
    await postReading(72);
    assert.notEqual((await only()).end, null);

    const ended = await client.incidents.acknowledge(incident.id, { by: 'Sam' });
    assert.equal(ended.status, 409);
    assert.match(await errorOf(ended), /has ended/);
    assert.equal((await only()).acknowledgement, null);

    for (const id of ['999999', '0', '-1', 'abc', '1.5']) {
      const response = await fetch(`${server.url}/api/incidents/${id}/acknowledge`, { ...asAdmin(), method: 'POST', body: JSON.stringify({ by: 'Sam' }) });
      assert.equal(response.status, 404, id);
    }
  });

  test('a repeat once the incident has ended is 409 too, and keeps the first acknowledgement', async () => {
    const incident = await hotIncident();
    await client.incidents.acknowledge(incident.id, { by: 'Sam' });
    await postReading(72);
    await postReading(72);
    const closed = await only();
    assert.notEqual(closed.end, null);

    const stale = await client.incidents.acknowledge(incident.id, { by: 'Alex' });
    assert.equal(stale.status, 409, 'from a tab that still showed it open');
    assert.match(await errorOf(stale), /has ended/);
    assert.deepEqual((await only()).acknowledgement, closed.acknowledgement);
    assert.equal(closed.acknowledgement?.by, 'Sam');
  });

  test('the stream sends the change to every open dashboard', async () => {
    const incident = await hotIncident();
    const one = await listen();
    const two = await listen();
    await client.incidents.acknowledge(incident.id, { by: 'Sam' });
    for (const stream of [one, two]) {
      const event = await stream.nextMessage<IncidentEvent>();
      assert.equal(event.type, 'incident');
      assert.equal(event.change, 'acknowledged');
      assert.deepEqual(event.incident, await only());
    }
  });

  test('a level rising afterwards keeps the acknowledgement', async () => {
    const incident = await hotIncident();
    await client.incidents.acknowledge(incident.id, { by: 'Sam' });
    await postReading(91);
    const worse = await only();
    assert.equal(worse.level, 'critical');
    assert.equal(worse.acknowledgement?.by, 'Sam');
  });

  test('the Dashboard lists each Device\'s open incidents with their acknowledgement, and drops one once it ends', async () => {
    const incident = await hotIncident();
    const card = async (): Promise<DashboardDevice> => (await client.dashboard.get()).devices[0];
    assert.deepEqual((await card()).openIncidents, [{ id: incident.id, condition: 'Hot', level: 'warning', start: incident.start, acknowledgement: null }]);

    await client.incidents.acknowledge(incident.id, { by: 'Sam' });
    assert.deepEqual((await card()).openIncidents, [
      { id: incident.id, condition: 'Hot', level: 'warning', start: incident.start, acknowledgement: { by: 'Sam', at: clock.toISOString() } },
    ]);

    await postReading(72);
    await postReading(72);
    assert.deepEqual((await card()).openIncidents, []);
  });

  test('later emails about the incident name who acknowledged it; the closing email still sends', async () => {
    const incident = await hotIncident();
    await sendPass();
    assert.doesNotMatch(relay.received[0].text, /Acknowledged/);

    await client.incidents.acknowledge(incident.id, { by: 'Sam' });
    await postReading(91);
    await sendPass();
    assert.equal(relay.received[1].subject, '[Temperature Alarms] CHS IDF 2: Hot critical, got worse (91 °F)');
    assert.match(relay.received[1].text, /^Acknowledged by Sam at .+ UTC$/m);
    assert.match(relay.received[1].html, /Acknowledged by Sam at /);

    await postReading(72);
    await postReading(72);
    await sendPass();
    assert.equal(relay.received[2].subject, '[Temperature Alarms] CHS IDF 2: Hot critical, resolved (91 °F)');
    assert.match(relay.received[2].text, /^Acknowledged by Sam at /m);
  });

  test('the columns hold what the API returned', async () => {
    const incident = await hotIncident();
    await client.incidents.acknowledge(incident.id, { by: 'Sam' });
    const [rows] = await pool.query<RowDataPacket[]>('SELECT acknowledged_by AS byName, acknowledged_at AS at FROM incidents WHERE id = ?', [incident.id]);
    assert.equal(rows[0].byName, 'Sam');
    assert.equal((rows[0].at as Date).toISOString(), clock.toISOString());
  });
});

describe('parseAcknowledgement (who acknowledged, as the route takes it)', () => {
  test('trims, and takes 1 to 60 characters', () => {
    assert.deepEqual(parseAcknowledgement({ by: ' Sam, on site ' }), { by: 'Sam, on site' });
    assert.deepEqual(parseAcknowledgement({ by: 'x'.repeat(ACKNOWLEDGED_BY_MAX) }), { by: 'x'.repeat(60) });
    assert.ok('error' in parseAcknowledgement({ by: 'x'.repeat(61) }));
    assert.ok('error' in parseAcknowledgement({ by: ' ' }));
    assert.ok('error' in parseAcknowledgement(null));
  });

  test('refuses control characters and the marks that reorder text, which could disguise a name in an email', () => {
    for (const by of ['Sam\r\nBcc', 'S\tam', 'Sam\u0000x', 'Sam\u007Fx', 'Sam\u0085x', 'Sam\u202Ex', 'Sam\u2066x', 'Sam\u2028x', 'Sam\u2029x']) {
      assert.ok('error' in parseAcknowledgement({ by }), JSON.stringify(by));
    }
    assert.deepEqual(parseAcknowledgement({ by: 'Zoë Ramírez' }), { by: 'Zoë Ramírez' });
    assert.deepEqual(parseAcknowledgement({ by: '\tSam\n' }), { by: 'Sam' }, 'whitespace at the ends is trimmed, not refused');
  });
});
