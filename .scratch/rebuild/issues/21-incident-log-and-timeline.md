# 21 — Incident log and the Incident timeline

**What to build:**
A technician opens Incidents first thing in the morning and reads what happened overnight. Each incident shows its Device, its Condition and peak level, the start, the end (or "ongoing"), and the duration, plus a link to that day's History. Under the list sits a shared overnight ruler that shows each incident as a span, so overlaps and the worst stretch of the night are visible at a glance. The direction is the comp `.scratch/design/comps/incidents.html`; PRODUCT.md names the technicians' morning job.

**Blocked by:** 20 — Review every ticket, and deploy in one step

**Status:** needs-triage

- [ ] The backend records an incident when a Device's Condition reaches warning or worse. It records each level change and the end, along with the peak Reading. The server decides every one of these: the incident rules live beside the Condition rules, never in the browser (PRODUCT.md, "The server decides, the browser shows")
- [ ] An incident that is open when the server restarts is neither lost nor duplicated. An Offline incident starts when the server declares the Device Offline
- [ ] `GET /api/incidents?from&to` returns the incidents that overlap a window, oldest first, each with its level segments. Retention follows ADR 0004, or a decision recorded in a new ADR
- [ ] An Incidents page in the sidebar shows the Overnight, Today, and 7 days windows, with previous and next. It has a one-sentence summary, the log, and the ruler. A new incident arrives live over the existing stream
- [ ] The demo (`backend/scripts/demo.mjs`) produces incidents, so the page has content without hardware
- [ ] Tests at the API seam: an incident opens, changes level, closes, survives a restart, and an Offline incident opens and closes

## Open questions for triage

- Is moderate Mold risk an incident, or only a heads-up? The comp counts warning and worse only.
- Should a short blip (one Reading over the threshold) open an incident, or is a minimum duration needed?
