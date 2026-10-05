// HTTP poller: /api/dashboard, /api/campuses/overview, /api/incidents (7 days), and one History
// day, one round every `everyMs`, with p50/p95/p99 per endpoint. It reads RateLimit-Remaining, so
// the per-address budget (500 per 15 min, app.ts) shows in the results.
//
//   node poller.mjs --env <scratch env> --every 10 --minutes 2 [--history-device 1 --history-date 2026-10-04]
import { parseArgs, defaults, summarize, sleep } from './lib.mjs';

export function endpoints({ historyDeviceId, historyDate, tz = 'America/Chicago' }) {
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 86_400_000);
  const list = {
    dashboard: '/api/dashboard',
    overview: `/api/campuses/overview?tz=${encodeURIComponent(tz)}`,
    incidents7d: `/api/incidents?from=${from.toISOString()}&to=${to.toISOString()}`,
  };
  if (historyDeviceId) list.historyDay = `/api/devices/${historyDeviceId}/history?tz=${encodeURIComponent(tz)}${historyDate ? `&date=${historyDate}` : ''}`;
  return list;
}

export async function timeGet(base, path) {
  const t0 = performance.now();
  try {
    const res = await fetch(base + path);
    const body = await res.arrayBuffer();
    return { ms: performance.now() - t0, status: res.status, bytes: body.byteLength, remaining: res.headers.get('ratelimit-remaining') ?? res.headers.get('ratelimit')?.match(/r=(\d+)/)?.[1] };
  } catch (e) {
    return { ms: performance.now() - t0, status: 0, err: e.cause?.code ?? e.message };
  }
}

export function startPoller({ base }, { everyMs = 10_000, ...opts }) {
  const results = []; // { t, name, ms, status, bytes, remaining }
  let running = true;
  const loop = (async () => {
    while (running) {
      const started = Date.now();
      for (const [name, path] of Object.entries(endpoints(opts))) {
        if (!running) break;
        const r = await timeGet(base, path);
        results.push({ t: Date.now(), name, ...r });
      }
      await sleep(Math.max(0, everyMs - (Date.now() - started)));
    }
  })();
  return {
    results,
    async stop() {
      running = false;
      await loop;
    },
    stats(fromT = 0, toT = Infinity) {
      const out = {};
      for (const r of results) {
        if (r.t < fromT || r.t > toT) continue;
        const e = (out[r.name] ??= { all: [], statuses: {}, bytes: 0 });
        e.statuses[r.status] = (e.statuses[r.status] ?? 0) + 1;
        if (r.status === 200) {
          e.all.push(r.ms);
          e.bytes = r.bytes;
        }
        if (r.remaining !== undefined && r.remaining !== null) e.lastRemaining = Number(r.remaining);
      }
      for (const e of Object.values(out)) {
        Object.assign(e, summarize(e.all));
        delete e.all;
      }
      return out;
    },
  };
}

if (process.argv[1]?.endsWith('poller.mjs')) {
  const args = parseArgs();
  const cfg = defaults(args);
  const p = startPoller(cfg, { everyMs: Number(args.every ?? 10) * 1000, historyDeviceId: args['history-device'], historyDate: args['history-date'] });
  await sleep(Number(args.minutes ?? 1) * 60_000);
  await p.stop();
  console.log(JSON.stringify(p.stats(), null, 2));
}
