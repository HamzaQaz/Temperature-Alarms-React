---
status: accepted
---

# Incidents are emailed through an outbox, over SMTP, one email per burst

The rebuild left notifications out ("The Alarms feature is removed, not rebuilt"). Now that the server records Incidents (ADR 0006), a technician should hear about one without watching the Dashboard. The owner decided on 2026-10-06:

- **Email over SMTP**, through the district's relay, to a fixed recipient list (`NOTIFY_TO`, ideally a distribution list). No Teams, Slack, SMS, or webhook in this round.
- **Every Incident, on open and on close**, Offline and Sensor fault (ADR 0009) included. A level change notifies only when it gets worse. Moderate Mold risk is still not an Incident, so it never emails.

## How

- **Outbox, not send-in-place.** The decision to notify is written as a row in `notifications`, in the same transaction and under the same Device row lock that records the Incident change: ingest of a Reading or a fault report, and each Device's pass of the Offline sweep. A sender loop in the one backend process (ADR 0001) delivers due rows and marks them sent. Sending inside the ingest transaction would hold a lock across a network call and either lose the email on a rollback or send it twice on a retry. The outbox makes delivery at-least-once with a mark-sent step. The only duplicate window is a crash between the SMTP accept and the mark, which is accepted.
- **What is queued.** An opening queues `opened`, a close `closed`. A level change queues `worse` only when it takes the incident to a level it has not reached before, so a closet swinging across the Hot critical line emails once on the way up, not on every swing; a fall is quiet and shows in the closing email. An Offline stretch that ingest records already closed (the Device was back before the sweep saw it, ADR 0006) queues both, and is emailed once as "opened and resolved".
- **Claimed under a lock, at read committed.** Each pass of the sender (every 5 s) takes the due rows with `SELECT … FOR UPDATE SKIP LOCKED` and holds them until it has sent the email and marked them, in one transaction. The transaction runs at read committed so it locks only the rows it took and never the index gaps ingest inserts new rows into: a slow relay holds up no Reading. A pass cut short (a crash, a restart) rolls back, and its rows go out from the next one.
- **Retry, then give up visibly.** Backoff 30 s, doubling, capped at 15 min; a row queued a day ago that fails again is marked failed. The last failure, and how many were given up on in the last week, are shown on Settings. An SMTP outage delays mail; it does not drop it.
- **Coalesce.** The sender waits `NOTIFY_COALESCE_SECONDS` (60) after the oldest due row and sends every due row as one email, worst first, so a campus power cut is one email. Rows queued while it waits go with it, so a burst that keeps arriving still sends each row within two windows of being queued. A retry goes at once, its batch having waited already. One email carries at most 200 rows; the rest go in the next pass. An incident with several rows in one batch is listed once, as it stands when the email is built.
- **What the email says.** A pure builder (`notificationEmail.ts`) turns the rows, with their Incident and Device as they stand at send time, into a subject, plain text, and a simple HTML part, everything escaped, no images, nothing loaded. One incident: `[Temperature Alarms] CHS IDF 2: Hot critical (91 °F)`, with `, got worse`, `, resolved`, or `, opened and resolved` after the level when that is the news. Several: `[Temperature Alarms] 3 incidents: 2 Offline, 1 Hot`, with `(1 resolved)` or `(all resolved)` when some ended. Each entry gives Campus, Closet, Device, the Condition and level, the start (and, once it ended, the end and how long), the peak Reading (the last Reading before the silence for Offline, the last good one for Sensor fault), and a link to that Device's History on the day it started (`PUBLIC_URL/history/<id>?date=YYYY-MM-DD`). Times are written in the server's time zone, named in each one.
- **The Bench is silent.** Devices on the `BENCH` Campus (in any case) are expected to be Offline; their incidents are recorded but not queued.
- **Off unless configured.** No `SMTP_HOST`, no rows, and no sender. A half-configured set refuses to start.
- **The SMTP password never goes on a command line.** The deploy scripts refuse `--smtp-password`; it comes from a hidden prompt, or the first line of stdin with `--yes`, and over `--host` it travels on ssh's stdin. It is written to `.env` single-quoted (`SMTP_PASSWORD='...'`) so Compose reads it literally, and a password holding a single quote is refused. `info` masks it whole, not first and last four. `--smtp-host off` empties the whole group, since any of it left without `SMTP_HOST` stops the api. Compose passes all nine variables as `${KEY:-}`.
- **The server's downtime is already handled** by ADR 0006's "heard since" rule, so a restart or database outage opens no Offline incidents and sends no email. A restart also continues an open incident without emailing it again: it lives in its row.

## Consequences

- One new dependency, `nodemailer`.
- The email builder and the queueing rules (`outbox.ts`) are pure, so content is unit-tested without SMTP, and another channel could reuse the outbox later.
- Recipients are global. Recipients per Campus, quiet hours, reminders for long incidents, and acknowledgement are left for later.
- Sent and failed rows are kept 7 days for the Settings status, then removed by the retention job; pending rows cascade with their Incident and their Device, so Reset history takes them too. The status (pending, given up, last sent with its subject, last failure) is read from the rows, so it survives a restart. The Settings test email skips the outbox, so its own result is kept by the running process only.
- Rows record `level`, `attempts`, `last_attempt_at`, `last_error`, and the `subject` they were sent under, beyond the columns first sketched, so Settings can say what went out and when the relay last failed.
- A row queued while the sender could not run at all (the backend down for days) is still tried when it returns; if that try fails, it is given up at once, being past its day.
