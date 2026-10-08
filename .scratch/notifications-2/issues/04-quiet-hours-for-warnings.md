# 04 — Quiet hours for warnings

**What to build:**
Warning-level emails held during quiet hours (nights and weekends) go out as one digest when the quiet hours end. Critical incidents, Offline, and Sensor fault always send at once. A warning that rises to critical inside quiet hours sends at once, as `worse`.

**Blocked by:** none

**Status:** ready-for-agent

**GitHub:** #14

- [ ] `NOTIFY_QUIET_HOURS` (e.g. `18:00-07:00`) and `NOTIFY_QUIET_WEEKENDS` in `config.ts`, in the server's zone (`localDay.ts`), with deploy flags and `info`
- [ ] The sender leaves warning rows due inside quiet hours pending, with a `not_before` time, and sends them in the first pass after; the 24 h give-up counts from `not_before`, not from queuing
- [ ] An incident that opened and closed inside quiet hours arrives in the digest as "opened and resolved"
- [ ] Settings status shows "N held until 07:00"
- [ ] Tests drive the clock: held at 23:00, sent at 07:00, critical never held, a warning turned critical sends at once

## Open questions

- Is there a warning-level Condition that technicians want at night anyway (Humid warning in a closet with known leaks)?
- School holidays: out of scope, or a list of dates?

## Comments

**2026-10-07 — owner decisions (triage).** During quiet hours every warning waits until morning, Humid included; critical always sends at once. School holidays are out of scope (a later ticket if wanted).
