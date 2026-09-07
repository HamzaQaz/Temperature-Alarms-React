# 08 — Conditions

**What to build:**
Every card shows which Conditions its latest Reading is in: Hot, Cold, Dry, Mold risk, Offline, each with a level. The card border reflects the worst active Condition and the summary tile counts Devices with any warning or worse. All rules live on the server in one module; the browser computes nothing.

**Blocked by:** 07 — Dashboard from the readings table

**Status:** done

- [x] A pure Conditions module takes the latest Reading and seconds since it arrived and returns a list of `{name, level}`
- [x] Thresholds live in one configuration object with defaults: Hot warning at 82 °F, Hot critical at 90 °F, Cold warning at or below 50 °F, Dry warning at or below 20 percent, Mold risk unchanged from the existing rule with moderate and high, Offline after three Report intervals
- [x] Worst-level ordering is critical, high, warning, moderate
- [x] Unit tests cover one unit either side of every threshold, null Reading, exactly three missed intervals, multiple Conditions at once, and worst-level selection
- [x] The dashboard payload includes `conditions` for each Device, and an HTTP test asserts it
- [x] Cards render one badge per active Condition and use the worst level for the border colour
- [x] The alerts summary tile counts Devices with any Condition at warning level or worse
- [x] The browser mold-risk module is deleted
