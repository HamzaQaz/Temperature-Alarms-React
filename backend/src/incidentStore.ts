/**
 * Incidents in the database (docs/adr/0006): load a Device's open incidents, hand them to the
 * rules in incidents.ts, and save what the rules answer. An open incident lives only in its
 * row, never in memory, so a restart picks it up where it was and the unique key on open
 * incidents stops a second one opening.
 */
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { ConditionLevel, ConditionName, ConditionRules } from './conditions';
import {
  applyFaultReport,
  applyReading,
  missedOffline,
  offlineIncident,
  peakValue,
  type IncidentChange,
  type IncidentState,
  type IncidentStep,
  type LastReport,
  type Segment,
  type TimedReading,
} from './incidents';
import type { Broadcaster, IncidentPayload } from './sse';
import { LATEST_READING_ID, lastReportAt, latestAllowed } from './latestReading';
import { enqueueNotifications } from './outboxStore';

/** A pool or one of its connections: anything that runs a statement. */
type Db = Pool | PoolConnection;

/** An incident whose change a browser should hear about, and the outbox may email. */
export interface ChangedIncident {
  id: number;
  change: IncidentChange;
  /** True when this change also wrote the incident, as for an Offline stretch ingest records already closed. */
  created: boolean;
}

interface IncidentRow extends RowDataPacket {
  id: number;
  conditionName: ConditionName;
  level: ConditionLevel;
  startedAt: Date;
  endedAt: Date | null;
  peakTempF: number;
  peakHumidity: number | null;
  peakRecordedAt: Date;
  cleanReadings: number;
  firstCleanAt: Date | null;
}

interface SegmentRow extends RowDataPacket {
  id: number;
  incidentId: number;
  level: ConditionLevel;
  startedAt: Date;
  endedAt: Date | null;
}

const SELECT_INCIDENT_STATE = `
  SELECT id, condition_name AS conditionName, worst_level AS level, started_at AS startedAt, ended_at AS endedAt,
         peak_temp_f AS peakTempF, peak_humidity AS peakHumidity, peak_recorded_at AS peakRecordedAt,
         clean_readings AS cleanReadings, first_clean_at AS firstCleanAt
  FROM incidents`;

async function segmentsOf(db: Db, ids: number[]): Promise<Map<number, SegmentRow[]>> {
  const byIncident = new Map<number, SegmentRow[]>();
  if (ids.length === 0) return byIncident;
  const [rows] = await db.query<SegmentRow[]>(
    `SELECT id, incident_id AS incidentId, level, started_at AS startedAt, ended_at AS endedAt
     FROM incident_segments WHERE incident_id IN (?) ORDER BY incident_id, started_at, id`,
    [ids],
  );
  for (const row of rows) byIncident.set(row.incidentId, [...(byIncident.get(row.incidentId) ?? []), row]);
  return byIncident;
}

/** Every open incident a Device has, as the rules take them. */
export async function loadOpenIncidents(db: Db, deviceId: number): Promise<IncidentState[]> {
  const [rows] = await db.query<IncidentRow[]>(`${SELECT_INCIDENT_STATE} WHERE device_id = ? AND ended_at IS NULL ORDER BY started_at, id`, [deviceId]);
  const segments = await segmentsOf(db, rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id,
    condition: r.conditionName,
    level: r.level,
    start: r.startedAt,
    end: r.endedAt,
    peak: { tempF: r.peakTempF, humidity: r.peakHumidity, recordedAt: r.peakRecordedAt },
    segments: (segments.get(r.id) ?? []).map((s): Segment => ({ id: s.id, level: s.level, start: s.startedAt, end: s.endedAt })),
    cleanReadings: r.cleanReadings,
    firstCleanAt: r.firstCleanAt,
  }));
}

/**
 * Write a new incident, with its segments, and return its id. Exported for the demo, which
 * writes the incidents its backfilled week replays to.
 */
export async function insertIncident(db: Db, deviceId: number, incident: IncidentState): Promise<number> {
  const { condition, level, start, end, peak, cleanReadings, firstCleanAt } = incident;
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO incidents (device_id, condition_name, worst_level, started_at, ended_at,
                            peak_temp_f, peak_humidity, peak_recorded_at, clean_readings, first_clean_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [deviceId, condition, level, start, end, peak.tempF, peak.humidity, peak.recordedAt, cleanReadings, firstCleanAt],
  );
  const id = result.insertId;
  await db.query('INSERT INTO incident_segments (incident_id, level, started_at, ended_at) VALUES ?', [
    incident.segments.map((s) => [id, s.level, s.start, s.end]),
  ]);
  return id;
}

async function updateIncident(db: Db, { incident, change }: IncidentStep): Promise<void> {
  const { id, level, end, peak, cleanReadings, firstCleanAt } = incident;
  await db.query(
    `UPDATE incidents SET worst_level = ?, ended_at = ?, peak_temp_f = ?, peak_humidity = ?, peak_recorded_at = ?,
                          clean_readings = ?, first_clean_at = ?
     WHERE id = ?`,
    [level, end, peak.tempF, peak.humidity, peak.recordedAt, cleanReadings, firstCleanAt, id],
  );
  // Segments move only on a level change or a close: the open one ends, and a new one may start.
  if (change === null) return;
  for (const segment of incident.segments) {
    if (segment.id === undefined) {
      await db.query('INSERT INTO incident_segments (incident_id, level, started_at, ended_at) VALUES (?, ?, ?, ?)', [id, segment.level, segment.start, segment.end]);
    } else if (segment.end !== null) {
      await db.query('UPDATE incident_segments SET ended_at = ? WHERE id = ? AND ended_at IS NULL', [segment.end, segment.id]);
    }
  }
}

/** Save every step that changed its incident; return the ones a browser should hear about. */
async function saveSteps(db: Db, deviceId: number, steps: IncidentStep[]): Promise<ChangedIncident[]> {
  const changed: ChangedIncident[] = [];
  for (const step of steps) {
    if (!step.dirty) continue;
    const id = step.incident.id ?? (await insertIncident(db, deviceId, step.incident));
    if (step.incident.id !== undefined) await updateIncident(db, step);
    if (step.change !== null) changed.push({ id, change: step.change, created: step.incident.id === undefined });
  }
  return changed;
}

/**
 * A Device's latest Reading at `at`, or with `skip` the one that many steps before it: one step
 * back along the index from the latest (latestReading.ts).
 */
export async function latestReadingOf(conn: PoolConnection, deviceId: number, at: Date, skip = 0): Promise<TimedReading | null> {
  const [rows] = await conn.query<LatestReadingRow[]>(
    `SELECT temp_f AS tempF, humidity, recorded_at AS recordedAt FROM readings
     WHERE device_id = ? AND recorded_at <= ? ORDER BY device_id DESC, recorded_at DESC, id DESC LIMIT 1 OFFSET ?`,
    [deviceId, latestAllowed(at), skip],
  );
  return rows[0] ?? null;
}

/**
 * The Offline stretch a report arriving `at` ends that the sweep never opened, if any, with no
 * Offline incident open. `storedReportAt` is the Device's `last_report_at` before this report;
 * `lastReading` its latest Reading before it.
 */
function missedBy(at: Date, storedReportAt: Date | null, lastReading: TimedReading | null, rules: ConditionRules, heardSince?: Date): IncidentStep | null {
  const last = lastReportAt(storedReportAt, lastReading?.recordedAt ?? null, at);
  const previous: LastReport | null = last === null ? null : { at: last, reading: lastReading };
  // The sweep runs once every Report interval (offlineSweep.ts).
  return missedOffline(previous, at, rules, rules.reportIntervalSeconds, heardSince);
}

/**
 * Run a just-recorded Reading through the incident rules. Call it on the connection that
 * inserted the Reading, inside its transaction, holding the Device's row lock, so two Readings
 * of one Device are never judged at once. `storedReportAt` is the Device's last report before
 * this Reading, as its row held it.
 */
export async function recordReadingIncidents(
  conn: PoolConnection,
  deviceId: number,
  reading: TimedReading,
  storedReportAt: Date | null,
  rules: ConditionRules,
  heardSince?: Date,
): Promise<ChangedIncident[]> {
  const open = await loadOpenIncidents(conn, deviceId);
  const steps = applyReading(open, reading, rules);
  if (!open.some((i) => i.condition === 'Offline')) {
    // The Reading before this one.
    const previous = await latestReadingOf(conn, deviceId, reading.recordedAt, 1);
    const missed = missedBy(reading.recordedAt, storedReportAt, previous, rules, heardSince);
    if (missed !== null) steps.unshift(missed);
  }
  return saveSteps(conn, deviceId, steps);
}

/**
 * Run a fault report (docs/adr/0009) through the incident rules, under the same row lock and in
 * the same transaction as the count it raised. `sensorFaults` includes this report; `lastReading`
 * is the Device's latest Reading, its last good one (latestReadingOf); `storedReportAt` is its
 * last report before this one, as its row held it.
 */
export async function recordFaultIncidents(
  conn: PoolConnection,
  deviceId: number,
  report: { at: Date; sensorFaults: number },
  lastReading: TimedReading | null,
  storedReportAt: Date | null,
  rules: ConditionRules,
  heardSince?: Date,
): Promise<ChangedIncident[]> {
  const open = await loadOpenIncidents(conn, deviceId);
  const steps = applyFaultReport(open, report, lastReading, rules);
  if (!open.some((i) => i.condition === 'Offline')) {
    const missed = missedBy(report.at, storedReportAt, lastReading, rules, heardSince);
    if (missed !== null) steps.unshift(missed);
  }
  return saveSteps(conn, deviceId, steps);
}

interface LatestReadingRow extends RowDataPacket {
  deviceId: number;
  tempF: number;
  humidity: number | null;
  recordedAt: Date;
  /** The Device's `last_report_at`, where the query reads it. */
  lastReportAt?: Date | null;
}


/**
 * Open an Offline incident for every Device the server would now report Offline that has none
 * open. One indexed lookup per Device finds the candidates; each is then rechecked under its
 * row lock, so a report that lands meanwhile wins. Silence counts from a Device's last report, a
 * Reading or a fault report (docs/adr/0009), or from `heardSince` when that is later
 * (listening.ts). Only a Device with a Reading is a candidate: the last one is the peak. With
 * `notify`, each opening is queued for email in the same transaction (docs/adr/0008).
 */
export async function sweepOffline(pool: Pool, rules: ConditionRules, now: Date, heardSince?: Date, notify = false): Promise<ChangedIncident[]> {
  const [candidates] = await pool.query<LatestReadingRow[]>(
    `SELECT d.id AS deviceId, d.last_report_at AS lastReportAt, r.recorded_at AS recordedAt
     FROM devices d
     JOIN readings r ON r.id = (${LATEST_READING_ID})
     WHERE NOT EXISTS (SELECT 1 FROM incidents i WHERE i.device_id = d.id AND i.open_condition = 'Offline')`,
    [latestAllowed(now)],
  );
  const lastOf = (row: Pick<LatestReadingRow, 'lastReportAt' | 'tempF' | 'humidity' | 'recordedAt'>): LastReport => ({
    at: lastReportAt(row.lastReportAt ?? null, row.recordedAt, now) ?? row.recordedAt,
    reading: { tempF: row.tempF, humidity: row.humidity, recordedAt: row.recordedAt },
  });
  const changed: ChangedIncident[] = [];
  for (const { deviceId, lastReportAt: reportAt, recordedAt } of candidates) {
    // Only the times count here; the values are read under the lock.
    if (offlineIncident(lastOf({ lastReportAt: reportAt, tempF: 0, humidity: null, recordedAt }), now, rules, heardSince) === null) continue;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // The same row lock ingest takes, so a Reading and the sweep never judge one Device at once.
      const [device] = await conn.query<RowDataPacket[]>('SELECT id FROM devices WHERE id = ? FOR UPDATE', [deviceId]);
      const [latest] =
        device.length === 0
          ? [[] as LatestReadingRow[]]
          : await conn.query<LatestReadingRow[]>(
              `SELECT d.id AS deviceId, d.last_report_at AS lastReportAt, r.temp_f AS tempF, r.humidity, r.recorded_at AS recordedAt
               FROM devices d JOIN readings r ON r.id = (${LATEST_READING_ID}) WHERE d.id = ?`,
              [latestAllowed(now), deviceId],
            );
      const open = latest.length === 0 ? [] : await loadOpenIncidents(conn, deviceId);
      const step = latest.length === 0 || open.some((i) => i.condition === 'Offline') ? null : offlineIncident(lastOf(latest[0]), now, rules, heardSince);
      if (step !== null) {
        const saved = await saveSteps(conn, deviceId, [step]);
        if (notify) await enqueueNotifications(conn, saved, now);
        changed.push(...saved);
      }
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }
  return changed;
}

/** Remove every incident a Device has, segments and all (Reset history). */
export async function deleteDeviceIncidents(db: Db, deviceId: number): Promise<void> {
  await db.query('DELETE FROM incidents WHERE device_id = ?', [deviceId]);
}

/** Remove up to `limit` incidents that ended before `cutoff`; an open one stays however old. Returns how many went. */
export async function deleteIncidentsEndedBefore(db: Db, cutoff: Date, limit: number): Promise<number> {
  const [result] = await db.query<ResultSetHeader>('DELETE FROM incidents WHERE ended_at < ? LIMIT ?', [cutoff, limit]);
  return result.affectedRows;
}

interface IncidentPayloadRow extends IncidentRow {
  deviceId: number;
  hostname: string;
  closet: string;
  campusId: number;
  campusName: string;
  campusShortcode: string;
}

const SELECT_INCIDENT_PAYLOAD = `
  SELECT i.id, i.condition_name AS conditionName, i.worst_level AS level, i.started_at AS startedAt, i.ended_at AS endedAt,
         i.peak_temp_f AS peakTempF, i.peak_humidity AS peakHumidity, i.peak_recorded_at AS peakRecordedAt,
         d.id AS deviceId, d.hostname, d.closet,
         c.id AS campusId, c.name AS campusName, c.shortcode AS campusShortcode
  FROM incidents i
  JOIN devices d ON d.id = i.device_id
  JOIN campuses c ON c.id = d.campus_id`;

async function toPayloads(db: Db, rows: IncidentPayloadRow[]): Promise<IncidentPayload[]> {
  const segments = await segmentsOf(db, rows.map((r) => r.id));
  return rows.map((r) => {
    const peak = { tempF: r.peakTempF, humidity: r.peakHumidity, recordedAt: r.peakRecordedAt };
    return {
      id: r.id,
      device: { id: r.deviceId, hostname: r.hostname, closet: r.closet, campus: { id: r.campusId, name: r.campusName, shortcode: r.campusShortcode } },
      condition: r.conditionName,
      level: r.level,
      start: r.startedAt.toISOString(),
      end: r.endedAt === null ? null : r.endedAt.toISOString(),
      peak: { value: peakValue(r.conditionName, peak), tempF: peak.tempF, humidity: peak.humidity, recordedAt: peak.recordedAt.toISOString() },
      segments: (segments.get(r.id) ?? []).map((s) => ({ level: s.level, start: s.startedAt.toISOString(), end: s.endedAt === null ? null : s.endedAt.toISOString() })),
    };
  });
}

/** Every incident that overlaps [from, to), the ongoing ones included, oldest first. */
export async function incidentsOverlapping(db: Db, from: Date, to: Date): Promise<IncidentPayload[]> {
  const [rows] = await db.query<IncidentPayloadRow[]>(
    `${SELECT_INCIDENT_PAYLOAD} WHERE i.started_at < ? AND (i.ended_at IS NULL OR i.ended_at > ?) ORDER BY i.started_at, i.id`,
    [to, from],
  );
  return toPayloads(db, rows);
}

/** The incidents with these ids, oldest first. */
export async function incidentsById(db: Db, ids: number[]): Promise<IncidentPayload[]> {
  if (ids.length === 0) return [];
  const [rows] = await db.query<IncidentPayloadRow[]>(`${SELECT_INCIDENT_PAYLOAD} WHERE i.id IN (?) ORDER BY i.started_at, i.id`, [ids]);
  return toPayloads(db, rows);
}

/**
 * Tell every open dashboard about each changed incident, after the transaction that changed
 * it has committed. A failure here is logged, never thrown: the change itself is saved.
 */
export async function broadcastIncidentChanges(db: Db, sse: Broadcaster, changed: ChangedIncident[]): Promise<void> {
  if (changed.length === 0) return;
  try {
    const payloads = new Map((await incidentsById(db, changed.map((c) => c.id))).map((p) => [p.id, p]));
    for (const { id, change } of changed) {
      const incident = payloads.get(id);
      if (incident !== undefined) sse.broadcast({ type: 'incident', change, incident });
    }
  } catch (error) {
    console.error('incidents: could not broadcast a change:', error);
  }
}
