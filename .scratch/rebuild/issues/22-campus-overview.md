# 22 — Campus overview for IT leadership

**What to build:**
IT leadership opens Campuses and sees the district in one look: one row per Campus, worst first. Each row shows the Conditions it is in now with their counts, the worst closet and its Reading, a 7-day chart of each day's highest temperature against the Hot warning line, and the time since the last incident. A one-sentence summary sits above the table, with no headline tiles. The direction is the comp `.scratch/design/comps/campuses.html`; PRODUCT.md names IT leadership as the second audience.

**Blocked by:** 21 — Incident log and the Incident timeline

**Status:** needs-triage

- [ ] `GET /api/campuses/overview` returns, for each Campus: counts per Condition now, the worst Device with its latest Reading, each of the last 7 days' highest Reading with whether that day held an incident, and the end of the last incident. The server computes all of it, so the browser totals nothing it cannot see
- [ ] A Campuses page in the sidebar shows the summary sentence, the table (stacked rows on phones), and the footnote naming the threshold the server uses. A new Reading updates its row live, using the Reading-landed wash
- [ ] The 7-day chart is a small labelled column chart, documented in DESIGN.md's Charts section as a new chart type
- [ ] The demo covers it: the four demo Campuses show a mix of calm, ongoing, and recent incidents
- [ ] Tests at the API seam for the overview, including a Campus with no Devices and a Campus with no incident in 90 days
