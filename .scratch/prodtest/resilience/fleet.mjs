// Resilience fleet: N Devices posting every 30 s as the firmware does (one attempt per interval,
// 10 s HTTP timeout, nothing retried or buffered), plus M dashboards that behave like the
// frontend's useReadingStream: EventSource retries a dropped stream after ~3 s by itself; a
// non-200 answer closes it and the hook reopens after 5 s; on every reopen the page reloads
// /api/dashboard. Every POST and every stream event is logged as JSON lines, so a drill's window
// can be analysed afterwards (analyze.mjs).
//
//   node fleet.mjs --env <scratch env> --devices 50 --streams 5 --out <dir>
// Stops when <out>/STOP exists (or on SIGINT), then writes <out>/fleet-summary.json.
import { appendFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, defaults, sleep } from '../load/lib.mjs';
import { registerDevices, mulberry32 } from '../load/devices.mjs';

const args = parseArgs();
const cfg = defaults(args);
const N = Number(args.devices ?? 50);
const M = Number(args.streams ?? 5);
const OUT = args.out;
mkdirSync(OUT, { recursive: true });
const POSTS = join(OUT, 'posts.jsonl');
const STREAMS = join(OUT, 'streams.jsonl');
const line = (file, obj) => appendFileSync(file, JSON.stringify({ t: Date.now(), ...obj }) + '\n');

const INTERVAL_MS = 30_000;
const FIRMWARE_TIMEOUT_MS = 10_000; // reporter.cpp HTTP_TIMEOUT_MS
const EVENTSOURCE_RETRY_MS = 3_000; // Chromium's default reconnection time
const HOOK_REOPEN_MS = 5_000; // use-reading-stream.ts REOPEN_AFTER_MS

const reg = await registerDevices(cfg, N, { via: 'api' });
const devices = reg.devices; // [{id, hostname}]
console.log(`devices: ${devices.length} (registered ${reg.registered} now)`);
const lastOk = new Map(); // hostname -> recordedAt ISO of the latest 201
let running = true;
const rng = mulberry32(7);

// ---- Devices ----------------------------------------------------------------------------
function board(i) {
  return { i, hostname: devices[i].hostname, temp: 66 + rng() * 10, hum: 30 + rng() * 20, hot: i < 3 };
}
const boards = devices.map((_, i) => board(i));
async function post(b) {
  // The first three boards run Hot (85-88 F) the whole time, so open incidents exist to check.
  const temp = b.hot ? 85 + Math.round(rng() * 3) : Math.round(b.temp + (rng() - 0.5) * 2);
  const humidity = Math.round(b.hum + (rng() - 0.5) * 3);
  const t0 = performance.now();
  let status = 0;
  let err;
  let rec;
  try {
    const res = await fetch(`${cfg.base}/api/readings`, {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.deviceToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ device: b.hostname.replace('_', '-'), temp, humidity }),
      signal: AbortSignal.timeout(FIRMWARE_TIMEOUT_MS),
    });
    status = res.status;
    const text = await res.text();
    if (status === 201) {
      rec = JSON.parse(text).reading.recordedAt;
      lastOk.set(b.hostname, rec);
    }
  } catch (e) {
    err = e.name === 'TimeoutError' ? 'timeout' : (e.cause?.code ?? e.message);
  }
  line(POSTS, { host: b.hostname, status, err, ms: Math.round(performance.now() - t0), rec });
}
for (const b of boards) {
  (async () => {
    await sleep(rng() * INTERVAL_MS);
    while (running) {
      const started = Date.now();
      void post(b);
      await sleep(Math.max(0, INTERVAL_MS + (rng() * 2 - 1) * 1000 - (Date.now() - started)));
    }
  })();
}

// ---- Dashboards ---------------------------------------------------------------------------
async function catchUp(client) {
  const before = new Map(lastOk);
  try {
    const res = await fetch(`${cfg.base}/api/dashboard`);
    if (res.status !== 200) {
      line(STREAMS, { client, ev: 'catchup', status: res.status });
      return;
    }
    const body = await res.json();
    let stale = 0;
    for (const d of body.devices) {
      const want = before.get(d.hostname);
      if (want === undefined) continue;
      const got = d.latestReading?.recordedAt;
      if (got === undefined || got < want) stale++;
    }
    line(STREAMS, { client, ev: 'catchup', status: 200, devices: body.devices.length, stale });
  } catch (e) {
    line(STREAMS, { client, ev: 'catchup', err: e.cause?.code ?? e.message });
  }
}

const received = new Array(M).fill(0);
async function dashboard(client) {
  let dropped = false;
  while (running) {
    const ctl = new AbortController();
    let wait = EVENTSOURCE_RETRY_MS;
    try {
      const res = await fetch(`${cfg.base}/api/dashboard/stream`, { headers: { accept: 'text/event-stream' }, signal: ctl.signal });
      if (res.status !== 200) {
        line(STREAMS, { client, ev: 'status', status: res.status });
        await res.arrayBuffer().catch(() => {});
        dropped = true;
        wait = HOOK_REOPEN_MS + EVENTSOURCE_RETRY_MS * 0; // EventSource CLOSED: the hook reopens after 5 s
      } else {
        line(STREAMS, { client, ev: 'open', reconnect: dropped });
        if (dropped) void catchUp(client);
        dropped = false;
        const decoder = new TextDecoder();
        let buf = '';
        for await (const chunk of res.body) {
          buf += decoder.decode(chunk, { stream: true });
          let cut;
          while ((cut = buf.indexOf('\n\n')) !== -1) {
            const frame = buf.slice(0, cut);
            buf = buf.slice(cut + 2);
            if (frame.startsWith('data: ')) {
              const ev = JSON.parse(frame.slice(6));
              if (ev.type === 'reading') received[client]++;
              else line(STREAMS, { client, ev: 'incident', change: ev.change, id: ev.incident.id, cond: ev.incident.condition, host: ev.incident.device.hostname });
            }
          }
          if (!running) ctl.abort();
        }
        line(STREAMS, { client, ev: 'drop', why: 'eof' });
        dropped = true;
      }
    } catch (e) {
      if (!running) break;
      line(STREAMS, { client, ev: 'drop', why: e.cause?.code ?? e.message });
      dropped = true;
    }
    await sleep(wait);
  }
}
for (let c = 0; c < M; c++) void dashboard(c);

// ---- Run until told to stop -----------------------------------------------------------------
const startedAt = Date.now();
process.on('SIGINT', () => (running = false));
while (running) {
  await sleep(2000);
  if (existsSync(join(OUT, 'STOP'))) running = false;
}
await sleep(FIRMWARE_TIMEOUT_MS + 1000);
writeFileSync(join(OUT, 'fleet-summary.json'), JSON.stringify({ startedAt, stoppedAt: Date.now(), devices, received }, null, 2));
console.log('fleet stopped');
process.exit(0);
