Target: frontend/ against the frontend parts of tickets 02, 04, 05, 07, 08, 09, 10, 15, 16, plus PRODUCT.md and DESIGN.md (read both first).

Change:
1. Code review of frontend/src.
2. A real UI run. Bring the full stack up under its own project name and port so it does not collide with other workers: copy .env.example to a scratch env file OUTSIDE the repo (for example under your temp directory), fill in throwaway tokens and a DB password, set WEB_PORT=8081, then from the repo root run `docker compose -p uireview --env-file <that file> up -d --build`. Seed it: create a Campus and several Devices through the API with the admin token, then post Readings with backend/scripts/mock-device.mjs (see README) via `docker compose -p uireview exec api node scripts/mock-device.mjs ...`, so that cards show Online, Hot, Cold, Dry, and Mold risk, and one Device goes silent and turns Offline. Walk it in a browser (Chrome through the claude-in-chrome tools, or the repo's browser walk under frontend/e2e/ where quicker; see README "The browser walk"): the Dashboard with and without a Campus filter; a live Reading arriving without a reload; a card going late, then Offline; History by day with previous/next day, live refresh, and reset behind its confirmation; Settings with the admin token prompt, the wrong-token message, add/edit/delete Campus and Device, and the guard against deleting a Campus that still has Devices. Check phone width (375px) and desktop, both colour themes if supported, console errors, and failed network requests. Screenshot anything broken.
3. In frontend/, run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`.

When done, run `docker compose -p uireview down -v` and delete the scratch env file.

Constraints: edit no repo file except the report and screenshots. Do not use port 80 or the default compose project name.

Ownership: .scratch/rebuild/reviews/frontend.md (code-review and UI-run findings, each with steps to reproduce) and screenshots under .scratch/rebuild/reviews/ui/.

Observable acceptance: the report exists, ranked most severe first, with a section per walked flow saying OK or what broke. Send worker_done with --report-path and --outcome succeeded if the review and the walk completed.
