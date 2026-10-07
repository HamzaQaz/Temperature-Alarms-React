# 01 — Acknowledge an incident

**What to build:**
A technician who has seen an incident marks it "on it", so the team knows someone owns it. The acknowledgement shows on the Device card, in the Incidents log, and in any later email about that incident (worse, closed, reminder). It stops reminders (02) but never stops the closing email.

**Blocked by:** none

**Status:** done

- [x] Migration: `incidents.acknowledged_at` and `incidents.acknowledged_by` (a short free-text name or note; there are no user accounts, only the Admin token)
- [x] `POST /api/incidents/:id/acknowledge` (Admin token), idempotent; an ended incident cannot be acknowledged
- [x] The stream sends the change, so every open Dashboard updates without a reload
- [x] Card: "Acknowledged by Sam, 10 min ago" under the Condition badge, styled per DESIGN.md. Incidents log: the same in the row's facts
- [x] `notificationEmail.ts` names the acknowledgement in later emails about the incident
- [x] An acknowledgement link in the email? See open questions
- [x] Tests at the HTTP seam; ADR (or an addendum to 0008) and CONTEXT.md gain **Acknowledgement**

## Open questions

- Should the email carry a one-click acknowledge link? It would need a signed, single-use token in the URL, since the email reader has no Admin token. Safer first round: the link opens the Dashboard, where the Admin acknowledges.
- Free-text name, or a fixed list of technicians kept in Settings?
- Does a level rising after acknowledgement clear it (someone is on it, but it got worse)?

## Comments

**2026-10-07 — built by an agent; awaiting review.** ADR 0008 (new "Update 2026-10-07: Acknowledgement"); CONTEXT.md, **Acknowledgement**.

**What was built.** Migration `0012-incident-acknowledgement` adds `incidents.acknowledged_at` (DATETIME) and `acknowledged_by` (VARCHAR(60)), both NULL until given, guarded so a run that died before being recorded repeats cleanly. `POST /api/incidents/:id/acknowledge` (Admin token) takes `{by}`, parsed by `acknowledgementInput.ts`: trimmed, 1 to 60 characters counted as characters (not bytes), no control characters or text-reordering marks (422 otherwise). One conditional `UPDATE` records it only on an open, unacknowledged incident, so the first acknowledgement stands under a race and a close racing it wins; the answer is the incident as `/api/incidents` sends it (200), a repeat answers 200 with the first acknowledgement and sends nothing on the stream, an ended incident is 409, an unknown or malformed id 404. A new acknowledgement is broadcast as `{type: 'incident', change: 'acknowledged', incident}`. Every incident payload (log, stream) gains `acknowledgement: {by, at} | null`; `GET /api/dashboard` gains `openIncidents` per Device (`{id, condition, level, start, acknowledgement}`, oldest first), so a card can say who is on it. The notifier reads the acknowledgement at send time and `notificationEmail.ts` adds "Acknowledged by Sam at <time>" to the entry (after the start, or the end once resolved), escaped in the HTML; the subject is unchanged. Frontend: `AcknowledgeLine` shows "Acknowledged by **Sam**, 10 min ago" under the Condition badges on the card (UserCheck icon, Dimmed Grey, the name in Readout White medium, no signal colour), and "Acknowledged by **Sam** at 2:10 AM" in the Incidents row's facts; in a browser holding the Admin token, an open unacknowledged incident shows a ghost "Acknowledge" that opens a small field ("Who is on it? A name, or a short note") with outline Acknowledge and ghost Cancel, validated as the server does. The Dashboard applies every incident message from the stream to its cards (`lib/acknowledgement.ts`, `applyIncident`: open ones take their place, closed ones leave), and both pages apply the server's answer at once. README, DESIGN.md, CONTEXT.md and ADR 0008 updated.

**Decisions beyond the ticket.** Decided by the coordinator, open to the owner: no one-click acknowledge link in the email (emails keep linking to the Device's History; acknowledging needs the Admin token in the app); `acknowledged_by` is free text, a name or short note, 1 to 60 characters, trimmed, no control characters; an acknowledgement is not cleared when the level rises (or at the close), and worse and closed emails still send, naming who acknowledged; an Admin-only button on the card and the Incidents row, with a small input for the name. Mine: the first acknowledgement stands and a second name is not recorded (a repeat is idempotent, not an overwrite); text-reordering marks (bidi embeddings, overrides, isolates) are refused with the control characters, since the name goes into emails; the time is stored to the second, as the incident's own times are. With two incidents open on one card, each line names its Condition ("Hot: acknowledged by Sam"). The card's age is by the browser's clock against the server's `at`, clamped at zero, as the Incidents page already does for durations. The browser remembers the last name it acknowledged with (localStorage, per viewer) to fill the field next time. A refused Admin token is forgotten and the field says to save it again in Settings, as History does. The Incidents log announces an acknowledgement to screen readers and gives it no wash: someone being on it is not a change of state. Campuses still reloads on any incident message, acknowledgements included (rate-limited to once per 10 s already).

**Tested.** `backend/test/acknowledgement.test.ts` (12) at the HTTP seam and on the parser: recorded and trimmed, shown by the log; needs the Admin token; 422 cases (empty, blank, non-string, 61 characters, a line break, a bidi override) and 60 accented characters accepted; idempotent with no stream message on a repeat; 409 once ended, 404 for unknown and malformed ids; the stream reaches two open dashboards; a level rising keeps it; the Dashboard's `openIncidents` carries it and drops the incident once it ends; the worse and closing emails through a test relay name who acknowledged, and the opening one does not; the columns hold what the API returned. `notificationEmail.test.ts` gains the line in both parts, escaped. Frontend `lib/acknowledgement.test.ts` (6): `applyIncident` (acknowledged, opened in order, level, closed, replay, no card), the age, and the client-side name check. Seen in a browser (Playwright on a demo server over the test database, dark theme, 1280 px and 375 px): the card line, the form, the acknowledged state, the Incidents row, and a second Dashboard updating live without a reload when another client acknowledged.

**Untested.** The light theme and forced colours by eye; a screen reader on the form and the log's announcement; touch sizing on a real phone; two people acknowledging the same incident at the same instant from two browsers (covered only by the single conditional `UPDATE`); the email line in real mail clients.

**Verified 2026-10-07** on the test MySQL 8.4: backend typecheck (test and production) clean, `npm test` 395/395; frontend lint, typecheck, `npm test` 79/79, build clean. Not committed.

**2026-10-07 — reviewed and verified by the coordinator.** Eight review findings, all checked against the code and all real; all applied.

*Applied.*
- A late acknowledgement brought a closed incident back (two findings, one fix). An acknowledge answer or `acknowledged` stream message read just before a close could land after the `closed` message and put the ended incident back on the card ("Acknowledged by Sam" with no Condition, until a reload) or set its log row back to ongoing. `applyIncident` gains `{opens: false}`, which only updates an incident the card already holds. The Dashboard uses it for `change: 'acknowledged'` and for the POST answer (`acknowledgeOnCards`). The new `replaceIncident` keeps a log row that already holds an end when the newer payload is still open, since an incident never reopens. The Incidents page uses it both for the answer and for stream changes. Tests added for both.
- The acknowledgement time in the 7-day window had no day. `AcknowledgeLine` takes a `day` prefix, and the Incidents row passes `formatDayShort(...)` in week view when the acknowledgement's day differs from the start's, as the end time does ("at Tue, 7:05 AM").
- Invisible text-reordering characters were typed literally in the frontend (two findings, one fix). `lib/acknowledgement.ts` and its test now use `\u` escapes, as the backend does. A scan of the touched trees finds no literal bidi or separator characters left.
- The ADR said acknowledging happens on History. The addendum now says emails link to History, and acknowledging is done from the Dashboard card or the Incidents log.
- A repeat after the end answered 200, not the documented 409. `acknowledgeIncident` now answers `ended` whenever the incident has ended, even if it was acknowledged before, so a stale tab reads that it has ended. A new HTTP test covers it; README and the ADR addendum say so.
- U+2028 and U+2029 were accepted. These line and paragraph separators are now refused on both sides (`\p{Zl}\p{Zp}`), with cases in the HTTP 422 test, the parser test and the frontend `acknowledgerError` test. README and ADR wording updated.

*Rejected.* None.

*Checks.* Backend: typecheck (test) and production `tsc --noEmit` clean; `npm test` 396/396. Frontend: lint, typecheck and build clean; `npm test` 81/81. Not run, since nothing in deploy/ or arduino/ changed: the deploy tests, shellcheck and the bench tests. Not re-checked in a browser after these fixes; the day prefix and the race guard are covered by unit tests and the typecheck only. Not committed.
