// CSP probe for the hardened stack: seeds a Campus, a Device and Readings, then visits every
// page in headless Chromium, counting CSP violations (securitypolicyviolation events and
// "Refused to ..." console lines) and console errors, and checks a live Reading arrives over
// the SSE stream through nginx. Removes what it seeded. WEB, ADMIN_TOKEN, DEVICE_TOKEN from env.
//   node .scratch/ct/csp-probe.mjs
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const { chromium } = require('playwright');

const WEB = process.env.WEB ?? 'http://localhost:8090';
const { ADMIN_TOKEN: ADMIN, DEVICE_TOKEN: DEVICE } = process.env;
if (!ADMIN || !DEVICE) { console.error('set ADMIN_TOKEN and DEVICE_TOKEN'); process.exit(2); }
const call = async (method, path, token, body) => {
  const r = await fetch(WEB + path, { method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: body && JSON.stringify(body) });
  return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) };
};

const campus = await call('POST', '/api/campuses', ADMIN, { name: 'CSP Probe High', shortcode: 'CSPP' });
const device = await call('POST', '/api/devices', ADMIN, { hostname: 'ESP_C5B0BE', campusId: campus.body.id, closet: 'MDF' });
for (const [t, h] of [[71, 40], [84, 38], [92, 18]]) await call('POST', '/api/readings', DEVICE, { device: 'ESP_C5B0BE', temp: t, humidity: h });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await context.addInitScript(() => {
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
});
const page = await context.newPage();
const csp = [], errors = [];
page.on('console', (m) => {
  const text = m.text();
  if (/Content Security Policy|Refused to/i.test(text)) csp.push(text);
  else if (m.type() === 'error' && !/404|Failed to load resource/.test(text)) errors.push(text);
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const pages = ['/', '/campuses', '/incidents', `/history/${device.body.id}`, '/settings', '/no-such-page'];
let failed = 0;
for (const p of pages) {
  await page.goto(WEB + p);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1200);
  const events = await page.evaluate(() => window.__csp);
  csp.push(...events.map((e) => `${p}: event ${e}`));
  console.log(`page ${p}: ${events.length} CSP events`);
}
// Settings with the Admin token, so the admin tables render too.
await page.goto(WEB + '/settings');
await page.getByLabel(/Admin token/i).first().fill(ADMIN).catch(() => {});
await page.keyboard.press('Enter');
await page.waitForTimeout(1500);
csp.push(...(await page.evaluate(() => window.__csp)).map((e) => `/settings (token): event ${e}`));

// A live Reading over SSE through nginx reaches the open dashboard without a reload.
await page.goto(WEB + '/');
await page.getByText('ESP_C5B0BE').first().waitFor({ timeout: 10000 }).catch(() => {});
await page.waitForTimeout(1500);
await call('POST', '/api/readings', DEVICE, { device: 'ESP_C5B0BE', temp: 77.7, humidity: 44 });
let live = false;
try { await page.getByText(/77\.7|78/).first().waitFor({ timeout: 10000 }); live = true; } catch {}
console.log(`dashboard live update over SSE: ${live ? 'ok' : 'FAIL'}`);
if (!live) failed++;
csp.push(...(await page.evaluate(() => window.__csp)).map((e) => `/ (live): event ${e}`));

// The page refuses to be framed.
const framed = await context.newPage();
await framed.setContent(`<iframe src="${WEB}/" id="f"></iframe>`);
await framed.waitForTimeout(1500);
const child = framed.frames().find((f) => f !== framed.mainFrame());
const rendered = child ? await child.locator('#root *').count().catch(() => 0) : 0;
const frameBlocked = rendered === 0;
if (!frameBlocked) failed++;
console.log(`framing blocked (frame-ancestors 'none'): ${frameBlocked ? 'ok' : 'FAIL'}`);

await browser.close();
await call('DELETE', `/api/devices/${device.body.id}`, ADMIN);
await call('DELETE', `/api/campuses/${campus.body.id}`, ADMIN);

console.log(`CSP violations: ${csp.length}`); csp.forEach((c) => console.log('  ' + c));
console.log(`console errors: ${errors.length}`); errors.forEach((e) => console.log('  ' + e));
process.exit(csp.length || errors.length || failed ? 1 : 0);
