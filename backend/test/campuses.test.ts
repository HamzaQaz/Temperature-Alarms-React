import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'mysql2/promise';
import { createTestPool, resetDatabase } from './helpers/database';
import { startServer, type RunningServer } from './helpers/server';
import { api, asAdmin, errorOf, json, type Campus } from './helpers/api';

describe('/api/campuses', () => {
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

  const url = (path = '') => client.campuses.url(path);
  const listed = () => client.campuses.list();
  const addCampus = (body: unknown, init?: RequestInit) => client.campuses.add(body, init);

  test('lists nothing on a fresh database, without a token', async () => {
    const response = await fetch(url());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), []);
  });

  test('adds a campus with the Admin token and lists it back in camelCase', async () => {
    const created = await addCampus({ name: 'Central High School', shortcode: 'CHS' });
    assert.equal(created.status, 201);
    const body = await json<Campus>(created);
    assert.equal(typeof body.id, 'number');
    assert.deepEqual(body, { id: body.id, name: 'Central High School', shortcode: 'CHS' });

    assert.deepEqual(await listed(), [{ id: body.id, name: 'Central High School', shortcode: 'CHS' }]);
  });

  test('accepts a browser on the same origin with no CORS_ORIGIN configured, and still refuses another origin', async () => {
    // Behind the stack's nginx the page and /api/ share one origin, so the browser's Origin
    // names the very host it is talking to. That must pass without any CORS setting.
    const sameOrigin = await addCampus({ name: 'Central High School', shortcode: 'CHS' }, asAdmin({ headers: { Origin: server.url } }));
    assert.equal(sameOrigin.status, 201);
    const elsewhere = await addCampus({ name: 'Other', shortcode: 'OTH' }, asAdmin({ headers: { Origin: 'http://elsewhere.example' } }));
    assert.equal(elsewhere.status, 403);
    assert.equal((await listed()).length, 1);
  });

  test('rejects an add without a token with a distinct 401', async () => {
    const response = await addCampus({ name: 'Central High School', shortcode: 'CHS' }, {
      headers: { 'Content-Type': 'application/json' },
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Not authorised' });
    assert.deepEqual(await listed(), []);
  });

  test('rejects an add with the wrong token with 401', async () => {
    const response = await addCampus({ name: 'Central High School', shortcode: 'CHS' }, {
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer nope' },
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Not authorised' });
  });

  test('rejects a missing or blank name or shortcode with 422', async () => {
    for (const body of [{}, { name: 'X' }, { shortcode: 'X' }, { name: '  ', shortcode: 'X' }, { name: 'X', shortcode: '' }]) {
      const response = await addCampus(body);
      assert.equal(response.status, 422, JSON.stringify(body));
      assert.equal(typeof (await errorOf(response)), 'string');
    }
    assert.deepEqual(await listed(), []);
  });

  test('trims and upper-cases the shortcode', async () => {
    const response = await addCampus({ name: '  Central High School ', shortcode: ' chs ' });
    assert.equal(response.status, 201);
    const body = await json<Campus>(response);
    assert.equal(body.name, 'Central High School');
    assert.equal(body.shortcode, 'CHS');
  });

  test('rejects a duplicate shortcode with 409', async () => {
    await addCampus({ name: 'Central High School', shortcode: 'CHS' });
    const response = await addCampus({ name: 'Chester High', shortcode: 'chs' });
    assert.equal(response.status, 409);
    assert.match(await errorOf(response), /shortcode/i);
    assert.equal((await listed()).length, 1);
  });

  describe('DELETE /api/campuses/:id', () => {
    const createId = async () => (await json<Campus>(await addCampus({ name: 'Central High School', shortcode: 'CHS' }))).id;

    test('deletes a campus with the Admin token', async () => {
      const id = await createId();
      const response = await fetch(url(`/${id}`), asAdmin({ method: 'DELETE' }));
      assert.equal(response.status, 204);
      assert.deepEqual(await listed(), []);
    });

    test('requires the Admin token', async () => {
      const id = await createId();
      const missing = await fetch(url(`/${id}`), { method: 'DELETE' });
      assert.equal(missing.status, 401);
      const wrong = await fetch(url(`/${id}`), { method: 'DELETE', headers: { Authorization: 'Bearer nope' } });
      assert.equal(wrong.status, 401);
      assert.equal((await listed()).length, 1);
    });

    test('returns 404 for an unknown or malformed id', async () => {
      assert.equal((await fetch(url('/999'), asAdmin({ method: 'DELETE' }))).status, 404);
      assert.equal((await fetch(url('/abc'), asAdmin({ method: 'DELETE' }))).status, 404);
    });

    test('refuses with 409 while devices still belong to the campus', async () => {
      const id = await createId();
      const device = await client.devices.add({ hostname: 'ESP_ABC123', campusId: id, closet: 'IDF 1' });
      assert.equal(device.status, 201);
      const response = await fetch(url(`/${id}`), asAdmin({ method: 'DELETE' }));
      assert.equal(response.status, 409);
      assert.match(await errorOf(response), /device/i);
      assert.equal((await listed()).length, 1);
    });
  });
});
