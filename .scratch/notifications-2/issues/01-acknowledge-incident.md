# 01 — Acknowledge an incident

**What to build:**
A technician who has seen an incident marks it "on it", so the team knows someone owns it. The acknowledgement shows on the Device card, in the Incidents log, and in any later email about that incident (worse, closed, reminder). It stops reminders (02) but never stops the closing email.

**Blocked by:** none

**Status:** needs-triage

- [ ] Migration: `incidents.acknowledged_at` and `incidents.acknowledged_by` (a short free-text name or note; there are no user accounts, only the Admin token)
- [ ] `POST /api/incidents/:id/acknowledge` (Admin token), idempotent; an ended incident cannot be acknowledged
- [ ] The stream sends the change, so every open Dashboard updates without a reload
- [ ] Card: "Acknowledged by Sam, 10 min ago" under the Condition badge, styled per DESIGN.md. Incidents log: the same in the row's facts
- [ ] `notificationEmail.ts` names the acknowledgement in later emails about the incident
- [ ] An acknowledgement link in the email? See open questions
- [ ] Tests at the HTTP seam; ADR (or an addendum to 0008) and CONTEXT.md gain **Acknowledgement**

## Open questions

- Should the email carry a one-click acknowledge link? It would need a signed, single-use token in the URL, since the email reader has no Admin token. Safer first round: the link opens the Dashboard, where the Admin acknowledges.
- Free-text name, or a fixed list of technicians kept in Settings?
- Does a level rising after acknowledgement clear it (someone is on it, but it got worse)?

## Comments
