Target: product screenshots of the real UI for the README (and for pitches or slides), taken on the demo stack.

Change: bring the demo up with `deploy/deploy.sh demo --web-port 8084` in Git Bash. It seeds four fictional campuses, 24 closets, a week of history, and a scripted 10-minute loop of Conditions (see README "See it without hardware"). Wait until the loop shows several Conditions at once. From the demo's timing: Mold risk high on CRMS IDF 1 at about 280–310 s, Hot critical on RHS IDF 3 at about 300 s, and Offline on NGCC IDF 1 at about 165–320 s. Then capture, with Playwright and the existing ms-playwright Chromium (install playwright-core with --no-save, or in a temp directory; do not change package files):
1. `dashboard-dark.png`: Dashboard, all campuses, 1440×900 at deviceScaleFactor 2, dark theme, with Hot critical, Mold risk high, Dry or Offline visible above the fold.
2. `dashboard-light.png`: the same in the light theme.
3. `dashboard-campus.png`: one Campus filtered.
4. `history.png`: History for RHS IDF 3 (Gym) on a day with the Hot climb, with chart, tiles, and table.
5. `settings.png`: Settings with the admin token entered (the token comes from the demo output; never show it on screen) and the Devices table.
6. `phone-dashboard.png` and `phone-history.png`: 390×844 at deviceScaleFactor 3.
7. `escalation.gif` (or a short WebM if a GIF encoder is not available; ffmpeg is not installed, so check what is): the Condition-escalation trace on one card, about 2 s, cropped to the card. If neither is possible, save 4 PNG key frames instead.
Use realistic browser chrome-less framing, with no dev overlays, cursor, or scrollbars. Check each image once, and retake any with half-loaded skeletons or mid-animation smears, except the escalation frames.

Save them to docs/screenshots/ and optimise PNG size if a tool exists (no converter is installed, so plain PNG is fine; keep the set under 5 MB in total, using deviceScaleFactor 1.5 if needed). In README.md, update the image at the front door (the README already shows a dashboard image near the top; replace it with dashboard-dark.png) and add a short "Screenshots" section linking the rest. Keep the README's tone and don't oversell.

Constraints: the frontend and the demo are finished; do not edit frontend/, backend/, deploy/, or compose files. If you find a UI bug, describe it with the screenshot instead of fixing it. Never commit, push, stash, reset, or checkout: the coordinator commits. Bring the demo down with `deploy/deploy.sh demo --down` at the end and leave nothing running. Memory is limited, so run one stack only.

Ownership: docs/screenshots/ (new) and README.md (the front-door image and a Screenshots section only).

Observable acceptance: worker_done listing each file with its size, any UI bugs seen (with the file that shows them), and confirmation that the demo is down; --outcome succeeded if all images were captured and the README renders them with relative paths.
