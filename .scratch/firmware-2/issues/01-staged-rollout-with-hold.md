# 01 — Staged rollout with an automatic hold

**What to build:**
Publishing to named Devices first already exists (`POST /api/firmware?only=ESP_A,ESP_B`, ADR 0007). Add the second half: the Firmware tab shows how the first boards are doing on the new version, offers "Release to all" once they have reported on it, and holds the release by itself if one of them goes Offline, raises Sensor fault, or reports a failed update after taking it.

**Blocked by:** none

**Status:** ready-for-agent

**GitHub:** #16

- [ ] The release records its stage (named Devices, or all) and when it was widened
- [ ] `POST /api/firmware/widen` (Admin token) turns a staged release into one for every Device
- [ ] Hold: a staged Device that took the new version and then goes Offline or Sensor fault, or whose self-report carries a failed update, marks the release held; held releases offer nothing more, and the Firmware tab says why and which Device
- [ ] Firmware tab: per staged Device, its version, last report, and health; "Release to all" enabled only when every staged Device reported on the new version for N intervals
- [ ] Tests at the HTTP seam: widen, hold on Offline, hold on a failed update, no hold for a Device that never took it

## Open questions

- N intervals before "Release to all" is offered: 2? 10?
- Should a hold email (if notifications are on)?

## Comments

**2026-10-07 — owner decisions (triage).** "Release to all" is offered after 10 clean Report intervals on the first boards. An automatic hold emails (when notifications are on).
