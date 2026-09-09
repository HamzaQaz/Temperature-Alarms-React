# 16 — A silent Device's card never goes Offline, and its countdown wraps

**What to build:**
When a Device stops reporting, its dashboard card should say the Reading is late, then flip to Offline when the server says so, without anyone reloading the page. Found on 2026-09-09 while bench-testing the first real board: the card stayed Online with "Next in 30s" restarting forever after the board was unplugged.

**Blocked by:** 09 — Live updates over SSE

**Status:** done

- [x] After one missed report the card's footer reads "Expected Ns ago" instead of restarting the count
- [x] Once the age passes the Offline threshold the card shows Offline without a reload, and the server's Conditions are what it shows
- [x] A Reading arriving afterwards brings the card back to Online with a fresh count
- [x] Pure timing logic has a regression test the frontend can run without new dependencies

## Comments

**2026-09-09 — diagnosed and fixed** (`/diagnosing-bugs`, user asleep, virtual Device instead of the board).

- **Feedback loop.** A backend on :3002 with `REPORT_INTERVAL_SECONDS=2` (Offline after 6 s) and a Vite on :5174; a Playwright script posts one Reading, then reads the card's footer and badge at 3.5 s and 8 s while nothing else arrives. Twelve seconds, deterministic, red on both symptoms: `2s ago Next in` at 3.5 s, and `Online; footer: 7s ago Next in` at 8 s while the dashboard API already listed the Offline Condition. The recovery step (a new Reading flips it back) was green from the start, which ruled out a dropped stream.
- **Hypotheses.** (1) The page applies `online` and `conditions` only from the initial payload and from `reading` stream events, and a silent Device produces neither, so nothing ever re-evaluates. (2) The stream had dropped and the reconnect reload was not firing. (3) `secondsUntilNextReport` wraps by its modulo, by design, so a late Device looks on time. (2) was falsified by the recovery step; (1) and (3) were confirmed by the loop and the code.
- **Fix.** `nextReport` in `frontend/src/lib/reportTiming.ts` replaces the wrapping countdown: due in N seconds, or expected N seconds ago (`Math.abs`, since `-0` rendered as "-0s"). The card shows the late state in the warn tone. For Offline, the spec's rule stands: the browser computes no Condition. Instead `DeviceGrid` watches each card's age and, when an Online card passes `offlineAfterSeconds`, reloads the dashboard once (re-asking each second only while the server still disagrees). One extra `GET /api/dashboard` at the threshold, measured.
- **Regression tests.** `frontend/src/lib/reportTiming.test.ts` runs under `node --test` with Node's own type stripping, so the frontend gains a `npm test` for pure functions with no new dependency; `tsconfig.test.json` typechecks the tests with Node types and `tsc -b` covers it. The Offline flip has no in-repo seam: the frontend has no component tests by spec, and the loop needs Playwright, which the repo does not carry. The loop script and the measurements live in the session record; the virtual Device it grew out of is `backend/scripts/mock-device.mjs`.
- **What would have prevented it.** A card that shows Online is making a claim about time passing, and nothing in the page owned that claim between events. A test seam at the page level (a component test with a fake clock and a fake stream) would have caught it; adding one is a decision for the next architecture pass, not this fix.
