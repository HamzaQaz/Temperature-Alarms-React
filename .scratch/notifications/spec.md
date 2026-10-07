---
title: Email technicians when an Incident opens, gets worse, or ends
labels: [needs-triage]
status: open
---

## Problem Statement

The server already decides when a closet is in trouble: it records an Incident the moment a Device reaches a Condition at warning or worse (ADR 0006). But only someone looking at the Dashboard or the Incidents page finds out. A closet that goes Hot at 2 a.m. on a Saturday is read about on Monday morning, which defeats the positioning in PRODUCT.md: "You know a closet is in trouble before the equipment does."

The rebuild spec ruled notifications out of v1 ("The Alarms feature is removed, not rebuilt"). The Incident log now gives a clean, server-decided event to hang them on, so this is the time to add them.

## Solution

When an Incident opens, gets worse (its level rises, e.g. Hot warning to Hot critical), or closes, the server emails a fixed list of recipients through the district's SMTP relay. Owner decisions, 2026-10-06:

- **Channel: email over SMTP.** No Teams, Slack, or webhook in this round.
- **Triggers: every Incident**, Offline and Sensor fault (`.scratch/sensor-fault/`) included, on open and on close. A level change notifies only when it gets worse; a step back down is quiet and shows up in the closing email.

How it behaves:

- **Nothing is lost or sent twice.** The change is written to a `notifications` outbox table in the same transaction that records the Incident change (the one ingest and the Offline sweep already run under the Device's row lock). A separate sender delivers from the outbox and marks each row sent. A restart, a database outage, or an SMTP outage delays an email; it never drops or duplicates one. Delivery retries with backoff for up to 24 hours, then the row is marked failed and the failure is shown on Settings.
- **One email for a burst.** A campus losing power opens twenty Offline incidents within a sweep or two. The sender waits a short coalescing window (60 seconds by default) after the first pending row and sends everything pending as one email, worst first. An incident that opened and closed inside the same window is listed once, as "opened and resolved".
- **The Bench is quiet.** A Device on the Bench Campus (shortcode `BENCH`, CONTEXT.md) is expected to be Offline. Its incidents are still recorded but never emailed.
- **The server's own downtime is not news.** ADR 0006 already keeps a restart or database outage from opening Offline incidents, so no extra rule is needed; the tests prove it.
- **Off unless configured.** With no `SMTP_HOST`, nothing is written to the outbox and the server behaves as it does today. Settings says notifications are off.
- **Readable at a glance.** Subject such as `[Temperature Alarms] CHS IDF 2: Hot critical (91 °F)` for one incident, or `[Temperature Alarms] 3 incidents: 2 Offline, 1 Hot` for a digest. The body gives Campus, Closet, Device, Condition and level, start (and end), the peak Reading, and a link to that Device's History day on `PUBLIC_URL`. Plain text plus a simple HTML part, no images, no tracking.

## User Stories

1. As a technician, I want an email when a closet I look after enters a Condition at warning or worse, so that I can act without watching the Dashboard.
2. As a technician, I want an email when that Incident ends, so that I know I can stand down.
3. As a technician, I want an email when an Incident gets worse, e.g. warning to critical, so that I know it has become urgent.
4. As a technician, I do not want an email each time a closet sitting at a threshold drops back a level, so that my inbox is not noise.
5. As a technician, I want a campus-wide outage to arrive as one email, not twenty.
6. As a technician, I want each email to link to the Device's History for that day, so that I can see what happened in one click.
7. As a technician, I want boards on the Bench to never email me, so that flashing day is not an alarm storm.
8. As an operator, I want to set the SMTP relay and recipients in `.env` through `deploy install` and `deploy`, the same way as the other settings, with the password masked in `info`.
9. As an operator, I want a "Send test email" button on Settings (Admin token) and the last delivery result shown there, so that I can prove the relay works and see when it stops working.
10. As an operator, I want an SMTP outage to delay emails rather than lose them, and to see the failure on Settings.
11. As a developer, I want the decision of what to send (the outbox rows) kept separate from how it is sent (the SMTP sender), so that each can be tested alone and another channel could be added later.

## Implementation Decisions

- **Config** (`backend/src/config.ts`): `SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_SECURE` (`starttls` default, `tls`, or `none`), `SMTP_USER` and `SMTP_PASSWORD` (both optional, both or neither), `NOTIFY_FROM`, `NOTIFY_TO` (comma-separated, at least one address), `PUBLIC_URL` (used for links; required when `SMTP_HOST` is set), and `NOTIFY_COALESCE_SECONDS` (default 60). A half-configured set refuses to start with a clear message, as the token checks do.
- **Library:** `nodemailer`. It is the standard Node SMTP client and handles STARTTLS, auth, and pooling. It is the only new dependency.
- **Outbox** (migration 0011; sensor-fault takes 0010): `notifications(id, incident_id, device_id, kind ENUM('opened','worse','closed'), level, created_at, sent_at NULL, attempts, next_attempt_at, last_error NULL, failed_at NULL)`. `incident_id` is `ON DELETE CASCADE`, so Reset history and retention take pending rows with them. Sent rows are kept 7 days for the Settings status, then deleted by the retention job.
- **Where rows are written:** `incidentStore.ts` already returns `ChangedIncident[]` for both ingest and the sweep. One function, `enqueueNotifications(db, changed)`, runs inside the same transaction, maps `opened` to `opened`, a rising `level` to `worse`, `closed` to `closed`, skips falling levels and Bench Devices, and does nothing when notifications are off.
- **Sender** (`notifier.ts`): one loop in the single backend process (ADR 0001), like the sweep and retention. Each tick it claims due rows with `SELECT … FOR UPDATE SKIP LOCKED`, sends the coalesced email, and marks the rows sent, or bumps `attempts` and `next_attempt_at` (30 s, 1 m, 2 m, … capped at 15 m; failed after 24 h). The email is built by a pure function from the rows plus Incident and Device data, so its content is unit-tested without SMTP.
- **API:** `GET /api/notifications/status` (Admin token) returns enabled, recipients (addresses shown, since the Admin already holds `.env`), the last sent and last failure, and the pending count. `POST /api/notifications/test` (Admin token, rate-limited to one a minute) sends a test email straight away, skipping the outbox, and returns the SMTP result.
- **Frontend:** a Notifications section on Settings with status, recipients, the last result, and "Send test email". No new page.
- **Deploy:** `install` asks for the SMTP settings (all can be left blank to turn notifications off). `--smtp-host` and friends work for non-interactive use. `info` masks `SMTP_PASSWORD`. `.env.example` lists them.
- **Docs:** ADR 0008 (`docs/adr/0008-email-notifications.md`, proposed with this spec), CONTEXT.md gains **Notification**, DEPLOYMENT.md gets an SMTP section (relay, allowed sender, a port-25 note for district firewalls), and README gets a line.

## Testing Decisions

- **API seam with a real MySQL**, as the existing suites do, and an SMTP test server in-process (`smtp-server` as a dev dependency, or nodemailer's stream transport) so delivery is asserted on what actually arrives.
- Covered: an incident opening writes one outbox row and one email arrives. A level rising sends "worse", and a level falling sends nothing. Closing sends "closed". Twenty Offline incidents in one sweep arrive as one email. Opened-and-closed inside the window is listed once. A Bench Device sends nothing. Notifications off writes no rows. SMTP down leaves rows pending, retries, and delivers once it is back, with no duplicates. A restart with pending rows delivers them once. Reset history removes pending rows. Config refuses half-set SMTP. The test endpoint needs the Admin token and is rate-limited.
- **Pure tests** for the email builder: subject for one or many, worst first, links built from `PUBLIC_URL`, °F and % formatting, the Offline peak wording.
- **Deploy tests** in both shells for the new install flags and the masking in `info`.
- **Not automated:** a real district relay. The bench step is the test button on the test server.

## Out of Scope

- Teams, Slack, SMS, webhooks, push. The outbox and the builder are shaped so another sender can be added later, but none is built now.
- Recipients per Campus or per technician, on-call rotations, quiet hours, and acknowledgement or snooze (backlog #4).
- Reminder emails for an Incident that stays open. Revisit after a few weeks of real use.
- Per-Closet thresholds.

## Further Notes

- Ask the district's mail admin whether the relay accepts unauthenticated mail from the server's IP, or needs a service account. That decides whether `SMTP_USER` is set.
- Use a distribution list as `NOTIFY_TO`, so who receives alerts changes in Exchange, not in `.env`.
- Sensor fault incidents (`.scratch/sensor-fault/`) are emailed like any other once that feature lands; nothing here depends on it.
