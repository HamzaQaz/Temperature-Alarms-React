# 03 — Recipients per Campus

**What to build:**
Each Campus can name its own recipients, so a campus's technicians get only their campus's mail. `NOTIFY_TO` stays the default for any Campus without its own list, and can be told to receive everything.

**Blocked by:** none

**Status:** ready-for-agent

**GitHub:** #13

- [ ] Migration: `campuses.notify_to` (comma-separated addresses, empty: use `NOTIFY_TO`)
- [ ] Campus editor on Settings gains the field, checked with the same address rule as `config.ts`
- [ ] The sender groups due rows by recipient list: one email per list per pass, each still coalesced and worst first; a row is marked sent only when its own email went
- [ ] `NOTIFY_TO_ALL=true` (or similar) keeps the global list on every email, for a district office that wants all of it
- [ ] Settings status shows the last result per list
- [ ] Tests: two Campuses, two lists, one outage each, two emails; a failing list retries without resending the other

## Open questions

- Should recipient lists live in the database (editable on Settings) or `.env` (set at deploy)? Database is friendlier; `.env` keeps addresses out of backups.

## Comments

**2026-10-07 — owner decisions (triage).** Recipient lists live in the database, edited on Settings (not `.env`).
