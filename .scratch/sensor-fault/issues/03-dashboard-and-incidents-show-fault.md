# 03 — Dashboard, Incidents, and demo show Sensor fault

**What to build:**
A technician sees "Sensor fault" on the card, with the last good Reading kept but marked stale, and the Incidents page names and colours it. The demo has one, so the page has content without hardware. See the spec's Frontend.

**Blocked by:** 01

**Status:** done

- [x] Card: the Sensor fault label and critical styling per DESIGN.md. The last good Reading is greyed, with "last good Reading 14 min ago". The status line counts from the last report
- [x] The Incidents log, ruler, and summary sentence name Sensor fault in its colour, and the legend includes it
- [x] The Campus overview counts it like other critical incidents
- [x] `demo.mjs` gives one Device an hour of Sensor fault in the backfilled week and replays it
- [x] Frontend lint, typecheck, test, and build pass. Checked in the browser on the demo, in light and dark

## Comments

**2026-10-06 — built by an agent; status left as is for the coordinator.** Spec: `.scratch/sensor-fault/spec.md`, Frontend; ADR 0009.

**What was built.** The card: Sensor fault arrives among the Condition badges as any critical Condition does (Critical Fill badge, Critical Red border, the escalation trace from the badge), the last good Reading stays in place greyed like an Offline card's, with "Last good Reading 14 min ago" under it, and the footer (age, "Next in"/"Expected … ago", the report hairline) counts from `lastReportAt`, so a faulting board reads on time. The stream's `fault` message is handled (`onFault` in `use-reading-stream.ts`): `applyFault` (`lib/faultReport.ts`) takes the server's Online, Conditions and last report, and keeps the last good Reading ageing (moved to the new anchor by whole seconds, so a run of fault reports never wears it down); under worst first a change of worst level asks the server again and the card rises, as for a Reading. The Incidents page: a Sensor fault span is Fault Violet on the ruler, a legend in the log card names each colour the window's spans are drawn in (`rulerKinds`, `lib/incidentWindow.ts`), and the row's facts say "No Readings from 12:35 PM to 1:35 PM: the board was online but its sensor was not answering" once it has ended (the ongoing wording stays). The Campuses page reloads on fault messages too, and a worst closet in Sensor fault shows a dash and "Sensor fault, last good Reading 2 min ago", as an Offline one does; the counts, the 7-day column and "since last incident" needed nothing, since the server already counts it as critical. `demo.mjs`: CRMS IDF 4 (Band Hall) has an hour of fault reports three days back (no Readings, so a gap in History) and its Sensor fault incident is replayed with the backend's own `applyFaultReport` (`replayReports`, the same walk as `replayIncidents`); live, it sends fault reports from 360 to 570 s of each ten-minute loop, Sensor fault from the third. DESIGN.md records Fault Violet and the legend.

**Decisions.** (1) Sensor fault keeps the critical look everywhere the level speaks (badge, border, trace, Campuses column) and has its own colour only on the ruler and its legend, where a hot closet and an unwatched one would otherwise be the same red span. Violet, as no other signal uses it and it stays apart from red and amber for colour-blind readers; it is never text. (2) The summary sentence names it in words, without colour: a coloured word would be a signal colour on text, against the One Meaning and contrast rules. (3) No Reading-landed wash on a fault report: no Reading landed; the hairline restarting shows the board spoke. (4) The legend lists only what the window's ruler shows, so it never names a colour that is not there. (5) DESIGN.md's Device card line still says the footer shows "the age of the last Reading"; it is now the last report. Left alone, as only the Condition colour was in scope here.

**Tests.** `lib/faultReport.test.ts` (applying a fault report, no drift over 30 reports, stale and unknown events, `formatStaleAge`) and `rulerKinds` in `lib/incidentWindow.test.ts`. Frontend lint, typecheck, `npm test` 73/73 (with the notifications work in progress beside it), and build clean; backend typecheck clean. On the demo (project `ta-fault03`, port 8100, torn down after) in Chromium through Playwright, light and dark, 1440 and 375 px, no horizontal scroll on Dashboard, Incidents (7 days) and Campuses: screenshots in `.scratch/sensor-fault/shots/`. The backfilled Sensor fault incident (59 min, critical, peak the last good Reading) shows on the 7-day ruler beside the live one. With the dashboard loaded once (By Campus, so no reorder refetch), the card took Sensor fault on the third fault message ("Last good Reading 1 min ago", footer at 0s) and cleared on the next Readings, with no page reload; the one `/api/dashboard` refetch in that run was the silent closet going past Offline, earlier in the loop.

**Untested.** Real hardware (firmware 5 is ticket 02). Reduced motion and forced colours were not looked at in a browser. Not committed.

**2026-10-06 — verified by the coordinator** with every ticket of both features in place, on a fresh MySQL 8.4: backend typecheck (test and production) clean, `npm test` 382/382; frontend lint, typecheck, `npm test` 73/73, build clean; deploy tests pass in Git Bash, pwsh 7, and Windows PowerShell 5.1; shellcheck 0.11 clean; `arduino/test_bench.py` 56/56. Not committed.
