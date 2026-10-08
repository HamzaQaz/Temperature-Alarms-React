# 02 — System health on Settings

**What to build:**
One Settings tab that answers "is the system itself OK?": database size and free disk, the last backup's age (when nightly backups are set up by `deploy`), notification status, the release and how many boards are on older firmware, boards with weak WiFi, and the server's uptime and version. Each line is green or names what to do.

**Blocked by:** none

**Status:** done

**GitHub:** #19

- [x] `GET /api/system` (Admin token) gathers what `/api/health`, `/api/notifications/status`, and `/api/firmware/status` already know, plus database size (`information_schema`) and the last backup time
- [x] The backup time: `deploy backup` writes a marker the api can read (a file on a shared volume, or a row), since the api cannot see the host's cron
- [x] Settings tab per DESIGN.md: each line states its fact and, when not fine, the fix ("No backup in 3 days: run `deploy/deploy.sh backup`")
- [x] Thresholds: backup older than 2 days, disk under 10 %, RSSI under -80 dBm for a day

## Open questions

- Should a bad line email (if notifications are on), or stay on the page?

## Comments

**2026-10-07 — owner decisions (triage).** A bad line shows on the page only; no email.

**2026-10-07 — built by an agent; awaiting review.** README (API), DEPLOYMENT.md (the `backup` and `restore` actions, the backups made by hand), the deploy skill.

**What was built.** `GET /api/system` (`routes/system.ts`, `systemHealth.ts`), behind the Admin token, answers `{checkedAt, database, disk, backup, notifications, firmware, wifi, server}`. Each line carries a `status` the server decides (`ok`, `off` for email notifications not set up, `attention`), its facts, and the thresholds it was judged against. **Database:** its size from `information_schema.tables`, and whether Readings are being stored (`ingestHealth`, as `/api/health` uses it). **Disk:** free and total from `statfs` on `/`. **Backup:** read from the marker. **Notifications:** the outbox's figures (`outboxStatus`, as `/api/notifications/status`). **Firmware:** the release, how many installed Devices it is offered to and how many run it, and those that checked and still run an older build (counted as the Firmware tab counts them). **WiFi:** installed Devices whose signal has been under -80 dBm for 24 h or more. **Server:** uptime from the process start, and `version`. Migration `0018-system-health` adds two things. `last_backup` is a single row, replaced each time. `devices.weak_signal_since` is set by ingest from the first self-report under -80 dBm and cleared by one at -80 or better, or by one without a signal figure. **The marker:** `deploy backup`, in `deploy.sh` and `deploy.ps1`, runs `REPLACE INTO last_backup` with the dump's finish time (UTC), file name and size, as root inside `db` with the SQL on stdin, once the dump has checked out. If the database refuses it (an api from before 0018), the script warns and keeps the backup. `restore` records again the backup it made first, once the api is back, because the restored database only knows earlier ones. **The version:** `deploy` and `demo` export `APP_VERSION` from `git log -1 --format='%h %cd' --date=short`; `compose.yaml` passes it as a build argument, `backend/Dockerfile` bakes it into the image's environment, and `index.ts` hands it to the app. **The tab:** Settings gains a System tab (`SystemSection.tsx`, worded by `lib/systemHealth.ts`). It shows a summary ("3 lines need attention: Last backup, Firmware, WiFi."), when the check ran, and Refresh, then one line per check. Each line has a grey check (fine), a grey dash (off), or a red alert (attention), with a word for screen readers, then its label and fact, and the fix when the line is not fine ("No backup in 3 days: the last was ...", then "Run `deploy/deploy.sh backup`, and `deploy/deploy.sh schedule-backup` if the nightly one has stopped."). Commands are set as code and hostnames in mono. Ages count from the server's `checkedAt`, so the words agree with the status beside them.

**Decisions beyond the ticket.**
- **Marker:** a row rather than a file on a shared volume. `deploy` already reaches `db` as root; a shared file would need a mount in api, which runs read-only as `node`, and read access to a `backups/` that is mode 700.
- **Thresholds:** constants in `systemHealth.ts`, not settings. "Older than 2 days" means more than 48 h. "Disk under 10 %" means unprivileged free space under a tenth of the filesystem. "-80 dBm for a day" means every self-report of the last 24 h was under -80; one at -80 or better starts the clock again, and one without RSSI clears it.
- **Disk:** measured where the api runs (`/`), standing in for the database's disk. That holds under Compose (one Docker data root), but not necessarily for a manual install with MySQL on another disk. If it cannot be measured, the line needs attention and gives the error with `df -h` as the fix.
- **Database size:** MySQL's own figure, which can be up to a day old (`information_schema_stats_expiry`). If the database cannot be read at all, the route answers 500 and the tab shows that error rather than a page of unknowns.
- **Bench:** Devices on the Bench are left out of the firmware and WiFi lines, since they are not installed. The Firmware tab still lists them.
- **Firmware:** no grace period after a publish. A board behind needs attention at once, and the fix says boards update within a Report interval (older firmware within the hour). Boards that never checked count neither as running the release nor as behind, as on the Firmware tab.
- **Notifications:** off is a state of its own (grey, saying how to turn them on), not attention. Attention means only that the latest try failed (a failure newer than the last send). Emails given up on earlier in the week are stated, but no longer keep the line red once the relay works. Test emails, which the notifications route keeps in memory only, are not counted.
- **Version:** nothing recorded one before this, so the version is the commit and its date, built in by `deploy`. It is null ("not recorded") for an image built by hand or a manual install. A demo built by `deploy` carries it too.
- **Placement:** the tab is named System and comes last. Nothing on it is emailed (owner decision).
- **Git Bash:** `deploy.sh` exports `MSYS_NO_PATHCONV`, so `git -C <path>` fails there. `app_version` runs `git` from inside the checkout instead.

**Tested.** `backend/test/system.test.ts` (13):
- Needs the Admin token.
- A fresh install: every line, with only the missing backup to act on, notifications off, no release, no weak WiFi, and uptime and version from the deps; no version when none is given.
- Backup: a 24 h old marker is fine, with its file and size; 49 h needs attention.
- Disk: 9.5 % needs attention, and one that cannot be measured gives its error.
- Database: Readings not stored needs attention.
- Notifications: on, with one waiting and then a last send; the latest try failing needs attention, and a send after it clears that.
- Firmware: Bench and never-checked boards aside, a staged release, then all caught up.
- WiFi, through real ingest: not at 23 h, yes at 25 h; a second weak Reading keeps the start; -79 ends it; the Bench is left out; a report without a signal figure clears it.
- Boundaries: backup at 48 h and 48 h plus a second; disk at 10 %, 9.99 %, and a zero total.

The migrations tests list 0018 and `last_backup`. `frontend/src/lib/systemHealth.test.ts` (11) covers: line order and statuses; every fine fact; backup none and old with the ticket's command; disk full and unmeasured; Readings not stored; notifications off, failing, and given up; firmware none, staged, behind, unchecked, and offered to none; weak WiFi; no version; the summary; `formatBytes`. `deploy.test.sh` and `deploy.test.ps1` check that:
- `backup` sends exactly one `REPLACE` with the time, name and size to mysql as root in `db`, and says so;
- a refused record warns and keeps the backup;
- `restore` records the backup it made first again, after api is back, and never the restored file;
- `compose.yaml` passes `APP_VERSION` as a build argument, and the Dockerfile bakes it in;
- `deploy` builds with an empty `APP_VERSION` outside git, and with the commit and date inside it.

By hand: the built backend ran against the test database with seeded Devices, a release and an old marker, using the real `statfs` on this disk. The tab, opened in Orca's browser, showed "3 lines need attention: Last backup, Firmware, WiFi", with the Bench board at -90 dBm left out.

**Untested.**
- A real `deploy backup` or `restore` against a running stack (the scripts were driven against a fake docker).
- `statfs` inside the api container on Linux, and the version on a real image build.
- The tab at phone width, under a screen reader, and in the light theme.

**Verified 2026-10-07**, on the worker test database (`temperature_alarms_test_shutdown`):
- Backend: `npm run typecheck` and `npx tsc --noEmit -p tsconfig.json` clean; `test/system.test.ts` 13/13; `npm test` 458/459.
- The one backend failure is "moves the PHP-era devices and locations aside and builds the new schema beside them" (`legacyMigration.test.ts`). It fails the same way at 03c4700 on this database: the server on 127.0.0.1:3347 now reports `version_compile_os` Win64 and `lower_case_table_names` 2, so `information_schema` sorts the `ESP_` tables among the lowercase names. This change only adds `last_backup` to that list.
- Frontend: `npm run typecheck` and `npm run lint` clean; `npm test` 96/96; `npm run build` builds.
- `bash deploy/deploy.test.sh` (Git Bash) all passed; `deploy/deploy.test.ps1` all passed under pwsh 7 and Windows PowerShell 5.1.
- Not run: shellcheck (not installed here); the bench tests and the firmware build, since nothing in `arduino/` changed.
