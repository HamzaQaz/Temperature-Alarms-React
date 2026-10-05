import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { createTestPool, resetDatabase } from './helpers/database';
import { startServer, testConfig, type RunningServer } from './helpers/server';
import { api } from './helpers/api';
import { deleteReadingsPastWindow, retentionCutoff, startRetentionJob, type RetentionJob } from '../src/retention';

const NOW = new Date('2026-09-09T12:00:00Z');
const DAY_MS = 86_400_000;
const daysAgo = (days: number, extraMs = 0): Date => new Date(NOW.getTime() - days * DAY_MS - extraMs);

describe('retention job', () => {
  let pool: Pool;
  let server: RunningServer;
  let client: ReturnType<typeof api>;
  let lines: string[];
  let errors: unknown[];

  before(async () => {
    pool = createTestPool();
    server = await startServer(pool);
    client = api(server);
  });
  beforeEach(async () => {
    await resetDatabase(pool);
    lines = [];
    errors = [];
  });
  after(async () => {
    await server.close();
    await pool.end();
  });

  const withRetention = (retentionDays = 90, db: Pool = pool) => ({ pool: db, config: testConfig({ retentionDays }), now: () => NOW });
  const withBatch = (batchSize?: number) => ({ batchSize, log: (line: string) => lines.push(line), onError: (e: unknown) => errors.push(e) });

  const registerDevice = async (): Promise<number> => {
    const campus = await client.campuses.create();
    return (await client.devices.create(campus.id)).id;
  };
  // Ingest stamps the server's time, so a Reading at a chosen instant can only be arranged by writing the row directly.
  const readingAt = async (deviceId: number, recordedAt: Date, tempF = 72) => {
    await pool.query('INSERT INTO readings (device_id, temp_f, humidity, recorded_at) VALUES (?, ?, ?, ?)', [deviceId, tempF, 40, recordedAt]);
  };
  /** Every remaining Reading's temperature, oldest first, so a test can name each one it seeded. */
  const remaining = async (): Promise<number[]> => {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT temp_f AS tempF FROM readings ORDER BY recorded_at');
    return rows.map((r) => r.tempF as number);
  };
  /** The pool, with every statement it runs recorded. */
  const recordingPool = (statements: string[]): Pool => {
    const recording = Object.create(pool) as Pool;
    recording.query = ((sql: string, values?: Parameters<Pool['query']>[1]) => {
      statements.push(sql);
      return pool.query(sql, values);
    }) as Pool['query'];
    return recording;
  };

  test('the cutoff is the retention window before now', () => {
    assert.deepEqual(retentionCutoff(NOW, 90), new Date('2026-06-11T12:00:00Z'));
    assert.deepEqual(retentionCutoff(NOW, 1), new Date('2026-09-08T12:00:00Z'));
  });

  test('removes only Readings past the window, keeps the boundary, and logs the count', async () => {
    const device = await registerDevice();
    await readingAt(device, daysAgo(91), 1);
    await readingAt(device, daysAgo(90, 1000), 2); // one second past the window
    await readingAt(device, daysAgo(90), 3); // exactly at the cutoff stays
    await readingAt(device, daysAgo(89), 4);
    await readingAt(device, NOW, 5);

    const removed = await deleteReadingsPastWindow(withRetention(), withBatch());

    assert.equal(removed, 2);
    assert.deepEqual(await remaining(), [3, 4, 5]);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /removed 2 /);
    assert.match(lines[0], /90 days/);
    assert.match(lines[0], /2026-06-11T12:00:00/);
  });

  test('honours the configured retention days', async () => {
    const device = await registerDevice();
    await readingAt(device, daysAgo(31), 1);
    await readingAt(device, daysAgo(29), 2);

    const removed = await deleteReadingsPastWindow(withRetention(30), withBatch());

    assert.equal(removed, 1);
    assert.deepEqual(await remaining(), [2]);
  });

  test('deletes in batches no larger than batchSize until nothing past the window is left', async () => {
    const device = await registerDevice();
    for (let i = 0; i < 7; i++) await readingAt(device, daysAgo(100 + i), i);
    await readingAt(device, daysAgo(10), 99);
    const statements: string[] = [];

    const removed = await deleteReadingsPastWindow(withRetention(90, recordingPool(statements)), withBatch(3));

    assert.equal(removed, 7);
    assert.deepEqual(await remaining(), [99]);
    const deletes = statements.filter((sql) => /^DELETE FROM readings/.test(sql));
    assert.equal(deletes.length, 3, 'seven Readings in batches of three take three statements: 3, 3, then 1');
    assert.ok(deletes.every((sql) => /LIMIT \?/.test(sql)), 'every DELETE is bounded');
  });

  test('a pass with nothing to remove still logs a zero', async () => {
    const device = await registerDevice();
    await readingAt(device, daysAgo(1), 1);

    assert.equal(await deleteReadingsPastWindow(withRetention(), withBatch()), 0);
    assert.deepEqual(await remaining(), [1]);
    assert.match(lines[0], /removed 0 /);
  });

  describe('scheduling', () => {
    let job: RetentionJob | undefined;
    const waitFor = async (predicate: () => boolean, timeoutMs = 2000) => {
      const deadline = Date.now() + timeoutMs;
      while (!predicate()) {
        if (Date.now() > deadline) throw new Error('Timed out waiting');
        await new Promise((r) => setTimeout(r, 10));
      }
    };
    after(() => job?.stop());

    test('runs a pass at start and again on every interval until stopped', async () => {
      const device = await registerDevice();
      await readingAt(device, daysAgo(91), 1);

      job = startRetentionJob(withRetention(), { ...withBatch(), intervalMs: 50 });
      await waitFor(() => lines.length >= 3);
      job.stop();
      const seen = lines.length;

      assert.match(lines[0], /removed 1 /);
      assert.match(lines[1], /removed 0 /);
      assert.deepEqual(await remaining(), []);
      await new Promise((r) => setTimeout(r, 150));
      assert.equal(lines.length, seen, 'no pass runs after stop');
      assert.deepEqual(errors, []);
    });

    test('a failing pass is reported and the next interval still runs', async () => {
      const dead = createTestPool();
      await dead.end();

      job = startRetentionJob(withRetention(90, dead), { ...withBatch(), intervalMs: 50 });
      await waitFor(() => errors.length >= 2);
      job.stop();

      assert.ok(errors[0] instanceof Error);
      assert.equal(lines.length, 0, 'a failed pass logs no count');
    });
  });
});
