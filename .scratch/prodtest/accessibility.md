# Accessibility: WCAG 2.2 AA and cross-browser

Agent: accessibility. Date: 2026-10-05. Scope: every page and state of `frontend/`, in Chromium, Firefox and WebKit (Playwright 1.63), against the demo data set (4 Campuses, 24 Devices, a week of history, the scripted live loop).

Setup: no Compose stack. A throwaway MySQL (`ta-a11y-db`, tmpfs, :3317), the backend built to a scratch folder and run twice (demo DB on :3197, an empty DB for the walk on :3198), `backend/scripts/demo.mjs` seeding the demo DB, and `vite preview` on :8097 and :8098 proxying `/api` to them, so the page and API share one origin as behind nginx. axe-core 4.13 is injected from a local file (`AXE_PATH`). Raw output is in `.scratch/prodtest/runs/a11y-*` (gitignored).

## Pass/fail

| Check | Before | After |
|---|---|---|
| axe: serious or critical, 29 states × 3 browsers (87 runs) | **FAIL**: 81 runs failing, 279 nodes | **PASS**: 0 |
| axe: moderate | 84 runs (landmarks, h1) | 3 runs, the Select list open (expected, see notes) |
| Keyboard: every task without a mouse (`e2e/keyboard.mjs`) | **FAIL**: no skip link, focus lost after route changes and after closing the phone sheet, chart and scroller unreachable or ringless | **PASS**: Chromium 14/14, Firefox 14/14, WebKit 10/10 (4 skipped: WebKit leaves links out of Tab, like Safari by default) |
| Focus always visible | **FAIL**: History chart had no ring; every ring was gone in forced colours; ring contrast about 1.9:1 (dark) and 1.5:1 (light) | **PASS** |
| Focus trapped only in dialogs; Escape closes dialogs and the sheet | **FAIL**: the sheet closed to the page start | **PASS** |
| Landmarks, headings, skip link | **FAIL**: no skip link, sidebar header and footer outside landmarks, History card titles not headings, no 404 page (blank `main`) | **PASS** |
| Live regions: polite and not chatty | **FAIL**: the Dashboard said nothing about Conditions; Incidents overwrote its own messages | **PASS**: 4 messages in 95 s on the Dashboard with 24 Devices (about 72 Readings), at most one per 10 s |
| Chart text equivalents | **FAIL**: History chart had none (an unnamed `role=application` SVG) | **PASS**: History has a figure, name, and a description; Campuses' column chart and the Incidents ruler already had them (role=img label; row text) |
| Tables with headers | PASS (Campuses keeps table semantics in its stacked phone layout in all three engines) | PASS |
| Reflow at 320 px, 200% and 400% zoom | **FAIL**: Device cards clipped 16 px at 320 px | **PASS**: no horizontal page scroll, nothing clipped, all pages, all 3 browsers |
| Text spacing override (1.4.12) | **FAIL**: Incidents' Next button pushed off screen at 320 px; Campuses table clipped at 1280 px; a title row overflowed in WebKit | **PASS** |
| prefers-reduced-motion | PASS (no transform, size or position animation runs) | PASS |
| prefers-contrast: more | no response | **PASS**: secondary text and hairlines a step stronger |
| Forced colours (High Contrast) | **FAIL**: no focus ring anywhere; selected tab, current page and incident spans invisible | **PASS** |
| Contrast of text and signal colours, both themes | **FAIL**: badge level text 4.38:1 (critical, dark) and 4.12:1 (moderate, light); light critical 3.98:1 | **PASS** for every pairing a page renders |
| Touch targets 44 px under a coarse pointer | **FAIL**: sidebar items 32 px (tablet width), Select options 32 px | **PASS** (one note on the collapsed icon rail) |
| frontend lint, typecheck, test, build | PASS | PASS (42 tests, 13 of them new) |
| `e2e/walk.mjs` (fresh DB) | 36/36 | 38/38 (2 a11y checks added) |

### axe before and after: serious or critical rules (nodes), per page and browser

| Page / state | Chromium | Firefox | WebKit |
|---|---|---|---|
| Dashboard, worst first | 3 (15) → 0 | 3 (15) → 0 | 3 (15) → 0 |
| Dashboard, worst first (light) | 3 (15) → 0 | 3 (15) → 0 | 3 (15) → 0 |
| Dashboard, by Campus | 3 (15) → 0 | 3 (15) → 0 | 3 (15) → 0 |
| Dashboard, one Campus | 3 (15) → 0 | 3 (15) → 0 | 3 (15) → 0 |
| Campuses | 0 → 0 | 0 → 0 | 0 → 0 |
| Campuses (light) | 1 (1) → 0 | 1 (4) → 0 | 1 (4) → 0 |
| Incidents, overnight | 1 (1) → 0 | 1 (1) → 0 | 1 (1) → 0 |
| Incidents, overnight (light) | 1 (1) → 0 | 1 (1) → 0 | 1 (1) → 0 |
| Incidents, today | 1 (1) → 0 | 1 (1) → 0 | 1 (1) → 0 |
| Incidents, 7 days | 2 (2) → 0 | 2 (2) → 0 | 2 (2) → 0 |
| History | 3 (11) → 0 | 3 (11) → 0 | 3 (11) → 0 |
| History (light) | 3 (11) → 0 | 3 (11) → 0 | 3 (11) → 0 |
| History, Reset dialog | 0 → 0 | 0 → 0 | 0 → 0 |
| History, no such Device | 0 → 0 | 0 → 0 | 0 → 0 |
| Settings, token prompt (dark and light) | 0 → 0 | 0 → 0 | 0 → 0 |
| Settings, Campuses / add Campus form / delete dialog | 0 → 0 | 0 → 0 | 0 → 0 |
| Settings, Devices (dark and light) / edit Device form | 0 → 0 | 0 → 0 | 0 → 0 |
| Settings, add Device form with the Campus list open | 1 (1) → 0 | 1 (1) → 0 | 1 (1) → 0 |
| Not found (dark and light) | 0 → 0, but the page was blank: no h1, no title | same | same |
| Error: API down on Dashboard | 1 (1) → 0 | 1 (1) → 0 | 1 (1) → 0 |
| Error: API down on Campuses | 0 → 0 | 0 → 0 | 0 → 0 |
| Error: API down on Incidents | 1 (1) → 0 | 1 (1) → 0 | 1 (1) → 0 |
| Phone: sidebar sheet open | 0 → 0 | 0 → 0 | 0 → 0 |

Totals: 279 serious or critical nodes before, 0 after. Reproduce with `SPREAD_ADDRESSES=1 WEB=http://localhost:8097 ADMIN_TOKEN=... node frontend/e2e/a11y.mjs out.json`.

## Findings, by production impact

### Blocker

1. **Focus was invisible in Windows High Contrast and nearly invisible everywhere else** (2.4.7, 1.4.11). Every control draws focus as a box-shadow ring with `outline-none`, and forced colours drop box-shadow, so a High Contrast user saw no focus at all. Outside it, the ring was Focus Grey at 50% alpha: about 1.9:1 on the dark page and 1.5:1 on white. Repro: Chromium with `forcedColors: 'active'`, Tab: no indicator. Fixed: a real `outline: 2px solid CanvasText` under `forced-colors`, rings at full strength, and the light `--ring` set to Focus Grey (0.556), the same grey the dark theme uses. Now ≥3.2:1 on every surface in both themes. Covered by `e2e/keyboard.mjs` ("every stop shows focus").
2. **Invalid ARIA on every filter tab** (axe critical `aria-valid-attr-value`, 4.1.2). The Campus, order and Incidents window tabs filter one set of content and have no tab panels, so Radix pointed `aria-controls` at ids that do not exist. Fixed: each tab names the content it filters (`#dashboard-devices`, `#incidents-log`).
3. **The Dashboard tiles were an invalid description list** (axe serious `definition-list` and `dlitem`, 1.3.1). `dl > div.card > div.card-content > dt`. Fixed in `Tile.tsx`: the card is the one wrapper a `dl` allows. Same look.

### Should-fix

4. **No 404**: an unknown address rendered an empty `main` with no heading or title. Added `pages/NotFound.tsx` (h1, title "Page not found · Temperature Alarms", the address, a way home). Walk check added.
5. **No skip link; focus stayed on the old link after a route change** (2.4.1, 2.4.3). Seven stops before any page content. Added "Skip to content" as the first stop, and a route change now moves focus to the new page's h1 (not on the first load, not on a filter or day change). Covered by keyboard.mjs and walk.mjs.
6. **The phone sidebar sheet closed to the top of the page** (2.4.3): Escape dropped focus on `body`, because the sheet is opened by `SidebarTrigger`, not a Radix trigger. Fixed: focus goes back to the trigger unless a page link already moved it on. The trigger also has `aria-expanded` now.
7. **The Dashboard told a screen reader nothing about Conditions** (4.1.3). New `lib/announce.ts`: a polite region says only when a card's worst Condition or Online changes ("IDF 3 (Gym), Riverside High School: Hot critical", "back in range", "Offline", "back online"), never for a Reading at the same level. A throttle speaks the first change at once and gathers the rest into one message every 10 s at most, three named and the rest counted. Incidents uses the same throttle (before, a second message within a second replaced the first). Measured on the demo: 4 messages in 95 s on the Dashboard, 3 on Incidents. Tests: `lib/announce.test.ts` (10).
8. **The History chart had no text equivalent** (1.1.1) and was a focus stop (`role=application`) with no ring. It is now a named figure described by a sentence per series with the low and high and when, the Reading count and span, and the bucket it is drawn from (`lib/chartSummary.ts`, 3 tests), and the SVG takes the focus ring. "Over the day" and "Readings" are now h2s.
9. **The History Readings table scrolled in a box no keyboard could reach** (axe serious `scrollable-region-focusable`, 2.1.1). Now a named, focusable region with a ring.
10. **Badge level text under 4.5:1** (1.4.3): "· critical" at 80% white on the critical fill was 4.38:1; "· moderate" on the light tint 4.12:1; on the light theme's lighter critical red, 90% white is 3.98:1. Now 90% (5.1 to 5.3:1), and full strength on the light critical badge (4.8:1).
11. **Device cards clipped at 320 px** (1.4.10): the grid's 19rem minimum is wider than a 320 px screen less its padding, and the overflow was hidden, so 16 px of every card was cut off. Now `minmax(min(19rem,100%),1fr)`: identical at every width where 19rem fits.
12. **Text spacing pushed content out of view** (1.4.12): Incidents' window label could not wrap, so Next went off screen at 320 px; `main` could not shrink below its content, so the Campuses table was clipped at the window edge at 1280 px; the Campuses and Incidents title rows did not wrap (WebKit). Fixed: the label wraps on a phone, `main` is `min-w-0` (the table scrolls in its own box, which 1.4.10 allows for data tables), and the title rows wrap.
13. **Forced colours hid state**: the selected tab, the current page in the sidebar and the incident spans are fills, which forced colours remove. The selected tab and current page now take the system's Highlight colours there, the spans are drawn in the text colour, and sidebar links carry `aria-current="page"`.
14. **The Select list left the page focusable behind an `aria-hidden`** (axe serious `aria-hidden-focus`). Radix hides the page from screen readers while the list is open; the page is now also `inert` for that time, and comes back on close (focus returns to the field; verified by keyboard).
15. **Touch targets** (DESIGN.md's 44 px under a coarse pointer): sidebar items were 32 px on a touch tablet and Select options 32 px. Both are 44 px under `pointer: coarse` now; the mouse density is unchanged.
16. **The Settings token field took focus on page load**, so a screen reader started in a password field and skipped the heading and the explanation. The field now takes focus only when the panel is opened (Change, Forget, a rejection, or History asking for the token), and is described by the panel's sentence.
17. **Landmarks**: the sidebar's name and footer sat outside any landmark, and the brand was a link to `#`. The name is now the banner and a link home, the footer a `footer`; the phone sheet is titled "Pages".
18. **prefers-contrast: more** had no effect. Secondary text and hairlines are now a step stronger in both themes when it is asked for; nothing else changes.

### Should-fix outside my files (for the coordinator to route)

19. **The API's read limit can blank pages for an office behind one address** (`backend/src/app.ts`, security agent). It is 500 requests per address per 15 minutes on all `/api/` reads. A Campuses page reloads the overview up to every 10 s while the stream is busy (90 in 15 minutes), the Dashboard reloads on level changes, and SSE reconnects count too. Five or six browsers behind one district NAT exhaust it, and every page then shows "Too many requests from this IP" until the window resets. Repro: my audit tripped it from one address (`curl localhost:8097/api/devices` answered 429 with that body). Suggested change: exempt `GET /api/stream` and raise the read limit (for example 3000 per 15 minutes), or key it per browser rather than per address; keep the write and auth-failure limits as they are.

### Notes

- **WebKit leaves links out of Tab** (Safari's default; users turn on "Press Tab to highlight each item"), and Playwright's WebKit cannot turn it on, so the four link-dependent keyboard checks are skipped there. Every control that is not a link passed in WebKit.
- **Select list open**: axe reports three moderate rules (no main, no h1, region) because the page is deliberately hidden behind the modal list. Expected.
- **Collapsed sidebar under a coarse pointer**: the icon rail is 48 px wide, so its items are 44 px tall but 32 px wide. That meets 2.5.8 (24 px) but not DESIGN.md's 44 px. Widening the rail is a layout change, so I left it.
- **On a phone in WebKit**, a sidebar toggle in the first ~100 ms after load can act on the desktop sidebar state before the mobile check settles. Not seen in Chromium or Firefox; a person cannot press that fast after load.
- **Label in name (2.5.3)**: the Campuses "worst closet" link is named "History today: IDF 1 (Cafeteria), Campus, 73°F. Humidity 62%" while it shows "73°F IDF 1 (Cafeteria) Humidity 62%". The closet name, which is what a speech user would say, is in the name, so it passes, but it would be tidier if the name started with the visible text.
- **Hypothetical contrast**: the high badge, Online badge, error red and muted text fall to 4.3 to 4.4:1 on the light `bg-muted` (oklch 0.97). No page puts them on that surface today; it matters only if a future design does.
- The Incidents ruler stays `aria-hidden`: each row's text (start, end, level, worst stretch) says everything the span shows, which is the text equivalent.

## DESIGN.md changes these fixes need (not edited)

- **Focus**: "a 3px ring in Focus Grey at 50%" becomes Focus Grey at full strength, and the light theme's ring is the same Focus Grey (oklch 0.556), not 0.708. Under forced colours, a 2px CanvasText outline.
- **Condition badge**: the level after the middle dot is at 90% opacity, not 80%, and at full strength on the light theme's critical badge.
- **Device grid**: `auto-fill, minmax(min(19rem, 100%), 1fr)`.
- **Touch**: sidebar items and Select options join the list of controls that grow to 44 px under `pointer-coarse:`.
- **New components**: a skip link (shown on focus, top left, Panel surface with the focus ring) and a Page not found page (the Placeholder pattern).
- **Forced colours**: the selected tab and current page in Highlight; incident spans in the text colour.
- **prefers-contrast: more**: muted text 0.42 (light) and 0.82 (dark), hairlines stronger.

## Fixes made, and what covers them

| Fix | Files | Covered by |
|---|---|---|
| Polite, throttled announcements (Dashboard, Incidents) | `lib/announce.ts`, `hooks/use-announcer.ts`, `components/LiveAnnouncement.tsx`, `pages/Dashboard.tsx`, `pages/Incidents.tsx` | `lib/announce.test.ts` (written first, failed, then passed); live-region recording above |
| History chart text equivalent, focus ring, h2s, focusable Readings region | `lib/chartSummary.ts`, `pages/History.tsx` | `lib/chartSummary.test.ts` (written first); a11y.mjs |
| Filter tabs' `aria-controls` | `pages/Dashboard.tsx`, `pages/Incidents.tsx` | a11y.mjs |
| Tile `dl` structure | `components/Tile.tsx` | a11y.mjs |
| Badge level contrast | `components/ConditionBadge.tsx` | a11y.mjs; contrast fixtures |
| Skip link, focus on route change, 404 route | `App.tsx`, `pages/NotFound.tsx` | keyboard.mjs, walk.mjs |
| Sidebar landmarks, home link, `aria-current`, `aria-expanded`, sheet focus return and title, 44 px items | `components/app-sidebar.tsx`, `components/ui/sidebar.tsx` | keyboard.mjs, a11y.mjs, touch probe |
| Select: inert page while open, 44 px options | `components/ui/select.tsx` | a11y.mjs, keyboard.mjs |
| Focus ring strength; forced-colours focus; prefers-contrast; programmatic focus has no ring | `index.css`, `components/ui/{button,input,badge,tabs,select}.tsx`, `pages/Campuses.tsx`, `pages/History.tsx` | keyboard.mjs; forced-colours run |
| Forced-colours selected tab and spans | `components/ui/tabs.tsx`, `pages/Incidents.tsx` | forced-colours screenshots |
| Reflow and text spacing | `pages/Dashboard.tsx`, `pages/Incidents.tsx`, `pages/Campuses.tsx`, `App.tsx` | reflow probe (320, 640, 1280, with and without spacing, 3 browsers) |
| Token field focus only on opening | `components/AdminTokenPanel.tsx` | keyboard.mjs |

New tooling under `frontend/e2e/`: `a11y.mjs` (axe over the 29 states in all three browsers; exits 1 on any serious or critical violation) and `keyboard.mjs` (every task by keyboard; needs an empty DB, as walk.mjs does). `walk.mjs` gained two checks (skip link to the h1; Page not found). Playwright and axe are not package dependencies: `npm install --no-save playwright@1.63.0` (a dependency bump in this run pruned it from `node_modules`), and axe from `AXE_PATH`, an installed `axe-core`, or cdnjs.
