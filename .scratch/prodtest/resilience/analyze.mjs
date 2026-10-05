// What a drill window looked like to the Devices, the dashboards, the Chromium page, and the data.
//   node analyze.mjs --out <run dir> --project ta-res --drill api-kill [--pad 60] [--nth -1]
// The window runs from the drill's `begin` mark to its `end` mark plus --pad seconds.
// `--global` instead checks the whole run: every 201 has its row, every row had a 201, and the
// incident tables agree with themselves and with what the dashboard says now.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, mysql } from '../load/lib.mjs';

const args = parseArgs();
const OUT = args.out;
const P = args.project ?? 'ta-res';
const jsonl = (f) => (existsSync(join(OUT, f)) ? readFileSync(join(OUT, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const posts = jsonl('posts.jsonl');
const streams = jsonl('streams.jsonl');
const chrome = jsonl('chrome.jsonl');
const iso = (t) => new Date(t).toISOString().slice(11, 23);

function windowOf(drill, nth = -1, padS = 60) {
  const marks = readFileSync(join(OUT, 'drills.log'), 'utf8').split('\n').filter(Boolean).map((l) => {
    const [at, t, d, ...rest] = l.split(' ');
    return { at, t: Number(t), drill: d, text: rest.join(' ') };
  });
  const begins = marks.filter((m) => m.drill === drill && m.text === 'begin');
  const begin = begins.at(nth);
  const end = marks.find((m) => m.drill === drill && m.text === 'end' && m.t > begin.t);
  return { from: begin.t, to: (end?.t ?? Date.now()) + padS * 1000, marks: marks.filter((m) => m.t >= begin.t && m.t <= (end?.t ?? Infinity)) };
}

function devicesView(from, to) {
  const inWin = posts.filter((p) => p.t >= from && p.t <= to);
  const statuses = {};
  for (const p of inWin) {
    const k = p.err ? `error:${p.err}` : String(p.status);
    statuses[k] = (statuses[k] ?? 0) + 1;
  }
  const failed = inWin.filter((p) => p.status !== 201);
  const firstFail = failed[0]?.t;
  const lastFail = failed.at(-1)?.t;
  const firstOkAfter = lastFail === undefined ? undefined : inWin.find((p) => p.t > lastFail && p.status === 201)?.t;
  const slow = inWin.filter((p) => p.status === 201 && p.ms > 2000);
  return {
    posts: inWin.length,
    statuses,
    lost: failed.length,
    devicesThatLostOne: new Set(failed.map((p) => p.host)).size,
    failingFrom: firstFail && iso(firstFail),
    failingTo: lastFail && iso(lastFail),
    deviceOutageS: firstFail && Math.round((lastFail - firstFail) / 100) / 10,
    firstOkAfterS: firstOkAfter && firstFail && Math.round((firstOkAfter - firstFail) / 100) / 10,
    ingestMsMaxOk: Math.max(0, ...inWin.filter((p) => p.status === 201).map((p) => p.ms)),
    slowOk: slow.length,
    failMs: failed.length ? { min: Math.min(...failed.map((p) => p.ms)), max: Math.max(...failed.map((p) => p.ms)) } : undefined,
  };
}

function streamsView(from, to) {
  const inWin = streams.filter((s) => s.t >= from && s.t <= to);
  const byClient = {};
  for (const s of inWin) {
    const c = (byClient[s.client] ??= { drops: [], opens: [], statuses: [], catchups: [], incidents: 0 });
    if (s.ev === 'drop') c.drops.push({ t: iso(s.t), why: s.why });
    if (s.ev === 'open') c.opens.push({ t: iso(s.t), reconnect: s.reconnect });
    if (s.ev === 'status') c.statuses.push({ t: iso(s.t), status: s.status });
    if (s.ev === 'catchup') c.catchups.push({ t: iso(s.t), status: s.status, stale: s.stale, err: s.err });
    if (s.ev === 'incident') c.incidents++;
  }
  // Seconds from each client's first drop to its last reopen in the window.
  const gaps = Object.values(byClient).map((c) => {
    const d = inWin.find((s) => s.ev === 'drop' || s.ev === 'status');
    return c;
  });
  const reopenS = Object.entries(byClient).map(([client, c]) => {
    const first = inWin.find((s) => String(s.client) === client && (s.ev === 'drop' || s.ev === 'status'));
    const reopen = inWin.filter((s) => String(s.client) === client && s.ev === 'open' && s.reconnect).at(-1);
    return first && reopen ? Math.round((reopen.t - first.t) / 100) / 10 : null;
  });
  return { clients: Object.keys(byClient).length, reopenAfterS: reopenS, detail: byClient[0] ?? null, gaps: gaps.length };
}

function hostMap() {
  return new Map(
    mysql(P, 'SELECT id, hostname FROM devices;')
      .trim()
      .split('\n')
      .map((l) => l.split('\t'))
      .map(([id, h]) => [id, h]),
  );
}

function chromeView(from, to, hosts) {
  const samples = chrome.filter((c) => c.t >= from && c.t <= to && c.cards !== undefined);
  const fetches = chrome.filter((c) => c.t >= from && c.t <= to && c.fetch).map((c) => ({ t: iso(c.t), fetch: c.fetch, status: c.status }));
  const transitions = [];
  let last;
  for (const s of samples) {
    if (s.status !== last) transitions.push({ t: iso(s.t), status: s.status });
    last = s.status;
  }
  // Behind: cards showing an older Reading than the latest 201 the Device got 3 s before the sample.
  const behindAt = (s) => {
    let behind = 0;
    for (const [id, shown] of Object.entries(s.cards ?? {})) {
      const host = hosts.get(id);
      const want = posts.filter((p) => p.host === host && p.status === 201 && p.t + p.ms <= s.t - 3000).at(-1)?.rec;
      if (want !== undefined && (shown === null || shown < want)) behind++;
    }
    return behind;
  };
  const tail = samples.filter((_, i) => i % 5 === 0).map((s) => ({ t: iso(s.t), status: s.status, behind: behindAt(s) }));
  const loads = samples.length ? samples.at(-1).loads - samples[0].loads : 0;
  return { reloads: loads, transitions, dashboardFetches: fetches, behindEvery5s: tail.map((x) => `${x.t} ${x.status} behind=${x.behind}`) };
}

function dataChecks() {
  const ok = posts.filter((p) => p.status === 201);
  const okSet = new Set(ok.map((p) => `${p.host}|${p.rec}`));
  const rows = mysql(P, "SELECT d.hostname, DATE_FORMAT(r.recorded_at, '%Y-%m-%dT%H:%i:%s.000Z') FROM readings r JOIN devices d ON d.id = r.device_id;")
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => l.replace('\t', '|'));
  const rowCounts = new Map();
  for (const r of rows) rowCounts.set(r, (rowCounts.get(r) ?? 0) + 1);
  const firstPost = posts[0]?.t ?? 0;
  // Rows the Device never heard a 201 for: written, then the reply was lost (or still in flight).
  const phantom = rows.filter((r) => !okSet.has(r));
  // 201s with no row: acknowledged and then lost.
  const missing = [...okSet].filter((k) => !rowCounts.has(k));
  const q = (sql) => mysql(P, sql).trim();
  return {
    posts201: ok.length,
    rows: rows.length,
    acknowledgedButMissing: missing.length,
    writtenButNotAcknowledged: phantom.length,
    phantomSample: phantom.slice(0, 5),
    incidents: {
      total: q('SELECT COUNT(*) FROM incidents;'),
      open: q('SELECT COUNT(*) FROM incidents WHERE ended_at IS NULL;'),
      openByCondition: q("SELECT GROUP_CONCAT(CONCAT(condition_name, '=', n)) FROM (SELECT condition_name, COUNT(*) n FROM incidents WHERE ended_at IS NULL GROUP BY condition_name) x;"),
      duplicateOpen: q('SELECT COUNT(*) FROM (SELECT device_id, condition_name FROM incidents WHERE ended_at IS NULL GROUP BY device_id, condition_name HAVING COUNT(*) > 1) x;'),
      openWithNoOpenSegment: q('SELECT COUNT(*) FROM incidents i WHERE i.ended_at IS NULL AND NOT EXISTS (SELECT 1 FROM incident_segments s WHERE s.incident_id = i.id AND s.ended_at IS NULL);'),
      closedWithOpenSegment: q('SELECT COUNT(*) FROM incidents i WHERE i.ended_at IS NOT NULL AND EXISTS (SELECT 1 FROM incident_segments s WHERE s.incident_id = i.id AND s.ended_at IS NULL);'),
      moreThanOneOpenSegment: q('SELECT COUNT(*) FROM (SELECT incident_id FROM incident_segments WHERE ended_at IS NULL GROUP BY incident_id HAVING COUNT(*) > 1) x;'),
      overlappingSameCondition: q('SELECT COUNT(*) FROM incidents a JOIN incidents b ON a.device_id = b.device_id AND a.condition_name = b.condition_name AND a.id < b.id AND b.started_at < COALESCE(a.ended_at, NOW()) AND a.started_at < COALESCE(b.ended_at, NOW());'),
      offlineIncidents: q("SELECT COUNT(*) FROM incidents WHERE condition_name = 'Offline';"),
    },
  };
}

async function dashboardAgreement() {
  // Every Condition at warning or worse on the dashboard has an open incident, and every open
  // incident's Condition is on the dashboard: no lost close, no lost open.
  const env = Object.fromEntries(readFileSync(args.env, 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => l.split(/=(.*)/s).slice(0, 2)));
  const base = `http://127.0.0.1:${env.WEB_PORT}`;
  const dash = await (await fetch(`${base}/api/dashboard`)).json();
  const open = mysql(P, 'SELECT d.hostname, i.condition_name FROM incidents i JOIN devices d ON d.id = i.device_id WHERE i.ended_at IS NULL;')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => l.replace('\t', '|'));
  const openSet = new Set(open);
  const shown = new Set(dash.devices.flatMap((d) => d.conditions.filter((c) => c.level === 'warning' || c.level === 'critical').map((c) => `${d.hostname}|${c.name}`)));
  return { openIncidents: open.length, dashboardConditions: shown.size, shownWithoutIncident: [...shown].filter((k) => !openSet.has(k)), openNotShown: open.filter((k) => !shown.has(k)) };
}

if (args.global) {
  console.log(JSON.stringify({ data: dataChecks(), agreement: await dashboardAgreement() }, null, 2));
} else {
  const w = windowOf(args.drill, Number(args.nth ?? -1), Number(args.pad ?? 60));
  const hosts = hostMap();
  console.log(JSON.stringify({ drill: args.drill, from: new Date(w.from).toISOString(), to: new Date(w.to).toISOString(), marks: w.marks.map((m) => `${m.at.slice(11)} ${m.text}`), devices: devicesView(w.from, w.to), streams: streamsView(w.from, w.to), chrome: chromeView(w.from, w.to, hosts) }, null, 2));
}
