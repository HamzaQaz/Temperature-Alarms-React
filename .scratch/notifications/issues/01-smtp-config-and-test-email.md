# 01 — SMTP settings and a test email from Settings

**What to build:**
The thinnest end-to-end slice. The operator sets the SMTP relay and recipients in `.env`, opens Settings, presses "Send test email", and gets the email. This proves the relay, the config, and the Admin-token route before any Incident logic is added. See `.scratch/notifications/spec.md`, Implementation Decisions (Config, API, Frontend).

**Blocked by:** none

**Status:** done

- [x] `config.ts` reads `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`/`SMTP_PASSWORD`, `NOTIFY_FROM`, `NOTIFY_TO`, `PUBLIC_URL`, and `NOTIFY_COALESCE_SECONDS`. Without `SMTP_HOST`, notifications are off. A half-set group (user without password, host without recipients, host without `PUBLIC_URL`, a bad address) refuses to start with a clear message
- [x] `nodemailer` added, and a small `mailer.ts` behind an interface so tests can swap the transport
- [x] `POST /api/notifications/test` (Admin token, one a minute) sends a test email now and returns the SMTP result. `GET /api/notifications/status` (Admin token) returns enabled, recipients, last sent, last failure, and the pending count (0 until 02)
- [x] A Notifications section on Settings: on or off, recipients, the last result, and the "Send test email" button, styled per DESIGN.md
- [x] Tests at the HTTP seam against an in-process SMTP server: the test email arrives, the Admin token is required, the rate limit holds, the config refusals fire, and status reads correctly when off

## Comments

**2026-10-06 — built, by a supervised worker; awaiting review.** Spec: `.scratch/notifications/spec.md` (Config, API, Frontend); ADR 0008 (proposed).

**What was built.** `config.ts` reads the notification group into `config.notifications`, undefined (off) without `SMTP_HOST`. With it, `NOTIFY_FROM`, `NOTIFY_TO` (comma-separated, at least one), and `PUBLIC_URL` (http or https, kept without its trailing slash) are required; `SMTP_USER` and `SMTP_PASSWORD` go together; `SMTP_SECURE` is `starttls` (default), `tls`, or `none`; `NOTIFY_COALESCE_SECONDS` defaults to 60. A half-set group throws one `ConfigError` naming every problem, never the password. `nodemailer` 10 is the only new runtime dependency (it ships its own types, so no `@types/nodemailer`); `smtp-server` and `@types/smtp-server` are dev dependencies. `mailer.ts` is the `Mailer` interface (`send(email)`) and `createMailer`, the SMTP one: one connection per email, 10 s to connect, and a `MailerError` whose message has the password and its AUTH encodings masked. `createApp` makes it when notifications are on; `AppDeps.mailer` lets a test pass its own. `routes/notifications.ts`: `GET /api/notifications/status` and `POST /api/notifications/test`, both behind the Admin token. The test sends now, skipping the outbox, and returns `{ sentAt, accepted, rejected, response }`; 409 when off, 502 with the relay's reason when it fails, 429 after one a minute. The status gives `enabled`, `relay` (host, port, security), `from`, `recipients`, `lastSent`, `lastFailure`, and `pending: 0`; the last results are kept in memory until 02 reads them from the outbox. Settings has a Notifications tab: on or off (and what turns it on), the relay, sender and recipients, the last send and last failure, and "Send test email" (outline), with the relay's reply in the status line. The phrasing lives in `frontend/src/lib/notifications.ts`, unit-tested. `backend/.env.example` lists the variables, commented.

**Decisions beyond the ticket.** `SMTP_PORT` defaults to 465 with `SMTP_SECURE=tls` (587 otherwise), since implicit TLS on 587 would fail confusingly. `starttls` sets nodemailer's `requireTLS`, so a relay that offers no STARTTLS is refused rather than sent to in plain text (tested). `NOTIFY_FROM` is required, and must be a bare address, like each of `NOTIFY_TO`. `NOTIFY_TO`, `NOTIFY_FROM`, `SMTP_USER`, or `SMTP_PASSWORD` set without `SMTP_HOST` refuses to start, as a half-set group; the port, security, and window may sit at their defaults. The one-a-minute limit is one allowance for the whole server, not per address (every press emails every recipient), and is spent only by a request with the right token while notifications are on. The status shows the relay and addresses, never the password. The Settings tab list scrolls sideways on a phone now that it holds five tabs.

**Untested.** A real district relay, STARTTLS or implicit TLS against a real certificate (the test relay is plain SMTP), and the 10 s connect timeout against a relay that drops packets. The root `.env.example` and Compose do not pass the variables to the api container yet: ticket 04. The Settings tab was checked by screenshot at 1280 and 375 px against a mocked API, not against the real backend.

**2026-10-06 — verified by the coordinator.** Combined with the other ticket in progress at the same time, on a fresh MySQL 8.4: backend typecheck clean and `npm test` 344/344; frontend lint, typecheck, `npm test` 65/65, and build clean. Not committed.
