# 01 — Monthly report email

**What to build:**
On the first of each month, one email per Campus (or one district-wide) summarising last month: the hottest and most humid closets with their peaks, incident count and total time in each Condition, Offline and Sensor fault time per Device, and closets that ran warm most of the month. Evidence to take to facilities for HVAC work.

**Blocked by:** none (uses the mailer from notifications)

**Status:** ready-for-agent

**GitHub:** #15

- [ ] A pure builder from last month's incidents and Readings to {subject, text, html}, like `notificationEmail.ts`; times and days in the server's zone
- [ ] A monthly job, queued through the outbox (a `report` row) so it retries and shows on Settings like any email; sent once per month even across restarts
- [ ] `NOTIFY_MONTHLY_REPORT=true`, with deploy flag and `info`
- [ ] A "Send last month's report now" button on Settings
- [ ] Each closet links to its History for the month
- [ ] Tests on the builder with a fixed month of data; a seam test that the job sends once

## Open questions

- Who gets it: `NOTIFY_TO`, per-Campus recipients (notifications-2 03), or a separate list for managers?
- Is "ran warm most of the month" a fixed threshold, or warm relative to the other closets?

## Comments

**2026-10-07 — owner decisions (triage).** Sent to `NOTIFY_TO` (no separate list, not per Campus). "Ran warm most of the month" is a fixed threshold: most Readings within a few degrees of that closet's own Hot warning threshold, not relative to other closets.
