// Counts the /api/ requests one open tab of each page makes, by path, over MINUTES. Temporary:
// copied from .scratch/prodtest/trust-proxy/tab-requests.mjs so it resolves frontend's playwright.
import { chromium } from 'playwright';
const WEB = process.env.WEB ?? 'http://127.0.0.1:8099';
const MINUTES = Number(process.env.MINUTES ?? 5);
const pages = { dashboard: '/', campuses: '/campuses', incidents: '/incidents', history: `/history/${process.env.DEVICE_ID ?? 10}` };
const browser = await chromium.launch();
const counts = {};
for (const [name, path] of Object.entries(pages)) {
  const context = await browser.newContext();
  const page = await context.newPage();
  counts[name] = { total: 0, byPath: {}, statuses: {} };
  page.on('response', (res) => {
    const url = new URL(res.url());
    if (!url.pathname.startsWith('/api/')) return;
    const c = counts[name];
    c.total += 1;
    const key = `${res.request().method()} ${url.pathname}`;
    c.byPath[key] = (c.byPath[key] ?? 0) + 1;
    c.statuses[res.status()] = (c.statuses[res.status()] ?? 0) + 1;
  });
  await page.goto(WEB + path);
}
await new Promise((r) => setTimeout(r, MINUTES * 60_000));
await browser.close();
for (const [name, c] of Object.entries(counts)) {
  console.log(JSON.stringify({ page: name, minutes: MINUTES, total: c.total, per15min: Math.round((c.total * 15) / MINUTES), byPath: c.byPath, statuses: c.statuses }));
}
