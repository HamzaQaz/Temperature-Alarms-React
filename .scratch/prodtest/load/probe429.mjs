// Posts one Reading per load Device and lists the ones the per-Device limiter refuses, with its headers.
import { parseArgs, defaults } from './lib.mjs';
import { hostnameOf } from './devices.mjs';
const args = parseArgs(); const cfg = defaults(args);
const n = Number(args.devices ?? 300); const out = [];
await Promise.all(Array.from({ length: n }, async (_, i) => {
  const res = await fetch(`${cfg.base}/api/readings`, { method: 'POST', headers: { authorization: `Bearer ${cfg.deviceToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ device: hostnameOf(i).replace('_', '-'), temp: 70, humidity: 40 }) });
  const body = await res.text();
  if (res.status !== 201) out.push({ i, host: hostnameOf(i), status: res.status, remaining: res.headers.get('ratelimit-remaining'), reset: res.headers.get('ratelimit-reset'), body });
}));
console.log(JSON.stringify(out, null, 1));
