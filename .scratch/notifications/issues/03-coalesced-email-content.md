# 03 — One email per burst, and what it says

**What to build:**
A campus outage arrives as one email, not twenty, and every email reads well on a phone. A pure builder turns pending rows, plus their Incident and Device data, into a subject, plain text, and simple HTML. The sender waits `NOTIFY_COALESCE_SECONDS` after the oldest due row, then sends everything due as one email, worst first. See the spec's "One email for a burst" and "Readable at a glance".

**Blocked by:** 02

**Status:** done

- [x] `notificationEmail.ts`: a pure function from rows to {subject, text, html}. One incident: `[Temperature Alarms] CHS IDF 2: Hot critical (91 °F)`. Several: `[Temperature Alarms] 3 incidents: 2 Offline, 1 Hot`. An incident that opened and closed in one batch is listed once, as "opened and resolved"
- [x] Each entry gives Campus, Closet, Device, Condition and level, the start (and the end, with duration), the peak Reading (for Offline, the last Reading before the silence), and a History link on `PUBLIC_URL` for that Device and local day
- [x] Times in the server's time zone (`localDay.ts`), °F to one decimal, % as a whole number, no images, no tracking, HTML escaped
- [x] The sender coalesces within the window, and a burst that keeps arriving still sends within two windows
- [x] Pure tests for the builder. Seam test: twenty Offline incidents in one sweep arrive as one email

## Comments

**2026-10-06 — built, by a supervised worker; awaiting review.** Spec: `.scratch/notifications/spec.md` ("One email for a burst", "Readable at a glance"); ADR 0008.

**What was built.** `notificationEmail.ts`, pure: the rows with their Incident and Device become `{subject, text, html}`. One incident: `[Temperature Alarms] CHS IDF 2: Hot critical (91 °F)`, with `, got worse`, `, resolved`, or `, opened and resolved` when that is the news. Several: `[Temperature Alarms] 3 incidents: 2 Offline, 1 Hot`, Conditions most first. Each entry: Condition and level (Offline and Sensor fault have one level, so it is left out), what Offline and Sensor fault mean ("the board is online but its sensor is not answering"), Campus, Closet, Device, the start, the end with its duration once resolved, the peak Reading (the last Reading before the silence for Offline, the last good one for Sensor fault), and `PUBLIC_URL/history/<id>?date=YYYY-MM-DD`, the frontend's History route, for the day it started. Times in the server's zone (`localDay.ts`), °F to one decimal without a trailing `.0`, humidity a whole percent, HTML escaped, no images, one link per entry. The sender waits `NOTIFY_COALESCE_SECONDS` after the oldest due row, then sends everything due as one email, worst first; the window, backoff, and zone are options of the pass, so tests drive time directly.

**Decisions beyond the ticket.** A digest adds `(1 resolved)` or `(all resolved)` when some of its incidents ended. Entries are ordered by level, then start. A retry goes at once, its batch having waited. One email holds at most 200 rows. Entries show the incident as it stands at send time (its worst level, peak, end), so an opened row sent after the level rose names the higher level. The History day is cut in the server's zone, while the History page reads it in the browser's; they match for one district.

**Untested.** How each mail client renders the HTML part (checked only as markup); the subject's `°` arrives MIME-encoded, decoded by the test relay. A digest of hundreds of incidents on a phone.

**Verified 2026-10-06** on a fresh MySQL 8.4: backend typecheck clean and `npm test` 382/382 (`notifier.test.ts` 27, `notificationEmail.test.ts` 11); frontend lint, typecheck, `npm test` 73/73, and build clean. Not committed.

**2026-10-06 — verified by the coordinator** with every ticket of both features in place, on a fresh MySQL 8.4: backend typecheck (test and production) clean, `npm test` 382/382; frontend lint, typecheck, `npm test` 73/73, build clean; deploy tests pass in Git Bash, pwsh 7, and Windows PowerShell 5.1; shellcheck 0.11 clean; `arduino/test_bench.py` 56/56. Not committed.
