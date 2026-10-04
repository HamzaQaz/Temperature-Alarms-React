# Frontend review: code and a real UI run

Scope: `frontend/src` against the frontend parts of tickets 02, 04, 05, 07, 08, 09, 10, 15, 16, PRODUCT.md and DESIGN.md. Two axes: Standards (CLAUDE.md, DESIGN.md, surrounding idiom) and Spec (ticket checklists and comments). Every finding below was confirmed in the code, and the ones marked **UI** were also seen in the running stack. Screenshots are in `ui/`.

## How it was run

- Stack: `docker compose -p uireview --env-file <scratch env> up -d --build` on `WEB_PORT=8081`. The env file was outside the repo and is now deleted, and the stack is down with `-v`. The env file was built from the variables `compose.yaml` requires, because this session's permissions deny reading `.env.example`. `REPORT_INTERVAL_SECONDS=10` was set so a silent Device turns Offline in 30 s. The images were built from the worktree as it stood, including other workers' uncommitted backend edits.
- Seed: Campuses North High (NHS) and South Middle (SMS), added through the API with the Admin token, and six Devices. Five virtual Devices ran `scripts/mock-device.mjs` inside `api`, giving Online, Hot·critical (92 °F), Cold·warning (44 °F), Dry·warning (14 %) and Mold risk·high (80 °F / 76 %). A sixth sent two Readings and went silent.
- Browser: Playwright Chromium. The connected claude-in-chrome browser is on a different machine (macOS) and cannot reach this host's `localhost`. My own walk scripts covered the flows below at 1440×900 and 375×812 (touch, coarse pointer), in the dark theme and the light theme (`vite-ui-theme=light`). Afterwards, `frontend/e2e/walk.mjs` ran against a freshly wiped stack and passed **31 of 31**.
- Checks in `frontend/`: `npm run lint` pass (no warnings), `npm run typecheck` pass, `npm test` pass (5 tests, 3 suites), `npm run build` pass (History chunk 409.7 kB, 113.7 kB gzip, lazy-loaded).

## Findings, most severe first

### 1. Bug (UI): on a phone, the sidebar sheet stays open after you tap a page
- **Where:** `frontend/src/components/app-sidebar.tsx:69`. The nav `Link`s never call `setOpenMobile(false)`, and the shadcn sheet does not close by itself on route change. Ticket 02 (sidebar router links); DESIGN.md §5 Navigation, Mobile.
- **Repro:** at 375 px, open `/` → tap the sidebar trigger → tap Settings. The URL changes to `/settings`, but the sheet still covers the page and the page under it is inert. See `ui/phone-dark-after-sidebar-nav.png` and `ui/phone-light-after-sidebar-nav.png`.
- **Fix:** `const { setOpenMobile } = useSidebar();` and `<Link to={item.url} onClick={() => setOpenMobile(false)}>`.

### 2. Bug: blocked storage gives a blank page
- **Where:** `frontend/src/components/theme-provider.tsx:18`. `localStorage.getItem` is called during render with no try/catch, and there is no error boundary. DESIGN/standards: `lib/adminToken.ts` already guards this case.
- **Repro:** open the site in Chrome with "Block all cookies" (or any context where `localStorage` throws a SecurityError). ThemeProvider throws and nothing renders.
- **Fix:** `let stored = null; try { stored = localStorage.getItem(storageKey) } catch { /* blocked */ }`.

### 3. Bug (latent): an older dashboard load can overwrite a newer one
- **Where:** `frontend/src/hooks/use-resource.ts:32-41`. `reload()` has no guard against stale responses. Tickets 09 and 16.
- **Repro:** while a card is past the Offline threshold, `Dashboard.tsx:184-188` reloads every second, and a reconnect or Refresh can overlap that. On a slow link, if load A resolves after load B, A's older payload is set last. A card can then flip back to Online or lose a live Reading until the next load.
- **Fix:** a load counter in a ref: `const id = ++latest.current; … if (id !== latest.current) return;`.

### 4. Spec gap (UI): the History token prompt cannot be dismissed
- **Where:** `frontend/src/pages/History.tsx:217-229` renders `AdminTokenPanel` without `onDismissRejection`, and `AdminTokenPanel.tsx:87` hides Cancel when there is no token. Ticket 10 (a 401 on Reset opens the token panel).
- **Repro:** with no token saved, open `/history/2` → Reset history → Delete all Readings. The server answers 401 and "Admin token needed" appears with only "Save token". Neither Escape nor any button closes it, so it stays until you leave the page. See `ui/history-reset-no-token.png`.
- **Fix:** pass `onDismissRejection={() => setPrompt('closed')}`, and show Cancel in the panel whenever `onDismissRejection` is given.

### 5. Spec gap: the Offline re-check always wastes its first request
- **Where:** `frontend/src/pages/Dashboard.tsx:183` uses `age >= offlineAfterSeconds`. The server rule is `>` (`backend/src/conditions.ts:111`: "Exactly three intervals is still Online"). Ticket 16 (its comment records one extra GET).
- **Repro:** a Device goes silent. At exactly the threshold the page reloads, the server still says Online, and the page asks again a second later: two GETs per silent Device every time.
- **Fix:** `>` on that line.

### 6. Spec gap (low, UI): the late note first reads "Expected 0s ago"
- **Where:** `frontend/src/components/DeviceCard.tsx:67-68`. Ticket 16.
- **Repro:** let a Device go silent. When its card first turns late, it reads "Expected **0s** ago" in amber for a second. See `ui/silent-2-late.png`, IDF-Annex card. That reads as a contradiction (late, but by nothing).
- **Fix:** switch to the late state only once `seconds >= 1` (in `nextReport`, `status: seconds > 0 ? 'late' : 'due'`), or show the count rounded up.

### 7. Spec gap (low): Next day can step past today
- **Where:** `frontend/src/pages/History.tsx:325`. `disabled={isToday}` is true only on exactly today. Ticket 10.
- **Repro:** open `/history/2?date=2030-01-01`. The page shows an empty future day, and Next day stays enabled and keeps going forward. The date field already has `max={today()}`.
- **Fix:** `disabled={date >= today()}`.

### 8. Standards (UI): "Across N reporting" counts Offline Devices
- **Where:** `frontend/src/pages/Dashboard.tsx:215,221`. `reporting` is the number of Devices with any Reading, Offline ones included. Ticket 07 (averages ignore Devices with no Reading; the spec is met, the copy is not); PRODUCT.md "say what happened".
- **Repro:** one of six Devices Offline: the Devices tile says "1 offline", but both average tiles say "Across 6 reporting" and include the silent Device's stale Reading. See `ui/dashboard-desktop-light.png`.
- **Fix:** either word it as "Across 6 with a Reading", or exclude Offline Devices from the averages and the count. That choice belongs to the ticket owner.

### 9. Standards: more than one primary button per view
- **Where:** `AdminTokenPanel.tsx:129` (Save token), `components/settings/CampusesSection.tsx:83` (Add campus), `components/settings/DevicesSection.tsx:138` (Add device). DESIGN.md §5 Buttons, "One per view at most".
- **Repro:** Settings with no token: Save token and Add campus are both near-white fills (`ui/settings-token-needed.png`).
- **Fix:** make Add campus and Add device `variant="outline"`.

### 10. Standards: the Settings row delete trigger is a grey ghost icon
- **Where:** `frontend/src/components/settings/section.tsx:206-215`. DESIGN.md §5: "The trigger for a destructive flow is an Outline button with Critical Red text". History's Reset follows the rule; Settings rows do not (`ui/settings-desktop.png`).
- **Fix:** add `text-destructive` at rest, or use the outline variant. If icon rows are an intended exception, record that in DESIGN.md.

### 11. Standards: mono used beyond hostnames
- **Where:** `CampusesSection.tsx:115` (shortcode input), `CampusesSection.tsx:163` (shortcode cell), `DevicesSection.tsx:267` (shortcode beside the Campus), `History.tsx:428` (chart tooltip values). DESIGN.md §3: Mono is for `ESP_A1B2C3` "and nothing else".
- **Fix:** drop `font-mono` in all four. Keep `tabular-nums` on the tooltip.

### 12. Standards: 12 px text in the Devices table
- **Where:** `DevicesSection.tsx:267`, where the shortcode is `text-xs`. DESIGN.md §6: 14 px or larger in tables.
- **Fix:** `text-sm`.

### 13. Standards: tile notes that change are not tabular
- **Where:** `frontend/src/components/Tile.tsx:24`. DESIGN.md §3, Tabular Rule.
- **Repro:** "Across 6 reporting" and "1 offline", and on History today "Low 92° · High 101°" and "4:52 PM to 5:01 PM", change while on screen, and their digits shift width.
- **Fix:** add `tabular-nums` to the note `dd`.

### 14. Standards: the Placeholder radius is 10 px, not 14 px
- **Where:** `frontend/src/components/Placeholder.tsx:4` uses `rounded-lg` (= `--radius`, 10 px). DESIGN.md §5 Placeholder says 14 px.
- **Fix:** `rounded-xl`.

### 15. Standards (UI): in the light theme the temperature line is orange
- **Where:** `frontend/src/index.css:36-37`. The light `--chart-1` is orange and `--chart-2` is teal. DESIGN.md §2 says temperature is Signal Blue and humidity is Humidity Green, with hues kept in the light theme. Orange next to warning amber also breaks the One Meaning Rule.
- **Repro:** set `localStorage['vite-ui-theme']='light'` and open a History page. The temperature line and its legend are orange and humidity is teal. See `ui/phone-light-history.png`; compare `ui/phone-dark-history.png`.
- **Fix:** set the light `--chart-1` to `oklch(0.488 0.243 264.376)` and `--chart-2` to `oklch(0.696 0.17 162.48)`.

### 16. Standards (a11y): a focusable button that does nothing in the sidebar footer
- **Where:** `frontend/src/components/app-sidebar.tsx:82-85`. A `SidebarMenuButton` renders a real `<button>` that holds only "2026 ©".
- **Repro:** Tab through the sidebar: focus lands on "2026 ©", and Enter does nothing.
- **Fix:** a plain `<p className="px-2 text-xs text-muted-foreground">`.

### 17. Doc conflict, not a code defect: summary numbers computed in the browser
- **Where:** `frontend/src/pages/Dashboard.tsx:207-219` (averages, offline count, attention count) and `lib/conditions.ts:39-43` (which levels count). Tickets 07 and 08 accept this, but PRODUCT.md says "every summary number comes from the API".
- **Decision needed:** move the summary into `GET /api/dashboard`, or soften the PRODUCT.md line.

## Walked flows

| Flow | Result |
|---|---|
| Dashboard, all Campuses (desktop, dark) | **OK.** Six cards; Hot·critical is a solid badge with a red border; Mold risk·high is a tinted red; Cold and Dry are amber; MDF tags are sky; the tiles are right; title "Dashboard · Temperature Alarms". `ui/dashboard-desktop-dark.png` |
| Dashboard with a Campus filter | **OK.** `?campus=NHS` shows the three North High cards, South Middle shows its three, and the filter survives a reload. `ui/dashboard-filter-north.png` |
| Live Reading without a reload | **OK.** A Reading of 99 °F posted to ESP_00000B appeared on the card over SSE within 2.5 s. `ui/dashboard-live-reading.png` |
| Card goes late, then Offline | **OK, with finding 6.** Next in → "Expected 0s ago" (amber) → Offline 22 s later, with no reload; the Offline badge and amber border are right. `ui/silent-1-online.png`, `silent-2-late.png`, `silent-3-offline.png` |
| History by day | **OK.** Opened from a card; title "IDF-Gym, North High · Temperature Alarms"; tiles, chart (blue temperature, dashed green humidity) and table are right. `ui/history-desktop.png` |
| Previous and next day | **OK.** The previous day shows "No Readings on …" (`ui/history-previous-day.png`), Next returns to today, and Next is disabled on today (see finding 7 for future dates). |
| History live refresh | **OK.** A posted 101 °F Reading added a row (35 → 36) and updated the high, with no reload. |
| Reset behind its confirmation | **OK, with finding 4.** "Keep it" keeps the day; with no token, confirming gives 401, the day stays, and an undismissable token panel appears. With the token saved, confirming empties the day. `ui/history-reset-dialog.png`, `history-after-reset.png`, `history-reset-no-token.png` |
| Settings: the Admin token prompt | **OK.** "Admin token needed" shows on arrival. `ui/settings-token-needed.png` |
| Settings: the wrong-token message | **OK.** Saving "wrong-token" and adding a Campus gives "Not authorised" and reopens the prompt with the form kept; saving the right token lets the same add go through. `ui/settings-wrong-token.png`, `settings-campus-added.png` |
| Settings: add, edit and delete a Campus | **OK.** East Elementary was added (shortcode upper-cased to EES) and, once empty, deleted behind an AlertDialog. |
| Settings: add, edit and delete a Device | **OK.** `esp_abc123` was saved as ESP_ABC123; the inline edit changed the closet and the Campus and kept the hostname read-only; the delete dialog warns that the Readings go too. `ui/settings-device-added.png`, `settings-device-edit.png`, `settings-delete-device-dialog.png` |
| Guard against deleting a Campus with Devices | **OK.** The dialog stays open with "This campus still has devices. Delete them first." (409), and Cancel leaves North High in place. `ui/settings-campus-guard.png` |
| Phone width (375 px) | **Broken navigation: finding 1.** No horizontal scroll on the Dashboard, History or Settings; the grids stack; under a coarse pointer the tabs, buttons and links measured 44–45 px. But the sidebar sheet does not close after a tap. `ui/phone-*.png` |
| Light theme | **OK except the chart: finding 15.** Reachable only via `localStorage['vite-ui-theme']='light'`; there is no theme switch, and dark is the default per DESIGN.md. Badges, borders and tiles read on white; the History temperature line is orange. `ui/dashboard-desktop-light.png`, `ui/phone-light-*.png` |
| Console errors | **OK.** The only messages were the browser's "Failed to load resource" lines for the expected 401 (wrong token) and 409 (Campus guard). No page errors and no React warnings. |
| Failed network requests | **OK.** Only the expected 401 and 409 above, plus one `GET /api/devices/3/history` aborted (`net::ERR_ABORTED`) during the reset reload, which is a cancelled fetch, not a failure. No 5xx anywhere. |
| Repo browser walk (`frontend/e2e/walk.mjs`, empty stack) | **31 of 31 passed.** |

## Ticket checklist items confirmed in the code

- **02:** the sidebar items are router `Link`s; only `framer-motion` and `@number-flow/react` remain; no Bootstrap, Font Awesome or `radix-ui` meta-package; lint and typecheck are clean.
- **04:** `api.ts` is the single client and sends the token on non-GET only; a 401 becomes `UnauthorisedError`, which forgets the rejected token and prompts. The token store is guarded. Campus delete is behind an AlertDialog. Wire types are camelCase.
- **05:** the client-side hostname check `^ESP_[0-9A-F]{6}$` matches the server. The Campus is picked from a dropdown. Device delete warns that its Readings go too. A Campus 409 keeps the dialog open with the reason.
- **07:** the Campus filter comes from the URL; the countdown and Offline copy come from `reportIntervalSeconds` and `offlineAfterSeconds`; the averages skip Devices with no Reading; cards show the tag, the age and Online/Offline.
- **08:** no Condition is computed in the browser; there is one badge per Condition with its level spelled out; the border is the server's worst Condition; "Need attention" excludes moderate.
- **09:** the stream updates cards in place, reloads after a reconnect, reopens after 5 s, and ignores events older than the card's Reading.
- **10:** the device comes from the path and the day from `?date=`; the chart has two axes, dashed humidity, no animation and no dots above 48 points; live reload is debounced and limited to the day on screen; Reset uses an AlertDialog with a solid destructive confirm.
- **15:** the inline edit keeps the hostname read-only with the reason, sends only the changed fields, returns focus to the row, and a 401 goes to the token prompt.
- **16:** `nextReport` never wraps; the late state is amber; the card takes Offline from the server and a later Reading resets it.
- **DESIGN general:** one h1 and its own document title per page; the sidebar inside `nav`; 44 px controls under `pointer-coarse:`; `motion-safe:` plus `MotionConfig reducedMotion="user"`; the Two Reds rule respected; Skeletons, not spinners.

## Fixed

Fixes made on 2026-10-04 for task_9dedfe8414ca. Each was confirmed on the rebuilt `uireview` stack (WEB_PORT 8081, the same seed) at 1440 px and at 375 px (touch, coarse pointer), in the dark and light themes, unless a note says otherwise. Screenshots are `ui/fix-*.png`. In `frontend/`, `npm run lint`, `typecheck`, `test` (5/5) and `build` pass under PowerShell. `docker compose config` is valid. `e2e/walk.mjs` passed **31 of 31** against the fresh stack.

1. **Fixed.** `app-sidebar.tsx`: nav links call `setOpenMobile(false)`. At 375 px in both themes, tapping Settings and then Dashboard in the sheet closes it and the page is usable. `ui/fix-phone-dark-sidebar-open.png`, `fix-phone-{dark,light}-after-sidebar-nav.png`.
2. **Fixed.** `theme-provider.tsx`: the read is wrapped in try/catch and falls back to the default (dark). With `localStorage` made to throw a SecurityError, the Dashboard and Settings render with no page errors. `ui/fix-blocked-storage.png`.
3. **Fixed.** `use-resource.ts`: each load takes an id, and a load that settles after a newer one started is dropped, data and error alike. Confirmed with a Refresh whose response was captured while the card was late and held back 25 s, landing about 5 s after the card turned Offline: the card stayed Offline. Desktop dark only, because the behaviour does not depend on width or theme.
4. **Fixed.** `AdminTokenPanel` takes an `onClose` prop, and History passes it. The panel shows Cancel even with no token stored, and Cancel closes it with the day intact. Settings is unchanged, because it does not pass `onClose`. `ui/fix-*-history-token-prompt.png`, `fix-*-history-token-cancelled.png`.
5. **Fixed.** `Dashboard.tsx`: the re-check uses `>`, matching the server. Instrumented run: the only re-check was at age 31, the server answered Offline, and the card changed 0.4 s later. One extra GET, as ticket 16 records. (The full walk counted two, because its held Refresh from finding 3 was in the same window; the isolated run is the evidence.)
6. **Fixed.** `reportTiming.ts`: exactly due is now `due, 0` ("Next in 0s"), and late starts a second after, because that second is when a punctual board's Reading lands. The test is updated to match (`nextReport(30, 30)` is due 0, `nextReport(31, 30)` is late 1). In the walk the first late samples read 1, 2, 3 s, never 0. `ui/fix-silent-offline.png`.
7. **Fixed.** `History.tsx`: Next day is disabled when `date >= today()`. `?date=2030-01-01` has it disabled at both widths and in both themes.
8. **Fixed (judgement call: copy, not arithmetic).** The note now reads "Across N with a Reading". Ticket 07 asks the averages to ignore only Devices with no Reading, and the coordinator kept the arithmetic as it is, so the honest change is the wording. Dropping Offline Devices from the averages would be a spec change for the ticket owner.
9. **Fixed.** Add campus and Add device are `variant="outline"`. Save token, Save campus and Save device stay as the single primary in their views. `ui/fix-*-settings-*.png`.
10. **Fixed.** The Settings row delete trigger is an outline icon button with `text-destructive` at rest (dark `oklch(0.704 0.191 22.216)` Critical Red; light, the light theme's destructive), as DESIGN.md §5 says. The edit pencil next to it stays a ghost button, since it is an inline action.
11. **Fixed.** `font-mono` removed from the shortcode input, the shortcode cell, the shortcode beside a Device's Campus, and the chart tooltip values (which keep `tabular-nums`). Every remaining `font-mono` is a hostname. Computed fonts confirmed as the system stack.
12. **Fixed.** The Devices-table shortcode is `text-sm`, measured at 14px.
13. **Fixed.** Tile notes, both tones, are `tabular-nums` (computed `font-variant-numeric: tabular-nums`).
14. **Fixed.** Placeholder is `rounded-xl`, measured at 14px on the empty-day panel. `ui/fix-*-history-empty-day.png`.
15. **Fixed (judgement call on the green step).** In the light theme, `--chart-1` is Signal Blue `oklch(0.488 0.243 264.376)` and `--chart-2` is Humidity Green's hue at the 600 step, `oklch(0.596 0.145 163.225)`. DESIGN.md says signal colours keep their hue in the light theme. The 500 step (the dark value) gives a line under 3:1 on white, so I took the darker step, by the same logic as DESIGN's "700 and 800 steps for text". Computed strokes confirmed in all four views. `ui/fix-*-history.png`, `fix-*-chart-legend.png`.
16. **Fixed.** The sidebar footer is a plain `<p>`. No button remains in the footer, and it still hides when the sidebar collapses to icons.
17. **Decided by the coordinator, done.** The browser-side summary arithmetic stays. PRODUCT.md's principle now says Conditions, their levels, and thresholds come only from the API, while the dashboard's summary tiles may total what the API returned.

Also in this pass:
- **History `truncated`:** typed as `truncated?: boolean` on `History`. When it is set, a quiet muted line with an info icon sits under the day picker, saying the first N Readings are shown and the numbers, chart and table cover only those. Confirmed by rewriting the response to `truncated: true` and `false` (the note appears only for `true`) at desktop dark and phone light. `ui/fix-desktop-dark-history-truncated.png`, `fix-phone-light-history-truncated.png`.
- **firmware-docs.md finding 13:** `location = /index.html { add_header Cache-Control "no-cache"; }`. On the stack, `/`, `/index.html`, `/settings` and `/history/1` return `Cache-Control: no-cache`, and hashed assets keep `max-age=31536000` with `public, immutable`.
- **firmware-docs.md finding 15:** the image is `nginxinc/nginx-unprivileged:1.28-alpine` listening on 8080. Inside the container, `id` is `uid=101(nginx)` and every nginx process runs as `nginx`. compose.yaml's `web` publishes `${WEB_PORT:-80}:8080` (host port unchanged) and has a `wget --spider` healthcheck on 8080, and `up --wait` reports web `Healthy`. The X-Forwarded-For line is untouched.
