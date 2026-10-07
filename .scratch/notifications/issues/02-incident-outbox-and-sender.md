# 02 — Incidents write to an outbox; a sender delivers it

**What to build:**
Every Incident that opens, gets worse, or closes leaves a row in a `notifications` outbox, in the same transaction that records the change. A sender loop delivers due rows by email and marks them sent, retrying with backoff. Nothing is lost or sent twice across a restart, a database outage, or an SMTP outage. This ticket sends one email per row; coalescing is 03. See the spec's Outbox, Where rows are written, and Sender.

**Blocked by:** 01

**Status:** done

- [x] Migration 0011 (sensor-fault has 0010): the `notifications` table, cascading with its Incident and Device
- [x] `enqueueNotifications(db, changed)` is called from ingest and the Offline sweep inside their existing transactions: opened→`opened`, rising level→`worse`, closed→`closed`. A falling level, a Bench Device (Campus shortcode `BENCH`), and notifications being off write nothing
- [x] `notifier.ts`: one loop in the backend process. It claims due rows with `FOR UPDATE SKIP LOCKED`, sends, and marks them sent. On failure it backs off (30 s doubling, capped at 15 min) and marks them failed after 24 h. Started and stopped with the sweep in `index.ts`
- [x] Retention deletes sent and failed rows older than 7 days. Reset history removes a Device's pending rows (cascade)
- [x] The status endpoint reports the real pending count, last sent, and last failure
- [x] Tests: open, worse, falling (nothing sent), close. Bench Devices stay silent, and nothing is written while notifications are off. SMTP down then up delivers once. A restart with pending rows delivers once. ADR 0006's restart and outage cases produce no email

## Comments

**2026-10-06 — built, by a supervised worker; awaiting review.** Spec: `.scratch/notifications/spec.md` (Outbox, Where rows are written, Sender); ADR 0008, now accepted.

**What was built.** Migration 0011 adds `notifications`: the spec's columns plus `last_attempt_at` and `subject`, times to the millisecond, cascading with its Incident and its Device. The rules are pure in `outbox.ts` (what a change queues, backoff, give-up, when a batch is ready); `outboxStore.ts` has `enqueueNotifications(db, changed, at)`, the status, and the retention delete. Ingest calls it inside its transaction for Readings and fault reports alike, and `sweepOffline` per Device inside its own (a new `notify` argument, set by `runOfflineSweep` when notifications are on). `ChangedIncident` gains `created`, so an Offline stretch ingest records already closed queues `opened` and `closed`. `notifier.ts` is the sender: every 5 s it claims due rows with `FOR UPDATE SKIP LOCKED` at read committed, sends, and marks them sent with the subject, or records the error and pushes `next_attempt_at` out (30 s doubling, 15 min cap, failed once a day old). `index.ts` makes one mailer for the routes and the sender and starts the sender beside the sweep when notifications are on. Retention deletes sent and failed rows older than 7 days. `GET /api/notifications/status` reads pending, `failed` (new: given up within the week), last sent, and last failure from the outbox; Settings shows the pending and given-up counts.

**Decisions beyond the ticket.** "Worse" means a level the incident has not reached before: Hot warning to critical emails once, not on every swing back across the line. The claim holds its rows in one read-committed transaction across the send, rather than a lease, so it never gap-locks the inserts ingest makes and a crash simply rolls back. The Settings test email still skips the outbox, so its result is kept by the running process only and merged with the outbox's by time. A row queued while the sender was down for days is still tried; if that try fails it is given up at once. A pass whose send throws something other than a relay error rolls back without counting a try. Bench is matched in any case.

**Untested.** A real relay and a real outage of one; the backend's own process restart (tested as a new app instance and a fresh mailer on the same database). Two senders against one database (SKIP LOCKED should keep them apart; there is one process). A crash between the relay taking an email and the mark, which sends it twice, as ADR 0008 accepts.

**Verified 2026-10-06** on a fresh MySQL 8.4: backend typecheck clean and `npm test` 382/382 (`notifier.test.ts` 27, `notificationEmail.test.ts` 11); frontend lint, typecheck, `npm test` 73/73, and build clean. Not committed.

**2026-10-06 — verified by the coordinator** with every ticket of both features in place, on a fresh MySQL 8.4: backend typecheck (test and production) clean, `npm test` 382/382; frontend lint, typecheck, `npm test` 73/73, build clean; deploy tests pass in Git Bash, pwsh 7, and Windows PowerShell 5.1; shellcheck 0.11 clean; `arduino/test_bench.py` 56/56. Not committed.
