// Device simulator: registers N Devices through the admin API (or straight into MySQL past the
// admin budget) and posts a Reading from each every 30 s with jitter, as the firmware does.
// Values drift; about 5% of Devices are in an excursion (Hot, Hot critical, Cold, Dry) at a time.
//
//   node devices.mjs --env <scratch env> --devices 100 --minutes 5
import { parseArgs, defaults, summarize, sleep, mysql } from './lib.mjs';

export const CAMPUS_COUNT = 10;
export const hostnameOf = (i) => `ESP_${(0xa00000 + i).toString(16).toUpperCase()}`;
const shortcodeOf = (c) => `LD${String(c + 1).padStart(2, '0')}`;

async function api(base, token, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/**
 * Make sure Campuses LD01..LD10 and Devices 0..n-1 exist. `via: 'api'` posts each through the
 * admin API (counts against the per-address limit of 500 per 15 min); `via: 'sql'` inserts the
 * missing ones in one statement. Returns { campuses, devices: [{id, hostname}], requests, statuses }.
 */
export async function registerDevices({ base, adminToken, project }, n, { via = 'api' } = {}) {
  const statuses = {};
  let requests = 0;
  const count = (s) => {
    requests++;
    statuses[s] = (statuses[s] ?? 0) + 1;
  };
  const campusesRes = await api(base, adminToken, 'GET', '/api/campuses');
  count(campusesRes.status);
  const campuses = new Map(campusesRes.body.map((c) => [c.shortcode, c.id]));
  for (let c = 0; c < CAMPUS_COUNT; c++) {
    if (campuses.has(shortcodeOf(c))) continue;
    const r = await api(base, adminToken, 'POST', '/api/campuses', { name: `Load Campus ${c + 1}`, shortcode: shortcodeOf(c) });
    count(r.status);
    if (r.status !== 201) throw new Error(`campus ${shortcodeOf(c)}: ${r.status} ${JSON.stringify(r.body)}`);
    campuses.set(shortcodeOf(c), r.body.id);
  }
  const devicesRes = await api(base, adminToken, 'GET', '/api/devices');
  count(devicesRes.status);
  const have = new Set(devicesRes.body.map((d) => d.hostname));
  const missing = [];
  for (let i = 0; i < n; i++) if (!have.has(hostnameOf(i))) missing.push(i);
  const campusFor = (i) => campuses.get(shortcodeOf(i % CAMPUS_COUNT));
  const closetFor = (i) => (i % 7 === 0 ? `MDF ${Math.floor(i / CAMPUS_COUNT) + 1}` : `IDF ${Math.floor(i / CAMPUS_COUNT) + 1}`);
  if (via === 'api') {
    for (const i of missing) {
      const r = await api(base, adminToken, 'POST', '/api/devices', { hostname: hostnameOf(i), campusId: campusFor(i), closet: closetFor(i) });
      count(r.status);
      if (r.status !== 201) throw new Error(`device ${hostnameOf(i)}: ${r.status} ${JSON.stringify(r.body)}`);
    }
  } else if (missing.length > 0) {
    const values = missing.map((i) => `('${hostnameOf(i)}', ${campusFor(i)}, '${closetFor(i)}')`).join(',\n');
    mysql(project, `INSERT INTO devices (hostname, campus_id, closet) VALUES ${values};`);
  }
  const ids = mysql(project, `SELECT id, hostname FROM devices WHERE hostname LIKE 'ESP_A%' ORDER BY hostname;`)
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [id, hostname] = l.split('\t');
      return { id: Number(id), hostname };
    });
  return { campuses: Object.fromEntries(campuses), devices: ids.slice(0, n), registered: missing.length, requests, statuses };
}

/** One board's values: a slow random walk around its own baseline, with occasional excursions. */
function makeBoard(i, rng) {
  const baseTemp = 66 + rng() * 10;
  const baseHum = 30 + rng() * 20;
  return {
    i,
    hostname: hostnameOf(i),
    temp: baseTemp,
    hum: baseHum,
    baseTemp,
    baseHum,
    // Start in the steady state: 5% of boards already part-way through an excursion.
    excursion: rng() < 0.05 ? { kind: Object.keys(EXCURSIONS)[Math.floor(rng() * 4)], left: 1 + Math.floor(rng() * EXCURSION_LEN) } : null,
  };
}

// An excursion lasts ~20 Readings (10 minutes); starting one with p = 0.0026 per Reading keeps
// p*L / (1 + p*L) = 5% of boards in one at a time.
const EXCURSION_P = 0.0026;
const EXCURSION_LEN = 20;
const EXCURSIONS = {
  hot: { temp: 85, hum: null },
  hotCritical: { temp: 92, hum: null },
  cold: { temp: 46, hum: null },
  dry: { temp: null, hum: 16 },
};

function nextValues(b, rng) {
  if (b.excursion === null && rng() < EXCURSION_P) {
    const kinds = Object.keys(EXCURSIONS);
    b.excursion = { kind: kinds[Math.floor(rng() * kinds.length)], left: EXCURSION_LEN };
  }
  const target = b.excursion ? EXCURSIONS[b.excursion.kind] : { temp: null, hum: null };
  const tt = target.temp ?? b.baseTemp;
  const th = target.hum ?? b.baseHum;
  // Move a third of the way toward the target each Reading, plus noise.
  b.temp += (tt - b.temp) / 3 + (rng() - 0.5) * 1.2;
  b.hum += (th - b.hum) / 3 + (rng() - 0.5) * 2;
  b.hum = Math.max(5, Math.min(95, b.hum));
  if (b.excursion && --b.excursion.left <= 0) b.excursion = null;
  return { temp: Math.round(b.temp), humidity: Math.round(b.hum) };
}

/** Deterministic PRNG so runs are repeatable. */
export function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Start posting. `active` can be raised later (setActive) to ramp the fleet. `onSend(hostname, t)`
 * is told the instant each POST leaves, so the stream side can time delivery.
 * Returns { setActive, stop, stats(fromT) }.
 */
export function startDevices({ base, deviceToken }, { active, intervalMs = 30_000, jitterMs = 2_000, onSend = () => {}, seed = 42 }) {
  const rng = mulberry32(seed);
  const boards = [];
  const timers = new Map();
  const results = []; // { t, ms, status, conditions: bool }
  let running = true;
  let inExcursion = 0;

  const post = async (b) => {
    const { temp, humidity } = nextValues(b, rng);
    const t0 = performance.now();
    const t = Date.now();
    onSend(b.hostname, t0);
    let status = 0;
    let err;
    try {
      const res = await fetch(`${base}/api/readings`, {
        method: 'POST',
        headers: { authorization: `Bearer ${deviceToken}`, 'content-type': 'application/json' },
        // The firmware sends its hostname with a hyphen; the server normalises it.
        body: JSON.stringify({ device: b.hostname.replace('_', '-'), temp, humidity }),
      });
      status = res.status;
      await res.arrayBuffer();
    } catch (e) {
      err = e.cause?.code ?? e.message;
    }
    results.push({ t, ms: performance.now() - t0, status, err });
  };

  const schedule = (b, first) => {
    if (!running || b.i >= currentActive) return;
    const delay = first ? rng() * intervalMs : intervalMs + (rng() * 2 - 1) * jitterMs;
    timers.set(b.i, setTimeout(async () => {
      timers.delete(b.i);
      if (!running || b.i >= currentActive) return;
      schedule(b, false);
      await post(b);
    }, delay));
  };

  let currentActive = 0;
  const setActive = (n) => {
    const from = currentActive;
    currentActive = n;
    for (let i = from; i < n; i++) {
      boards[i] ??= makeBoard(i, rng);
      schedule(boards[i], true);
    }
  };
  setActive(active);

  const excursionTimer = setInterval(() => {
    inExcursion = boards.slice(0, currentActive).filter((b) => b.excursion).length;
    excursionSamples.push(inExcursion / Math.max(1, currentActive));
  }, 30_000);
  const excursionSamples = [];

  return {
    setActive,
    get active() {
      return currentActive;
    },
    results,
    async stop() {
      running = false;
      clearInterval(excursionTimer);
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      await sleep(2000);
    },
    stats(fromT = 0, toT = Infinity) {
      const rs = results.filter((r) => r.t >= fromT && r.t <= toT);
      const statuses = {};
      for (const r of rs) {
        const k = r.err ? `error:${r.err}` : String(r.status);
        statuses[k] = (statuses[k] ?? 0) + 1;
      }
      const ok = rs.filter((r) => r.status === 201);
      const excursion = summarize(excursionSamples.map((x) => x * 100));
      return {
        posts: rs.length,
        statuses,
        errors: rs.filter((r) => r.status !== 201).length,
        rate429: statuses['429'] ?? 0,
        ingestMs: summarize(ok.map((r) => r.ms)),
        excursionPercent: { mean: excursion.mean, max: excursion.max },
      };
    },
  };
}

// CLI: register and post for a few minutes, print the stats.
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/$1:')}` || process.argv[1]?.endsWith('devices.mjs')) {
  const args = parseArgs();
  const cfg = defaults(args);
  const n = Number(args.devices ?? 100);
  const reg = await registerDevices(cfg, n, { via: args.via ?? 'api' });
  console.log(`registered ${reg.registered} (requests ${reg.requests}, ${JSON.stringify(reg.statuses)})`);
  const sim = startDevices(cfg, { active: n });
  await sleep(Number(args.minutes ?? 1) * 60_000);
  await sim.stop();
  console.log(JSON.stringify(sim.stats(), null, 2));
}
