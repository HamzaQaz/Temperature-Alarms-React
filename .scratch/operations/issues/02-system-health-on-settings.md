# 02 — System health on Settings

**What to build:**
One Settings tab that answers "is the system itself OK?": database size and free disk, the last backup's age (when nightly backups are set up by `deploy`), notification status, the release and how many boards are on older firmware, boards with weak WiFi, and the server's uptime and version. Each line is green or names what to do.

**Blocked by:** none

**Status:** ready-for-agent

**GitHub:** #19

- [ ] `GET /api/system` (Admin token) gathers what `/api/health`, `/api/notifications/status`, and `/api/firmware/status` already know, plus database size (`information_schema`) and the last backup time
- [ ] The backup time: `deploy backup` writes a marker the api can read (a file on a shared volume, or a row), since the api cannot see the host's cron
- [ ] Settings tab per DESIGN.md: each line states its fact and, when not fine, the fix ("No backup in 3 days: run `deploy/deploy.sh backup`")
- [ ] Thresholds: backup older than 2 days, disk under 10 %, RSSI under -80 dBm for a day

## Open questions

- Should a bad line email (if notifications are on), or stay on the page?

## Comments

**2026-10-07 — owner decisions (triage).** A bad line shows on the page only; no email.
