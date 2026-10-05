// One real Chromium on the Dashboard, never reloaded: once a second it records the LiveStatus
// label and every card's latest Reading time, so a drill shows whether the page notices a drop,
// reconnects by itself, and catches up without a reload.
//
//   node chrome.mjs --base http://127.0.0.1:8096 --out <dir>   (stops when <dir>/STOP exists)
import { createRequire } from 'node:module';
import { appendFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, HERE, sleep } from '../load/lib.mjs';

const args = parseArgs();
const OUT = args.out;
const FILE = join(OUT, 'chrome.jsonl');
const require = createRequire(resolve(HERE, '..', '..', '..', 'frontend', 'package.json'));
const { chromium } = require('playwright');

const browser = await chromium.launch();
const page = await browser.newPage();
let loads = 0;
page.on('load', () => loads++);
page.on('console', (m) => appendFileSync(FILE, JSON.stringify({ t: Date.now(), console: m.type(), text: m.text().slice(0, 300) }) + '\n'));
page.on('response', (r) => {
  if (r.url().includes('/api/dashboard') && !r.url().includes('stream')) appendFileSync(FILE, JSON.stringify({ t: Date.now(), fetch: r.url().replace(args.base, ''), status: r.status() }) + '\n');
});
await page.goto(args.base + '/', { waitUntil: 'networkidle' }).catch(() => {});
while (!existsSync(join(OUT, 'STOP'))) {
  try {
    const s = await page.evaluate(() => ({
      status: [...document.querySelectorAll('[role=status]')].map((e) => e.textContent.trim()).find((x) => /^(Live|Reconnecting|Connecting)/.test(x)) ?? null,
      cards: Object.fromEntries([...document.querySelectorAll('[data-device-card]')].map((c) => [c.getAttribute('data-device-card'), c.querySelector('time')?.getAttribute('datetime') ?? null])),
    }));
    appendFileSync(FILE, JSON.stringify({ t: Date.now(), loads, status: s.status, cards: s.cards }) + '\n');
  } catch (e) {
    appendFileSync(FILE, JSON.stringify({ t: Date.now(), err: e.message.slice(0, 200) }) + '\n');
  }
  await sleep(1000);
}
await browser.close();
