// Shared helpers for the load scripts: options, env file, percentiles, docker access.
// Node 20+ only; no dependencies beyond Node's own fetch (undici).
import { readFileSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const RUNS = resolve(HERE, '..', 'runs');
mkdirSync(RUNS, { recursive: true });

/** `--name value` and `--flag` into an object; numbers stay strings until the caller converts. */
export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

/** KEY=value lines, as compose's --env-file reads them. */
export function readEnvFile(path) {
  const env = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

export function defaults(args) {
  const envPath = args.env ?? process.env.TA_LOAD_ENV;
  if (!envPath) throw new Error('--env <path to the scratch env file> (or TA_LOAD_ENV) is required');
  const env = readEnvFile(envPath);
  return {
    base: args.base ?? `http://127.0.0.1:${env.WEB_PORT ?? 8095}`,
    project: args.project ?? env.COMPOSE_PROJECT_NAME ?? 'ta-load',
    adminToken: env.ADMIN_TOKEN,
    deviceToken: env.DEVICE_TOKEN,
    env,
    envPath,
  };
}

/** Percentiles over a list of numbers (nearest rank). */
export function summarize(values) {
  if (values.length === 0) return { n: 0 };
  const s = [...values].sort((a, b) => a - b);
  const pick = (p) => s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
  const sum = s.reduce((a, b) => a + b, 0);
  const r = (x) => Math.round(x * 10) / 10;
  return { n: s.length, min: r(s[0]), p50: r(pick(50)), p95: r(pick(95)), p99: r(pick(99)), max: r(s[s.length - 1]), mean: r(sum / s.length) };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

export function log(file, line) {
  const text = `${new Date().toISOString()} ${line}`;
  console.log(text);
  if (file) appendFileSync(file, text + '\n');
}

export function writeJson(name, data) {
  const path = join(RUNS, name);
  writeFileSync(path, JSON.stringify(data, null, 2));
  return path;
}

/** Run SQL in the stack's db container as root; returns stdout (tab-separated, no headers). */
export function mysql(project, sql, { headers = false, timeoutMs = 0 } = {}) {
  const flags = headers ? '-B' : '-N -B';
  return execFileSync('docker', ['exec', '-i', `${project}-db-1`, 'sh', '-c', `MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot ${flags} temperature_alarms`], {
    input: sql,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: timeoutMs || undefined,
  });
}

/** Async version, for long statements that must not block the event loop (the simulators keep running). */
export function mysqlAsync(project, sql) {
  return new Promise((resolveP, reject) => {
    const child = spawn('docker', ['exec', '-i', `${project}-db-1`, 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -N -B temperature_alarms']);
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => (code === 0 ? resolveP(out) : reject(new Error(`mysql exit ${code}: ${err}`))));
    child.stdin.end(sql);
  });
}

/** Run a node snippet inside the api container (the built dist/ is its cwd's). */
export function apiNode(project, code) {
  return new Promise((resolveP, reject) => {
    const child = spawn('docker', ['exec', '-i', `${project}-api-1`, 'node', '-']);
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => (code === 0 ? resolveP(out) : reject(new Error(`node exit ${code}: ${err}\n${out}`))));
    child.stdin.end(code);
  });
}

/**
 * Samples `docker stats` for the project's containers every `everyMs`. Each sample:
 * { t, name, cpu (percent of one core), memMiB }.
 */
export function startDockerStats(project, everyMs = 10_000) {
  const samples = [];
  let stopped = false;
  const toMiB = (s) => {
    const m = /([\d.]+)\s*([KMG]i?B|B)/.exec(s);
    if (!m) return NaN;
    const n = Number(m[1]);
    return { B: n / 1048576, KiB: n / 1024, KB: n / 1024, MiB: n, MB: n, GiB: n * 1024, GB: n * 1024 }[m[2]] ?? NaN;
  };
  const once = () =>
    new Promise((resolveP) => {
      const child = spawn('docker', ['stats', '--no-stream', '--format', '{{json .}}']);
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.on('close', () => {
        const t = Date.now();
        for (const line of out.split('\n')) {
          if (!line.trim()) continue;
          try {
            const j = JSON.parse(line);
            if (!j.Name.startsWith(`${project}-`)) continue;
            samples.push({ t, name: j.Name, cpu: parseFloat(j.CPUPerc), memMiB: Math.round(toMiB(j.MemUsage.split('/')[0]) * 10) / 10 });
          } catch {}
        }
        resolveP();
      });
    });
  const loop = (async () => {
    while (!stopped) {
      const started = Date.now();
      await once();
      await sleep(Math.max(0, everyMs - (Date.now() - started)));
    }
  })();
  return {
    samples,
    async stop() {
      stopped = true;
      await loop;
    },
    /** Per container: cpu and memory p50/p95/max over the samples since `fromT`. */
    summary(fromT = 0, toT = Infinity) {
      const by = {};
      for (const s of samples) {
        if (s.t < fromT || s.t > toT) continue;
        (by[s.name] ??= { cpu: [], mem: [] });
        by[s.name].cpu.push(s.cpu);
        by[s.name].mem.push(s.memMiB);
      }
      const out = {};
      for (const [name, { cpu, mem }] of Object.entries(by)) {
        const c = summarize(cpu);
        const m = summarize(mem);
        out[name] = { samples: c.n, cpuP50: c.p50, cpuP95: c.p95, cpuMax: c.max, memMiBP50: m.p50, memMiBMax: m.max };
      }
      return out;
    },
  };
}
