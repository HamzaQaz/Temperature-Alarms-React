// Browser simulator: M open dashboards, each an SSE stream on /api/dashboard/stream. For every
// Reading event it times delivery from the instant the Device simulator sent the POST (same
// process, same clock) to its arrival on that stream.
//
// `campusTabs: K` adds K Campuses pages: each also reloads /api/campuses/overview on stream
// messages, throttled to one per 10 s, exactly as frontend/src/pages/Campuses.tsx does.
import { summarize } from './lib.mjs';

const CAMPUS_REFRESH_MS = 10_000;

export function startBrowsers({ base }, { streams, campusTabs = 0, tz = 'America/Chicago' }) {
  const sent = new Map(); // hostname -> performance.now() of the latest POST
  const deliveries = []; // { t, ms }
  const conns = [];
  const reloads = []; // { t, ms, status }
  let readingEvents = 0;
  let incidentEvents = 0;
  let streamErrors = 0;
  let stopped = false;

  const onSend = (hostname, t0) => sent.set(hostname, t0);

  const open = (index, campusTab) => {
    const ctl = new AbortController();
    const c = { index, campusTab, ctl, status: 0, opened: 0, received: 0, errors: [], lastLoad: 0, timer: undefined };
    conns.push(c);
    const reloadOverview = async () => {
      const t0 = performance.now();
      const t = Date.now();
      try {
        const res = await fetch(`${base}/api/campuses/overview?tz=${encodeURIComponent(tz)}`);
        await res.arrayBuffer();
        reloads.push({ t, ms: performance.now() - t0, status: res.status });
      } catch (e) {
        reloads.push({ t, ms: performance.now() - t0, status: 0, err: e.message });
      }
    };
    const refresh = () => {
      if (c.timer !== undefined || stopped) return;
      const wait = Math.max(0, c.lastLoad + CAMPUS_REFRESH_MS - Date.now());
      c.timer = setTimeout(() => {
        c.timer = undefined;
        c.lastLoad = Date.now();
        void reloadOverview();
      }, wait);
    };
    (async () => {
      try {
        const res = await fetch(`${base}/api/dashboard/stream`, { signal: ctl.signal, headers: { accept: 'text/event-stream' } });
        c.status = res.status;
        if (res.status !== 200) {
          streamErrors++;
          c.errors.push(`status ${res.status}`);
          await res.arrayBuffer();
          return;
        }
        c.opened = Date.now();
        if (campusTab) {
          c.lastLoad = Date.now();
          void reloadOverview();
        }
        const decoder = new TextDecoder();
        let buf = '';
        for await (const chunk of res.body) {
          const arrived = performance.now();
          buf += decoder.decode(chunk, { stream: true });
          let cut;
          while ((cut = buf.indexOf('\n\n')) !== -1) {
            const frame = buf.slice(0, cut);
            buf = buf.slice(cut + 2);
            const data = frame
              .split('\n')
              .filter((l) => l.startsWith('data: '))
              .map((l) => l.slice(6))
              .join('\n');
            if (!data) continue;
            const event = JSON.parse(data);
            c.received++;
            if (event.type === 'reading') {
              readingEvents++;
              const t0 = sent.get(event.device);
              if (t0 !== undefined) deliveries.push({ t: Date.now(), ms: arrived - t0 });
            } else if (event.type === 'incident') incidentEvents++;
            if (campusTab) refresh();
          }
        }
        if (!stopped) {
          streamErrors++;
          c.errors.push('stream ended');
        }
      } catch (e) {
        if (!stopped) {
          streamErrors++;
          c.errors.push(e.cause?.code ?? e.message);
        }
      }
    })();
  };

  for (let i = 0; i < streams; i++) open(i, false);
  for (let i = 0; i < campusTabs; i++) open(streams + i, true);

  return {
    onSend,
    get openCount() {
      return conns.filter((c) => c.status === 200).length;
    },
    async stop() {
      stopped = true;
      for (const c of conns) {
        clearTimeout(c.timer);
        c.ctl.abort();
      }
    },
    stats(fromT = 0, toT = Infinity, expectedPerStream) {
      const d = deliveries.filter((x) => x.t >= fromT && x.t <= toT);
      const rl = reloads.filter((x) => x.t >= fromT && x.t <= toT);
      const reloadStatuses = {};
      for (const r of rl) reloadStatuses[r.status] = (reloadStatuses[r.status] ?? 0) + 1;
      return {
        streamsOpen: conns.filter((c) => c.status === 200).length,
        streamStatuses: conns.reduce((m, c) => ((m[c.status] = (m[c.status] ?? 0) + 1), m), {}),
        streamErrors,
        errorSamples: conns.flatMap((c) => c.errors).slice(0, 5),
        deliveries: d.length,
        expectedDeliveries: expectedPerStream === undefined ? undefined : expectedPerStream * streams + expectedPerStream * campusTabs,
        fanoutMs: summarize(d.map((x) => x.ms)),
        readingEvents,
        incidentEvents,
        campusReloads: rl.length ? { count: rl.length, statuses: reloadStatuses, ms: summarize(rl.filter((r) => r.status === 200).map((r) => r.ms)) } : undefined,
      };
    },
  };
}
