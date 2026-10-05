# 22 — Campus overview for IT leadership

**What to build:**
IT leadership opens Campuses and sees the district in one look: one row per Campus, worst first. Each row shows the Conditions it is in now with their counts, the worst closet and its Reading, a 7-day chart of each day's highest temperature against the Hot warning line, and the time since the last incident. A one-sentence summary sits above the table, with no headline tiles. The direction is the comp `.scratch/design/comps/campuses.html`; PRODUCT.md names IT leadership as the second audience.

**Blocked by:** 21 — Incident log and the Incident timeline

**Status:** done

- [x] `GET /api/campuses/overview` returns, for each Campus: counts per Condition now, the worst Device with its latest Reading, each of the last 7 days' highest Reading with whether that day held an incident, and the end of the last incident. The server computes all of it, so the browser totals nothing it cannot see
- [x] A Campuses page in the sidebar shows the summary sentence, the table (stacked rows on phones), and the footnote naming the threshold the server uses. A new Reading updates its row live, using the Reading-landed wash
- [x] The 7-day chart is a small labelled column chart, documented in DESIGN.md's Charts section as a new chart type
- [x] The demo covers it: the four demo Campuses show a mix of calm, ongoing, and recent incidents
- [x] Tests at the API seam for the overview, including a Campus with no Devices and a Campus with no incident in 90 days

## Comments

**2026-10-04 — done, by supervised Orca workers; reviewed in round 3.** Specs: `.scratch/rebuild/reviews/tasks/t22-backend-overview.md` and `t22-frontend-campuses.md`. Review: `.scratch/rebuild/reviews/round3.md`.

**What was built.** `GET /api/campuses/overview?tz=` lists every Campus worst first, then by name. For each one, all from the server's Condition rules: `now` counts at warning or worse, with moderate Mold risk counted apart as a heads-up; `worst` is the worst closet and its latest Reading; `days` covers the last 7 local days, each with the highest temperature, `incident`, and `incidentLevel`, the worst level an incident reached that day from its segments; `lastIncident` is ongoing with its start, or the latest end within 90 days, or null; and `threshold` is the Hot warning line. It takes a fixed handful of statements however many Campuses there are. The completed days' highs are cached for 5 minutes, for at most 8 zones. The Campuses page in the sidebar has a summary sentence, no tiles, and the table: Campus link, Condition badges with counts, worst closet linked to its History today, the 7-day column chart, and "since last incident" linked to Incidents. Under the table is a footnote naming the threshold and the retention window. On phones each row is a stacked card. Live Readings and incidents reload it at most once per 10 s, and a changed row takes the wash. DESIGN.md's Charts section documents the column chart.

**Decisions.** The field is `lastIncident` (`{ongoing, start}` or `{ongoing: false, end}`) rather than the spec's `lastIncidentEnd`, so an ongoing incident can carry its start. Chart columns take the signal colour of the worst level that day (round 3, the One Meaning Rule), not amber for every incident day. Each row's chart has its own scale; the figures carry the comparison across rows. Never-reported Devices count as Offline, as on the Dashboard.

**Untested.** The district's real size. Measured on the demo (24 Devices, 479k Readings): the uncached 7-day maximum takes 0.88 s. Extrapolated to about 100 Devices, that is roughly 3.5 s every 5 minutes, plus up to 0.5 s per request for today. That is acceptable for this page; if it is not in practice, a daily-high rollup is the next step. The 7-day highs can lag by up to 5 minutes after a Reset history.
