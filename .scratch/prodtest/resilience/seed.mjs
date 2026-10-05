// Upgrade path: seed an early adopter's install (fa39159) with 50 Devices on 10 Campuses through
// the admin API, then two days of Readings every 30 s straight into MySQL, ending a minute ago.
// Three Devices run Hot for an hour each day. Prints the fingerprint fingerprint.mjs compares later.
//   node seed.mjs --env <district .env> --project ta-res
import { parseArgs, defaults, mysql } from '../load/lib.mjs';
import { registerDevices } from '../load/devices.mjs';

const args = parseArgs();
const cfg = defaults(args);
const reg = await registerDevices(cfg, 50, { via: 'api' });
console.log(`registered ${reg.registered} Devices (${JSON.stringify(reg.statuses)})`);
const ids = reg.devices.map((d) => d.id);
const sql = `
SET SESSION cte_max_recursion_depth = 10000;
SET @end = UTC_TIMESTAMP() - INTERVAL 60 SECOND;
INSERT INTO readings (device_id, temp_f, humidity, recorded_at)
WITH RECURSIVE s (n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM s WHERE n < 5759)
SELECT d.id,
       IF(d.id IN (${ids.slice(0, 3).join(',')}) AND MOD(s.n, 2880) BETWEEN 1200 AND 1319, 86, 68 + MOD(d.id * 7 + s.n, 7)),
       35 + MOD(d.id + s.n, 11),
       @end - INTERVAL (5759 - s.n) * 30 SECOND
FROM s CROSS JOIN devices d WHERE d.id IN (${ids.join(',')});
SELECT COUNT(*) FROM readings;`;
console.log(`readings now: ${mysql(cfg.project, sql).trim()}`);
