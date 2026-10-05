// Screenshots of the demo at desktop and phone width, from the host.
// Run from frontend/ (where playwright is installed): node ../.scratch/ct/shots.mjs http://localhost:8091
import { createRequire } from 'node:module';
const { chromium } = createRequire(process.cwd() + '/')('playwright');
const base = process.argv[2] ?? 'http://localhost:8091';
const out = new URL('./shots/', import.meta.url);
const pages = [['dashboard', '/'], ['campuses', '/campuses'], ['incidents', '/incidents'], ['history', '/history/1'], ['settings', '/settings']];
const browser = await chromium.launch();
let bad = 0;
for (const width of [1440, 390]) {
  const ctx = await browser.newContext({ viewport: { width, height: width > 500 ? 900 : 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  for (const [name, path] of pages) {
    const res = await page.goto(base + path, { waitUntil: 'networkidle' }).catch(() => null);
    await page.waitForTimeout(1500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const h1 = (await page.locator('h1').first().textContent().catch(() => ''))?.trim();
    await page.screenshot({ path: new URL(`${name}-${width}.png`, out).pathname.replace(/^\/([A-Z]:)/, '$1'), fullPage: true });
    const ok = res?.ok() && overflow <= 0 && errors.length === 0;
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${width} ${path} status=${res?.status()} h1="${h1}" overflowX=${overflow} errors=${errors.splice(0).join(' | ')}`);
  }
  await ctx.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
