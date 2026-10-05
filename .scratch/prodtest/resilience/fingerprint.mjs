// The data that must survive every step of the upgrade path, as one line of numbers:
// Campuses and Devices whole, and every Reading before --before (ISO, UTC) by count and sums.
// Also the migrations recorded and which tables exist.
//   node fingerprint.mjs --env <district .env> --project ta-res --before 2026-10-05T19:40:00Z [--label x]
import { parseArgs, defaults, mysql } from '../load/lib.mjs';

const args = parseArgs();
const cfg = defaults(args);
const before = (args.before ?? new Date().toISOString()).replace('T', ' ').replace(/\.\d+Z$|Z$/, '');
const q = (s) => mysql(cfg.project, s).trim();
const out = {
  label: args.label ?? '',
  at: new Date().toISOString(),
  campuses: q("SELECT CONCAT(COUNT(*), ' crc ', COALESCE(SUM(CRC32(CONCAT_WS('|', id, name, shortcode))), 0)) FROM campuses;"),
  devices: q("SELECT CONCAT(COUNT(*), ' crc ', COALESCE(SUM(CRC32(CONCAT_WS('|', id, hostname, campus_id, closet))), 0)) FROM devices;"),
  readingsBefore: q(`SELECT CONCAT(COUNT(*), ' t ', SUM(temp_f), ' h ', SUM(humidity), ' ts ', SUM(UNIX_TIMESTAMP(recorded_at))) FROM readings WHERE recorded_at < '${before}';`),
  readingsAll: q('SELECT COUNT(*) FROM readings;'),
  migrations: q("SELECT GROUP_CONCAT(id ORDER BY id) FROM schema_migrations;"),
  tables: q("SELECT GROUP_CONCAT(table_name ORDER BY table_name) FROM information_schema.tables WHERE table_schema = 'temperature_alarms';"),
  incidents: q("SELECT IF(COUNT(*) = 0, 'no table', 'table') FROM information_schema.tables WHERE table_schema = 'temperature_alarms' AND table_name = 'incidents';") === 'table'
    ? q("SELECT CONCAT(COUNT(*), ' total, ', SUM(ended_at IS NULL), ' open, ', COALESCE(GROUP_CONCAT(DISTINCT condition_name), '')) FROM incidents;")
    : 'no incidents table',
};
console.log(JSON.stringify(out));
