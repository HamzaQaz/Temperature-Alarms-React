#!/usr/bin/env node
/**
 * A virtual Device: posts Readings to the backend the way the firmware does, one every
 * Report interval, with the Device token. For testing the dashboard without a board.
 *
 *   node scripts/mock-device.mjs --hostname ESP_000001 --token dev-device
 *
 * Inside the Compose stack the backend's own environment supplies the token and port, so
 * `docker compose exec api node scripts/mock-device.mjs --hostname ESP_000001` is enough.
 *
 * Options (all optional):
 *   --url       backend origin, default http://localhost:$PORT (3001 when PORT is unset)
 *   --hostname  ESP_ plus six hex digits, default ESP_000001
 *   --token     the backend's DEVICE_TOKEN, default $DEVICE_TOKEN, then dev-device
 *   --interval  seconds between Readings, default 30 (match REPORT_INTERVAL_SECONDS)
 *   --temp      starting temperature in °F, default 72; drifts a little each Reading
 *   --humidity  starting humidity in %, default 40
 *   --count     stop after this many Readings, default unlimited (Ctrl-C to stop)
 *   --nan       skip every Nth sample, as a board with a flaky sensor would
 *
 * Prints one line per attempt in the firmware's log style, so `report: 404` and
 * `report: 401` mean the same thing they mean on the serial monitor.
 */
const args = Object.fromEntries(
  process.argv.slice(2).map((arg, i, all) => (arg.startsWith('--') ? [arg.slice(2), all[i + 1] ?? 'true'] : [])).filter((p) => p.length),
);
const url = (args.url ?? `http://localhost:${process.env.PORT ?? 3001}`).replace(/\/$/, '');
const hostname = args.hostname ?? 'ESP_000001';
const token = args.token ?? process.env.DEVICE_TOKEN ?? 'dev-device';
const intervalMs = Number(args.interval ?? 30) * 1000;
const count = args.count === undefined ? Infinity : Number(args.count);
const nanEvery = args.nan === undefined ? 0 : Number(args.nan);
let temp = Number(args.temp ?? 72);
let humidity = Number(args.humidity ?? 40);

console.log(`device: ${hostname}`);
console.log(`report: every ${intervalMs / 1000} s to ${url}/api/readings`);

let sent = 0;
let attempt = 0;
const tick = async () => {
  attempt += 1;
  if (nanEvery > 0 && attempt % nanEvery === 0) {
    console.log('sensor: read failed (NaN), sample skipped');
    return;
  }
  // A closet drifts by fractions of a degree; the DHT11 reports whole numbers.
  temp += (Math.random() - 0.5) * 0.8;
  humidity += (Math.random() - 0.5) * 1.5;
  const sample = { device: hostname, temp: Math.round(temp), humidity: Math.round(humidity) };
  console.log(`sensor: ${sample.temp} F, ${sample.humidity} %`);
  try {
    const response = await fetch(`${url}/api/readings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(sample),
    });
    const body = await response.text();
    console.log(`report: ${response.status}${response.status === 201 ? ' created' : ` ${body}`}`);
    if (response.ok) sent += 1;
  } catch (error) {
    console.log(`report: connection failed (${error.cause?.code ?? error.message})`);
  }
  if (sent >= count) {
    console.log(`report: sent ${sent}, stopping`);
    clearInterval(timer);
  }
};

const timer = setInterval(tick, intervalMs);
void tick();
