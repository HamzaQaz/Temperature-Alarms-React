# 02 — Reminders for long incidents

**What to build:**
An incident still open and unacknowledged after `NOTIFY_REMIND_HOURS` (say 4) emails once more, then again every `NOTIFY_REMIND_HOURS`, so a closet hot all weekend is not forgotten after the first email. ADR 0008 left reminders for later.

**Blocked by:** 01 (an acknowledgement stops reminders)

**Status:** needs-triage

- [ ] `NOTIFY_REMIND_HOURS` in `config.ts` (empty or 0: off), passed by Compose, set by `deploy install --notify-remind-hours`, shown by `info`
- [ ] The Offline sweep (or a sibling pass) queues a `reminder` row in the outbox for each open, unacknowledged incident past its next reminder time, under the same Device row lock; `incidents.last_reminded_at` keeps it from queuing twice
- [ ] Bench Devices stay silent, as in ADR 0008
- [ ] Reminders coalesce with everything else; subject `[Temperature Alarms] Still open: CHS IDF 2 Hot critical, 6 h`
- [ ] Tests: queued once per period, not after acknowledgement, not after close, not on restart (the period counts from the incident, not the process)

## Open questions

- One period for every level, or sooner for critical?
- A cap on reminders per incident (an unplugged board on the Bench of a closed school)?

## Comments
