import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { createTestPool, resetDatabase, tableNames } from './helpers/database';
import { runMigrations } from '../src/migrations';

let pool: Pool;

before(() => {
  pool = createTestPool();
});
after(() => pool.end());

async function insertCampus(name = 'Central High', shortcode = 'CHS'): Promise<number> {
  const [result] = await pool.query<ResultSetHeader>('INSERT INTO campuses (name, shortcode) VALUES (?, ?)', [name, shortcode]);
  return result.insertId;
}

async function insertDevice(campusId: number, hostname = 'ESP_A1B2C3', closet = 'IDF 2'): Promise<number> {
  const [result] = await pool.query<ResultSetHeader>(
    'INSERT INTO devices (hostname, campus_id, closet) VALUES (?, ?, ?)',
    [hostname, campusId, closet],
  );
  return result.insertId;
}

describe('migration runner', () => {
  beforeEach(() => resetDatabase(pool));

  test('creates the three tables and records the applied migration', async () => {
    assert.deepEqual(await tableNames(pool), ['campuses', 'devices', 'readings', 'schema_migrations']);
    const [rows] = await pool.query<RowDataPacket[]>('SELECT id FROM schema_migrations ORDER BY id');
    assert.deepEqual(rows.map((r) => r.id), ['0001-initial-schema']);
  });

  test('running again applies nothing', async () => {
    const applied = await runMigrations(pool);
    assert.deepEqual(applied, []);
    const [rows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM schema_migrations');
    assert.equal(rows[0].n, 1);
  });

  test('applies only migrations that have not run yet, in order', async () => {
    const extra = [
      { id: '0001-initial-schema', up: async () => { throw new Error('must not rerun'); } },
      {
        id: '0002-extra',
        up: async (conn: import('mysql2/promise').PoolConnection) => {
          await conn.query('CREATE TABLE extra (id INT PRIMARY KEY)');
        },
      },
    ];
    const applied = await runMigrations(pool, extra);
    assert.deepEqual(applied, ['0002-extra']);
    assert.ok((await tableNames(pool)).includes('extra'));
  });
});

describe('initial schema', () => {
  beforeEach(() => resetDatabase(pool));

  test('campus shortcode is unique, case-insensitively', async () => {
    await insertCampus('Central High', 'CHS');
    await assert.rejects(insertCampus('Other', 'chs'), /ER_DUP_ENTRY|Duplicate entry/);
  });

  test('device hostname is unique', async () => {
    const campus = await insertCampus();
    await insertDevice(campus, 'ESP_A1B2C3');
    await assert.rejects(insertDevice(campus, 'ESP_A1B2C3', 'MDF'), /ER_DUP_ENTRY|Duplicate entry/);
  });

  test('a device must belong to an existing campus, and a campus with devices cannot be deleted', async () => {
    await assert.rejects(insertDevice(9999), /foreign key/i);
    const campus = await insertCampus();
    await insertDevice(campus);
    await assert.rejects(pool.query('DELETE FROM campuses WHERE id = ?', [campus]), /foreign key/i);
  });

  test('deleting a device cascades to its readings', async () => {
    const campus = await insertCampus();
    const device = await insertDevice(campus);
    await pool.query('INSERT INTO readings (device_id, temp_f, humidity, recorded_at) VALUES (?, 72, 40, ?)', [device, new Date()]);
    await pool.query('DELETE FROM devices WHERE id = ?', [device]);
    const [rows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM readings');
    assert.equal(rows[0].n, 0);
  });

  test('readings are indexed on device and recorded time', async () => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT index_name AS indexName, seq_in_index AS seq, column_name AS columnName
         FROM information_schema.statistics
        WHERE table_schema = DATABASE() AND table_name = 'readings' AND index_name <> 'PRIMARY'
        ORDER BY index_name, seq_in_index`,
    );
    const byIndex = new Map<string, string[]>();
    for (const r of rows) {
      byIndex.set(r.indexName, [...(byIndex.get(r.indexName) ?? []), r.columnName]);
    }
    assert.ok(
      [...byIndex.values()].some((cols) => cols[0] === 'device_id' && cols[1] === 'recorded_at'),
      `no (device_id, recorded_at) index; found ${JSON.stringify([...byIndex])}`,
    );
  });

  test('timestamps round-trip as UTC', async () => {
    const campus = await insertCampus();
    const device = await insertDevice(campus);
    const recordedAt = new Date('2026-01-15T23:30:00.000Z');
    await pool.query('INSERT INTO readings (device_id, temp_f, humidity, recorded_at) VALUES (?, 70, 35, ?)', [device, recordedAt]);

    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT recorded_at, DATE_FORMAT(recorded_at, '%Y-%m-%dT%H:%i:%s') AS raw, @@session.time_zone AS tz, UTC_TIMESTAMP() = NOW() AS session_is_utc FROM readings",
    );
    assert.equal((rows[0].recorded_at as Date).toISOString(), recordedAt.toISOString());
    assert.equal(rows[0].raw, '2026-01-15T23:30:00', 'stored value must be the UTC wall-clock time');
    assert.equal(rows[0].tz, '+00:00');
    assert.equal(rows[0].session_is_utc, 1);
  });

  test('a device created_at defaults to the current UTC time', async () => {
    const campus = await insertCampus();
    const device = await insertDevice(campus);
    const [rows] = await pool.query<RowDataPacket[]>('SELECT created_at FROM devices WHERE id = ?', [device]);
    const createdAt = rows[0].created_at as Date;
    assert.ok(Math.abs(createdAt.getTime() - Date.now()) < 5_000, `created_at ${createdAt.toISOString()} is not now`);
  });
});
