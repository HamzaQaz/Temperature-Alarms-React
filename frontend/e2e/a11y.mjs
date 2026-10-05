// axe-core over every page and state, in Chromium, Firefox and WebKit. One line per page, state and browser.
// Point WEB at a stack with Campuses and Devices in it (the demo is ideal); it opens dialogs and forms but
// never confirms a change. ADMIN_TOKEN unlocks the Settings states that need it.
//
//   WEB=http://localhost:8097 ADMIN_TOKEN=... node e2e/a11y.mjs [out.json]
//
// axe comes from AXE_PATH (a local axe.min.js), else the axe-core package if installed, else cdnjs.
// BROWSERS narrows the run (comma-separated). Exits 1 on any serious or critical violation.
// The API allows 500 reads per address per 15 minutes, and a full run makes about that many. Against a
// local stack whose proxy passes X-Forwarded-For through (vite preview), SPREAD_ADDRESSES=1 gives each
// page its own made-up address so the run measures the pages and not the rate limit.
import { chromium, firefox, webkit } from 'playwright';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const WEB = process.env.WEB ?? 'http://localhost:8080';
const ADMIN = process.env.ADMIN_TOKEN;
const OUT = process.argv[2];
const ENGINES = { chromium, firefox, webkit };
const BROWSERS = (process.env.BROWSERS ?? 'chromium,firefox,webkit').split(',');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

function axeSource() {
  if (process.env.AXE_PATH) return { path: process.env.AXE_PATH };
  try {
    return { path: createRequire(import.meta.url).resolve('axe-core/axe.min.js') };
  } catch {
    return { url: 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js' };
  }
}
const AXE = axeSource();

const settle = (page, ms = 1500) => page.waitForTimeout(ms);
const withToken = async (page) => {
  await page.evaluate((t) => localStorage.setItem('temperature-alarms.admin-token', t), ADMIN);
};
async function firstDeviceId() {
  const devices = await (await fetch(WEB + '/api/devices')).json();
  return devices[0]?.id;
}

/** Each state: a name and how to reach it from a fresh page. `theme` runs it in the light theme too. */
const STATES = [
  { name: 'dashboard, worst first', go: (p) => p.goto(WEB + '/'), theme: true },
  { name: 'dashboard, by Campus', go: (p) => p.goto(WEB + '/?order=campus') },
  {
    name: 'dashboard, one Campus',
    go: async (p) => {
      await p.goto(WEB + '/');
      await p.getByRole('tablist').first().getByRole('tab').nth(1).click();
    },
  },
  { name: 'campuses', go: (p) => p.goto(WEB + '/campuses'), theme: true },
  { name: 'incidents, overnight', go: (p) => p.goto(WEB + '/incidents?window=overnight'), theme: true },
  { name: 'incidents, today', go: (p) => p.goto(WEB + '/incidents?window=today') },
  { name: 'incidents, 7 days', go: (p) => p.goto(WEB + '/incidents?window=week') },
  { name: 'history', go: async (p) => p.goto(WEB + '/history/' + (await firstDeviceId())), theme: true },
  {
    name: 'history, reset dialog',
    go: async (p) => {
      await p.goto(WEB + '/');
      await withToken(p);
      await p.goto(WEB + '/history/' + (await firstDeviceId()));
      await p.getByRole('button', { name: 'Reset history' }).click();
      await p.getByRole('alertdialog').waitFor();
    },
  },
  { name: 'history, no such Device', go: (p) => p.goto(WEB + '/history/999999') },
  { name: 'settings, token prompt', go: (p) => p.goto(WEB + '/settings'), theme: true },
  {
    name: 'settings, Campuses',
    go: async (p) => {
      await p.goto(WEB + '/');
      await withToken(p);
      await p.goto(WEB + '/settings');
    },
  },
  {
    name: 'settings, add Campus form',
    go: async (p) => {
      await p.goto(WEB + '/');
      await withToken(p);
      await p.goto(WEB + '/settings');
      await p.getByRole('button', { name: 'Add campus' }).click();
      await p.getByRole('form', { name: 'Add a campus' }).waitFor();
    },
  },
  {
    name: 'settings, delete Campus dialog',
    go: async (p) => {
      await p.goto(WEB + '/');
      await withToken(p);
      await p.goto(WEB + '/settings');
      await p.getByRole('button', { name: /^Delete / }).first().click();
      await p.getByRole('alertdialog').waitFor();
    },
  },
  {
    name: 'settings, Devices',
    go: async (p) => {
      await p.goto(WEB + '/');
      await withToken(p);
      await p.goto(WEB + '/settings?tab=devices');
    },
    theme: true,
  },
  {
    name: 'settings, add Device form with the Campus list open',
    go: async (p) => {
      await p.goto(WEB + '/');
      await withToken(p);
      await p.goto(WEB + '/settings?tab=devices');
      await p.getByRole('button', { name: 'Add device' }).click();
      await p.locator('#device-campus').click();
      await p.getByRole('listbox').waitFor();
    },
  },
  {
    name: 'settings, edit Device form',
    go: async (p) => {
      await p.goto(WEB + '/');
      await withToken(p);
      await p.goto(WEB + '/settings?tab=devices');
      await p.getByRole('button', { name: /^Edit ESP_/ }).first().click();
    },
  },
  { name: 'not found', go: (p) => p.goto(WEB + '/no-such-page'), theme: true },
  {
    name: 'error: the API is down',
    go: async (p) => {
      await p.route('**/api/**', (route) => route.fulfill({ status: 502, body: 'Bad Gateway' }));
      await p.goto(WEB + '/');
    },
  },
  {
    name: 'error: Campuses with the API down',
    go: async (p) => {
      await p.route('**/api/**', (route) => route.fulfill({ status: 502, body: 'Bad Gateway' }));
      await p.goto(WEB + '/campuses');
    },
  },
  {
    name: 'error: Incidents with the API down',
    go: async (p) => {
      await p.route('**/api/**', (route) => route.fulfill({ status: 502, body: 'Bad Gateway' }));
      await p.goto(WEB + '/incidents');
    },
  },
  {
    name: 'phone: the sidebar sheet open',
    viewport: { width: 390, height: 844 },
    go: async (p) => {
      await p.goto(WEB + '/');
      await p.getByRole('button', { name: 'Toggle Sidebar' }).first().click();
      await p.getByRole('dialog').waitFor();
    },
  },
];

const results = [];
let serious = 0;
for (const name of BROWSERS) {
  const browser = await ENGINES[name].launch();
  for (const state of STATES) {
    for (const theme of state.theme ? ['dark', 'light'] : ['dark']) {
      const context = await browser.newContext({
        viewport: state.viewport ?? { width: 1280, height: 900 },
        ...(process.env.SPREAD_ADDRESSES ? { extraHTTPHeaders: { 'x-forwarded-for': `10.9.${results.length >> 8}.${results.length & 255}` } } : {}),
      });
      if (theme === 'light') await context.addInitScript(() => localStorage.setItem('vite-ui-theme', 'light'));
      const page = await context.newPage();
      const label = `${name.padEnd(8)} ${state.name}${theme === 'light' ? ' (light)' : ''}`;
      try {
        await state.go(page);
        await settle(page);
        await page.addScriptTag(AXE);
        const { violations } = await page.evaluate(
          (tags) => window.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] }),
          TAGS,
        );
        const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        serious += bad.length;
        results.push({
          browser: name,
          state: state.name,
          theme,
          violations: violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            help: v.help,
            nodes: v.nodes.slice(0, 6).map((n) => ({ target: n.target.join(' '), summary: n.failureSummary?.split('\n').slice(0, 3).join(' ') })),
            count: v.nodes.length,
          })),
        });
        const list = violations.map((v) => `${v.impact}:${v.id}(${v.nodes.length})`).join(' ');
        console.log(`${bad.length ? 'FAIL' : 'ok  '} ${label}  ${violations.length} violations ${list}`);
      } catch (error) {
        serious += 1;
        results.push({ browser: name, state: state.name, theme, error: String(error).split('\n')[0] });
        console.log(`ERR  ${label} :: ${String(error).split('\n')[0]}`);
      }
      await context.close();
    }
  }
  await browser.close();
}
if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 2));
console.log(`\n${serious} serious or critical violations (or errors) across ${results.length} runs`);
process.exit(serious === 0 ? 0 : 1);
