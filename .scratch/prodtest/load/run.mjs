// One load run: N Devices posting, M dashboards streaming, the poller, and docker stats every
// 10 s, for a fixed time or a ramp of fleet sizes. Writes runs/load-<label>-<time>.json.
//
//   node run.mjs --env <scratch env> --label baseline --devices 100 --streams 30 --minutes 15 --poll-every 12
//   node run.mjs --env <scratch env> --label ramp --devices 300 --streams 60 --minutes 10 --via sql \
//                --ramp 500:3,700:3,1000:4
//   options: --campus-tabs K (Campuses pages that reload the overview), --history-date YYYY-MM-DD,
//            --no-poll, --hold (keep posting until SIGINT/--minutes; used to run retention alongside)
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { parseArgs, defaults, summarize, sleep, stamp, writeJson, log, mysql, startDockerStats, RUNS } from './lib.mjs';
import { registerDevices, startDevices } from './devices.mjs';
import { startBrowsers } from './browsers.mjs';
import { startPoller } from './poller.mjs';
import { join } from 'node:path';

const args = parseArgs();
const cfg = defaults(args);
const label = args.label ?? 'run';
const logFile = join(RUNS, `load-${label}-${stamp()}.log`);
const devicesN = Number(args.devices ?? 100);
const streams = Number(args.streams ?? 30);
const minutes = Number(args.minutes ?? 15);
const ramp = (args.ramp && args.ramp !== true ? args.ramp.split(',') : []).map((s) => {
  const [n, m] = s.split(':').map(Number);
  return { devices: n, minutes: m };
});
const maxDevices = Math.max(devicesN, ...ramp.map((r) => r.devices));

function dbSize() {
  const out = mysql(cfg.project, `SELECT COUNT(*) FROM readings; SELECT COUNT(*) FROM incidents;`).trim().split('\n');
  let ibd = NaN;
  try {
    const ls = mysql(cfg.project, `SELECT FILE_SIZE FROM information_schema.INNODB_TABLESPACES WHERE NAME = 'temperature_alarms/readings';`).trim();
    ibd = Number(ls);
  } catch {}
  let binlogBytes = NaN;
  try {
    binlogBytes = mysql(cfg.project, 'SHOW BINARY LOGS;').trim().split('\n').reduce((a, l) => a + Number(l.split('\t')[1] ?? 0), 0);
  } catch {}
  return { t: Date.now(), readings: Number(out[0]), incidents: Number(out[1]), readingsIbdBytes: ibd, binlogBytes };
}

const elDelay = monitorEventLoopDelay({ resolution: 20 });
elDelay.enable();

log(logFile, `run ${label}: devices ${devicesN}${ramp.length ? ` then ${args.ramp}` : ''}, streams ${streams}, ${minutes} min, base ${cfg.base}`);
// Registration: the first 100 through the admin API (as an operator would), any beyond with SQL
// unless --via api, so the admin budget is not what the run measures.
const reg = await registerDevices(cfg, Math.min(maxDevices, Number(args['api-devices'] ?? 100)), { via: args.via === 'sql' ? 'sql' : 'api' });
let all = reg;
if (maxDevices > reg.devices.length) all = await registerDevices(cfg, maxDevices, { via: 'sql' });
log(logFile, `registration: ${reg.registered} via ${args.via === 'sql' ? 'sql' : 'api'} in ${reg.requests} requests ${JSON.stringify(reg.statuses)}; fleet ${all.devices.length}`);

const sizeBefore = dbSize();
const stats = startDockerStats(cfg.project, 10_000);
const browsers = startBrowsers(cfg, { streams, campusTabs: Number(args['campus-tabs'] ?? 0) });
await sleep(2000);
log(logFile, `streams open: ${browsers.openCount}`);
const sim = startDevices(cfg, { active: devicesN, onSend: browsers.onSend });
const poller = args['no-poll']
  ? null
  : startPoller(cfg, { everyMs: Number(args['poll-every'] ?? 12) * 1000, historyDeviceId: all.devices[0].id, historyDate: args['history-date'] });

const t0 = Date.now();
const steps = [{ devices: devicesN, from: t0, to: t0 + minutes * 60_000 }];
let at = steps[0].to;
for (const r of ramp) {
  steps.push({ devices: r.devices, from: at, to: at + r.minutes * 60_000 });
  at += r.minutes * 60_000;
}

// A line a minute so a long run can be watched.
const ticker = setInterval(() => {
  const now = Date.now();
  const s = sim.stats(now - 60_000);
  const b = browsers.stats(now - 60_000);
  log(logFile, `minute: active ${sim.active} posts ${s.posts} errors ${s.errors} ingest p99 ${s.ingestMs.p99} ms; fan-out p99 ${b.fanoutMs.p99} ms (${b.deliveries} deliveries, ${b.streamsOpen} open); el p99 ${(elDelay.percentile(99) / 1e6).toFixed(1)} ms`);
}, 60_000);

let stepResults = [];
let stop = false;
process.on('SIGINT', () => (stop = true));
for (const [i, step] of steps.entries()) {
  if (i > 0) {
    sim.setActive(step.devices);
    log(logFile, `ramp: ${step.devices} Devices`);
  }
  while (!stop && Date.now() < step.to) await sleep(1000);
  // Skip the first 35 s of each ramp step: new boards' first posts are spread over 30 s.
  const from = i === 0 ? step.from : step.from + 35_000;
  const s = sim.stats(from, step.to);
  const b = browsers.stats(from, step.to);
  stepResults.push({ devices: step.devices, minutes: (step.to - step.from) / 60_000, ingest: s, browsers: b, docker: stats.summary(from, step.to) });
  log(logFile, `step ${step.devices}: ${JSON.stringify({ posts: s.posts, statuses: s.statuses, ingestMs: s.ingestMs, fanoutMs: b.fanoutMs })}`);
  if (stop) break;
}
clearInterval(ticker);

const tEnd = Date.now();
await sim.stop();
await poller?.stop();
await browsers.stop();
await stats.stop();
const sizeAfter = dbSize();
const hours = (sizeAfter.t - sizeBefore.t) / 3_600_000;

const posts201 = sim.results.filter((r) => r.status === 201).length;
const summary = {
  label,
  startedAt: new Date(t0).toISOString(),
  endedAt: new Date(tEnd).toISOString(),
  config: { devices: devicesN, ramp, streams, campusTabs: Number(args['campus-tabs'] ?? 0), minutes, pollEverySec: Number(args['poll-every'] ?? 12) },
  registration: { requests: reg.requests, statuses: reg.statuses, registered: reg.registered },
  ingest: sim.stats(),
  browsers: browsers.stats(0, Infinity, undefined),
  deliveredRatio: Math.round((browsers.stats().deliveries / Math.max(1, posts201 * streams)) * 10000) / 100,
  api: poller?.stats(),
  docker: stats.summary(),
  dockerSamples: stats.samples.length,
  steps: stepResults,
  db: {
    before: sizeBefore,
    after: sizeAfter,
    readingsPerHour: Math.round((sizeAfter.readings - sizeBefore.readings) / hours),
    incidentsPerHour: Math.round((sizeAfter.incidents - sizeBefore.incidents) / hours),
    binlogBytesPerHour: Math.round((sizeAfter.binlogBytes - sizeBefore.binlogBytes) / hours),
  },
  loadGeneratorEventLoopMs: { p50: elDelay.percentile(50) / 1e6, p99: elDelay.percentile(99) / 1e6, max: elDelay.max / 1e6 },
};
const path = writeJson(`load-${label}-${stamp()}.json`, summary);
log(logFile, `wrote ${path}`);
console.log(JSON.stringify({ ingest: summary.ingest, fanout: summary.browsers.fanoutMs, deliveredRatio: summary.deliveredRatio, api: summary.api, docker: summary.docker, db: summary.db.readingsPerHour }, null, 2));
process.exit(0);
