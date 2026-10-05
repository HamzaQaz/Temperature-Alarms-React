Name: accessibility. Report: .scratch/prodtest/accessibility.md.

Target: WCAG 2.2 AA (PRODUCT.md's bar) and cross-browser behaviour of every page: Dashboard (both orders), Campuses, Incidents (each window), History, Settings (token prompt, Campuses and Devices tabs, dialogs), and the 404 and error states.

How: bring up the demo with your own project and port. `deploy/deploy.sh demo --web-port 8097` uses the fixed project temperature-alarms-demo, so if the CT agent runs a demo, coordinate by checking `docker ps` and the memory rule first. Alternatively, run the backend locally against the shared test DB and `vite preview`, which is lighter, and seed it with backend/scripts/demo.mjs, if that works.

Then:
- **axe-core** on every page and state, via Playwright with @axe-core/playwright installed --no-save, or by injecting axe from a CDN. Run it in Chromium, Firefox, and WebKit (`npx playwright install firefox webkit` into the ms-playwright cache; no package changes).
- **Keyboard only:** complete every task without a mouse, with focus always visible and never trapped except in dialogs. Escape closes dialogs and the sheet. The skip-to-content or landmark order is sensible.
- **Screen reader semantics:** headings, landmarks, live regions for new Readings and incidents (polite, not spammy: with 24 Devices every 30 s, a live region must not chatter), chart alternatives (the History chart, the Campuses column chart, and the Incidents ruler each need a text equivalent), and tables with headers.
- **Zoom and reflow:** 200% and 400% zoom (reflow at 320 CSS px, no horizontal page scroll), text spacing override, prefers-reduced-motion and prefers-contrast, forced-colors (Windows High Contrast) where it does not hide state, and contrast of every text and signal colour in both themes.
- **Touch targets:** 44 px under a coarse pointer.

Fix everything in frontend/src that fails, test-first where a unit test fits. Re-run axe, and record before and after counts per page and browser in the report. Keep DESIGN.md's look; if a fix needs a DESIGN.md change, say so in the report instead of editing DESIGN.md.

Constraints: follow prod-common.md.

Ownership: frontend/src, frontend/e2e (you may add an a11y step to walk.mjs), and .scratch/prodtest/accessibility.md.

Observable acceptance: frontend lint, typecheck, test, and build pass, and walk.mjs passes. axe reports 0 serious or critical violations on every page in all three browsers, and the keyboard pass is complete. Send worker_done with the table, the fixes, and --files-modified.
