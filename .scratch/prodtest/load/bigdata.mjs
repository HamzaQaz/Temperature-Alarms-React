// Big data: 90 days of Readings for 100 Devices straight into MySQL, then the measurements.
//
//   node bigdata.mjs load      --env <scratch env> [--days 90 --extra-days 1 --devices 100]
//   node bigdata.mjs measure   --env <scratch env> [--tag default]   API timings + EXPLAIN ANALYZE
//   node bigdata.mjs retention --env <scratch env>                   retention pass under live ingest
//   node bigdata.mjs sweep     --env <scratch env>                   the Offline sweep, 100 Devices
//
// The load is INSERT ... SELECT inside the server, one local day (2,880 slots x Devices) per
// statement, oldest first, ordered by time so the primary key and ix_readings_recorded append as
// they do under real ingest. The loader's session skips the binlog (it is a test fixture, not a
// change anyone replicates); real ingest still writes it. Readings end where the live ones begin.
import { parseArgs, defaults, summarize, sleep, stamp, writeJson, log, mysql, mysqlAsync, apiNode, RUNS } from './lib.mjs';
import { startDevices } from './devices.mjs';
import { startBrowsers } from './browsers.mjs';
import { timeGet } from './poller.mjs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const args = parseArgs();
const cfg = defaults(args);
const cmd = args._[0];
const logFile = join(RUNS, `bigdata-${cmd}-${stamp()}.log`);
const q = (sql) => mysql(cfg.project, sql).trim();
const TZ = 'America/Chicago';

async function load() {
  const days = Number(args.days ?? 90);
  const extra = Number(args['extra-days'] ?? 1);
  const n = Number(args.devices ?? 100);
  const ids = q(`SELECT id FROM devices WHERE hostname LIKE 'ESP_A%' ORDER BY hostname LIMIT ${n};`).split('\n').map(Number);
  if (ids.length < n) throw new Error(`only ${ids.length} load Devices registered; run the baseline first`);
  // The oldest live Reading, or now: the backfill ends 30 s before it.
  const boundary = q(`SELECT UNIX_TIMESTAMP(COALESCE(MIN(recorded_at), UTC_TIMESTAMP())) FROM readings;`);
  const end = Number(boundary) - 30;
  const before = q('SELECT COUNT(*) FROM readings;');
  log(logFile, `load: ${days}+${extra} days x ${ids.length} Devices, ending ${new Date(end * 1000).toISOString()}; ${before} Readings now`);
  q(`SET SESSION cte_max_recursion_depth = 10000; DROP TABLE IF EXISTS _load_slots; CREATE TABLE _load_slots (n INT PRIMARY KEY);
     INSERT INTO _load_slots WITH RECURSIVE s(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM s WHERE n < 2879) SELECT n FROM s;`);
  const idList = ids.join(',');
  const t0 = Date.now();
  for (let day = days + extra; day >= 1; day--) {
    const dayStart = end - day * 86400;
    // A daily cycle per Device, noise, and a Hot afternoon (14:00-14:40 into the day) for one
    // Device in three each day, which the incidents below match. Humidity drifts 25-55%.
    const sql = `SET SESSION sql_log_bin = 0; SET SESSION cte_max_recursion_depth = 10000;
      INSERT INTO readings (device_id, temp_f, humidity, recorded_at)
      SELECT d.id,
             IF((d.id + ${day}) % 3 = 0 AND s.n BETWEEN 1680 AND 1760, 84 + (d.id % 5),
                ROUND(70 + 5 * SIN(2 * PI() * s.n / 2880 + d.id) + 2 * (RAND() - 0.5))),
             ROUND(40 + 12 * SIN(2 * PI() * s.n / 2880 + d.id / 3) + 4 * (RAND() - 0.5)),
             FROM_UNIXTIME(${dayStart} + s.n * 30 + (d.id % 30))
      FROM _load_slots s CROSS JOIN devices d
      WHERE d.id IN (${idList})
      ORDER BY s.n, d.id;`;
    const ts = Date.now();
    await mysqlAsync(cfg.project, sql);
    if (day % 10 === 0 || day <= 2) log(logFile, `load: day -${day} done in ${Date.now() - ts} ms (total ${Math.round((Date.now() - t0) / 1000)} s)`);
  }
  const loadSeconds = (Date.now() - t0) / 1000;
  // Incidents: the Hot afternoons above, closed, one warning segment each.
  const ti = Date.now();
  await mysqlAsync(
    cfg.project,
    `SET SESSION sql_log_bin = 0;
     DROP TABLE IF EXISTS _load_days; CREATE TABLE _load_days (day INT PRIMARY KEY);
     INSERT INTO _load_days WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM s WHERE n < ${days + extra}) SELECT n FROM s;
     INSERT INTO incidents (device_id, condition_name, worst_level, started_at, ended_at, peak_temp_f, peak_humidity, peak_recorded_at, clean_readings, first_clean_at)
     SELECT d.id, 'Hot', 'warning', FROM_UNIXTIME(${end} - x.day * 86400 + 1680 * 30 + (d.id % 30)),
            FROM_UNIXTIME(${end} - x.day * 86400 + 1764 * 30 + (d.id % 30)), 84 + (d.id % 5), 40,
            FROM_UNIXTIME(${end} - x.day * 86400 + 1700 * 30 + (d.id % 30)), 3, FROM_UNIXTIME(${end} - x.day * 86400 + 1761 * 30 + (d.id % 30))
     FROM devices d CROSS JOIN _load_days x WHERE d.id IN (${idList}) AND (d.id + x.day) % 3 = 0 ORDER BY 4, 1;
     INSERT INTO incident_segments (incident_id, level, started_at, ended_at)
     SELECT id, 'warning', started_at, ended_at FROM incidents WHERE id NOT IN (SELECT incident_id FROM incident_segments);
     DROP TABLE _load_days; DROP TABLE _load_slots;`,
  );
  const incidentSeconds = (Date.now() - ti) / 1000;
  q('ANALYZE TABLE readings, incidents, incident_segments;');
  const sizes = q(`SELECT TABLE_NAME, TABLE_ROWS, DATA_LENGTH, INDEX_LENGTH FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'temperature_alarms';`);
  const files = q(`SELECT NAME, FILE_SIZE FROM information_schema.INNODB_TABLESPACES WHERE NAME LIKE 'temperature_alarms/%';`);
  const count = q('SELECT COUNT(*) FROM readings;');
  const result = { days, extra, devices: ids.length, readings: Number(count), loadSeconds, incidentSeconds, rowsPerSecond: Math.round((Number(count) - Number(before)) / loadSeconds), sizes, files };
  log(logFile, `load: ${JSON.stringify(result)}`);
  writeJson(`bigdata-load-${stamp()}.json`, result);
}

/** n sequential GETs; returns the timings and the statuses. */
async function timeN(path, n) {
  const rs = [];
  for (let i = 0; i < n; i++) rs.push(await timeGet(cfg.base, path));
  const statuses = rs.reduce((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {});
  return { ...summarize(rs.filter((r) => r.status === 200).map((r) => r.ms)), statuses, bytes: rs.at(-1)?.bytes, first: Math.round(rs[0].ms), remaining: rs.at(-1)?.remaining };
}

function restart(service) {
  execFileSync('docker', ['restart', `${cfg.project}-${service}-1`], { stdio: 'ignore' });
}

async function waitHealthy() {
  for (let i = 0; i < 120; i++) {
    const r = await timeGet(cfg.base, '/api/health');
    if (r.status === 200) return;
    await sleep(1000);
  }
  throw new Error('api did not come back');
}

async function measure() {
  const tag = args.tag ?? 'default';
  const deviceId = q(`SELECT id FROM devices WHERE hostname LIKE 'ESP_A%' ORDER BY hostname LIMIT 1;`);
  const yesterday = new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA', { timeZone: TZ });
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 86_400_000);
  const paths = {
    dashboard: '/api/dashboard',
    overview: `/api/campuses/overview?tz=${encodeURIComponent(TZ)}`,
    incidents7d: `/api/incidents?from=${from.toISOString()}&to=${to.toISOString()}`,
    historyDay: `/api/devices/${deviceId}/history?tz=${encodeURIComponent(TZ)}&date=${yesterday}`,
  };
  const out = { tag, at: new Date().toISOString() };
  // Cold everything: restart db (empty buffer pool) and api (empty overview cache).
  log(logFile, 'measure: restarting db and api for a cold start');
  restart('db');
  await sleep(5000);
  restart('api');
  await waitHealthy();
  out.coldDb = {};
  out.coldDb.overview = (await timeGet(cfg.base, paths.overview)).ms;
  out.coldDb.dashboard = (await timeGet(cfg.base, paths.dashboard)).ms;
  out.coldDb.incidents7d = (await timeGet(cfg.base, paths.incidents7d)).ms;
  out.coldDb.historyDay = (await timeGet(cfg.base, paths.historyDay)).ms;
  // Warm db, cold overview cache: restart api only.
  restart('api');
  await waitHealthy();
  out.overviewColdCache = (await timeGet(cfg.base, paths.overview)).ms;
  out.overviewCached = await timeN(paths.overview, 10);
  out.dashboard = await timeN(paths.dashboard, 10);
  out.incidents7d = await timeN(paths.incidents7d, 10);
  out.historyDay = await timeN(paths.historyDay, 10);
  log(logFile, `measure: ${JSON.stringify(out)}`);

  // EXPLAIN ANALYZE of the heavy statements, from the server's own SQL.
  const wk = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
  const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const explains = {
    dayMaxima6Days: `EXPLAIN ANALYZE SELECT d.id AS deviceId, CASE WHEN r.recorded_at < '${day}' THEN 0 ELSE 1 END AS day, MAX(r.temp_f) FROM devices d JOIN readings r FORCE INDEX (ix_readings_device_recorded) ON r.device_id = d.id AND r.recorded_at >= '${wk}' AND r.recorded_at < '${now}' GROUP BY d.id, day;`,
    dashboard: `EXPLAIN ANALYZE SELECT d.id, r.temp_f, r.recorded_at FROM devices d JOIN campuses c ON c.id = d.campus_id LEFT JOIN readings r ON r.id = (SELECT r2.id FROM readings r2 WHERE r2.device_id = d.id ORDER BY r2.device_id DESC, r2.recorded_at DESC, r2.id DESC LIMIT 1) ORDER BY c.name, d.closet, d.hostname;`,
    incidents7d: `EXPLAIN ANALYZE SELECT i.id FROM incidents i JOIN devices d ON d.id = i.device_id JOIN campuses c ON c.id = d.campus_id WHERE i.started_at < '${now}' AND (i.ended_at IS NULL OR i.ended_at > '${wk}') ORDER BY i.started_at, i.id;`,
    retentionBatch: `EXPLAIN SELECT id FROM readings WHERE recorded_at < '${new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 19).replace('T', ' ')}' LIMIT 5000;`,
  };
  out.explain = {};
  for (const [k, sql] of Object.entries(explains)) out.explain[k] = mysql(cfg.project, sql).trim();
  const path = writeJson(`bigdata-measure-${tag}-${stamp()}.json`, out);
  log(logFile, `wrote ${path}`);
}

async function retention() {
  // 100 Devices and 3 dashboards posting throughout; retention runs in the api container with the
  // server's own code (dist/retention.js), on its own pool, as the daily job does.
  const browsers = startBrowsers(cfg, { streams: 3 });
  await sleep(1500);
  const sim = startDevices(cfg, { active: Number(args.devices ?? 100), onSend: browsers.onSend });
  const warm = Number(args.warm ?? 90) * 1000;
  log(logFile, `retention: ingest warming for ${warm / 1000} s`);
  await sleep(warm);
  const before = q('SELECT COUNT(*), MIN(recorded_at) FROM readings;');
  const t1 = Date.now();
  const output = await apiNode(
    cfg.project,
    `const { loadConfig } = require('./dist/config'); const { createPool } = require('./dist/db');
     const { deleteReadingsPastWindow } = require('./dist/retention');
     const config = loadConfig(); const pool = createPool(config.database); const t = Date.now();
     deleteReadingsPastWindow({ pool, config }).then((n) => { console.log(JSON.stringify({ removed: n, ms: Date.now() - t })); return pool.end(); })
       .catch((e) => { console.error(e); process.exit(1); });`,
  );
  const t2 = Date.now();
  log(logFile, `retention: ${output.trim()}`);
  await sleep(warm);
  const t3 = Date.now();
  await sim.stop();
  await browsers.stop();
  const after = q('SELECT COUNT(*), MIN(recorded_at) FROM readings;');
  const out = {
    pass: JSON.parse(output.trim().split('\n').at(-1)),
    readingsBefore: before,
    readingsAfter: after,
    ingestBefore: sim.stats(t1 - warm + 35_000, t1),
    ingestDuring: sim.stats(t1, t2),
    ingestAfter: sim.stats(t2, t3),
    fanoutDuring: browsers.stats(t1, t2).fanoutMs,
  };
  log(logFile, `retention: ${JSON.stringify(out)}`);
  writeJson(`bigdata-retention-${stamp()}.json`, out);
}

async function sweep() {
  // Every Device silent (nothing is posting), so a pass finds all of them; time it with the
  // server's own code, then once more when they are all already Offline (the steady state).
  const code = `const { loadConfig } = require('./dist/config'); const { createPool } = require('./dist/db');
    const { runOfflineSweep } = require('./dist/offlineSweep');
    const config = loadConfig(); const pool = createPool(config.database); const sse = { broadcast() {}, clientCount: 0 };
    (async () => { const out = [];
      // The api's own sweep (every 30 s) has opened them already: clear them so pass 1 opens all again.
      await pool.query("DELETE FROM incidents WHERE open_condition = 'Offline'");
      for (let i = 0; i < 3; i++) { const t = Date.now(); const opened = await runOfflineSweep({ pool, config, sse }); out.push({ opened, ms: Date.now() - t }); }
      console.log(JSON.stringify(out)); await pool.end(); })().catch((e) => { console.error(e); process.exit(1); });`;
  const open = q(`SELECT COUNT(*) FROM incidents WHERE open_condition = 'Offline';`);
  const lastAgo = q('SELECT TIMESTAMPDIFF(SECOND, MAX(recorded_at), UTC_TIMESTAMP()) FROM readings;');
  log(logFile, `sweep: ${open} Offline incidents open; the last Reading is ${lastAgo} s old`);
  const output = await apiNode(cfg.project, code);
  const explain = mysql(
    cfg.project,
    `EXPLAIN ANALYZE SELECT d.id AS deviceId, r.recorded_at AS recordedAt FROM devices d JOIN readings r ON r.id = (SELECT r2.id FROM readings r2 WHERE r2.device_id = d.id ORDER BY r2.device_id DESC, r2.recorded_at DESC, r2.id DESC LIMIT 1) WHERE NOT EXISTS (SELECT 1 FROM incidents i WHERE i.device_id = d.id AND i.open_condition = 'Offline');`,
  ).trim();
  const out = { passes: JSON.parse(output.trim()), explain };
  log(logFile, `sweep: ${JSON.stringify(out.passes)}`);
  writeJson(`bigdata-sweep-${stamp()}.json`, out);
}

const commands = { load, measure, retention, sweep };
if (!commands[cmd]) {
  console.error(`usage: node bigdata.mjs ${Object.keys(commands).join('|')} --env <scratch env>`);
  process.exit(2);
}
await commands[cmd]();
process.exit(0);
