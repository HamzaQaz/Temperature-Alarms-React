# CT test: master in a Proxmox-LXC stand-in

2026-10-05. Master at 91288a5 (same tree as this worktree's HEAD 5a49902), cloned fresh from GitHub inside the CT. Task: `.scratch/rebuild/reviews/tasks/ct-test.md`.

**Result: pass.** Bootstrap, deploy, health from the host, backup and restore, restart survival, and every test suite pass inside the CT. Two bugs fixed in `deploy/deploy.sh` (one mirrored in `deploy.ps1`), plus doc fixes; all re-tested inside the CT.

## The CT

Files: `.scratch/ct/Dockerfile`, `.scratch/ct/run.sh` (`run.sh` builds and starts; `run.sh down` removes the CT, its image, and its volumes). `debian:12` with systemd, sudo, openssh-server, curl, ca-certificates, locales (plus dbus, procps, iproute2 for systemd and diagnostics); user `admin` with passwordless sudo; no Docker, no git.

The brief's `docker run` line worked as given: systemd came up `running` with no failed units on Docker Desktop's cgroup v2 (WSL2 kernel 6.18.33, 12 CPUs, 5.8 GiB). What had to change:

| Change | Why |
| --- | --- |
| `-v ta-ct-docker:/var/lib/docker -v ta-ct-containerd:/var/lib/containerd` | With the CT's root on Docker Desktop's overlayfs, the nested Docker's first `docker run` failed: `failed to mount /tmp/containerd-mount...: fstype: overlay ... err: invalid argument` (overlayfs cannot stack on overlayfs). Named volumes are ext4 in the Docker Desktop VM, which is what a Proxmox CT root on LVM-thin or a directory store is. After this the default snapshotter worked. |
| `-p 8091:8091` | To reach the demo from the host. |
| `MSYS_NO_PATHCONV=1` | Git Bash only: stops `/sys/fs/cgroup` being rewritten into a Windows path. |

Nested Docker inside: Docker 29.8.2, containerd.io 2.3.6, Compose 5.6.0; storage `overlayfs` via `io.containerd.snapshotter.v1` (Docker 29's default containerd image store), cgroup driver systemd, cgroup v2, seccomp, no AppArmor.

## Steps

| # | Step | Result | Time | Notes |
| --- | --- | --- | --- | --- |
| 1 | Build and start the CT | Pass | 24 s build | systemd `running`, 0 failed units |
| 2.1 | git clone | Pass, doc gap | 9 s | Debian 12 has no git. DEPLOYMENT said "needs nothing but git" and gave only `dnf install git`. Ran `sudo apt-get install git`. Docs fixed |
| 2.2 | `bootstrap`, twice | Pass | 22 s, then 0.4 s | First: Docker repo with signed key, Docker, cron, both enabled, admin in `docker`. Second: all "already" |
| 2.3 | Log in again | Pass | | `su - admin` (a new login session); `id` shows `docker` |
| 2.4 | `deploy --yes` (port 80 → host 8090) | Pass | 2 m 26 s cold; 3 m 15 s with all caches pruned; ~40 s warm | `.env` 0600, three secrets generated, `COMPOSE_PROJECT_NAME` pinned, preflight ok, `up --wait` healthy, health through web ok. Non-TTY output prints every layer-download line (noisy, harmless) |
| 2.5 | Health inside and from the host | Pass | | `{"status":"ok","database":"connected"}` at `localhost/api/health` in the CT and `http://localhost:8090/api/health` on Windows; `/` 200 |
| 2.6 | status, logs, info | Pass | | `info` masks all three secrets (`bb34...d69d`); URL is the CT's address `http://172.17.0.2/` |
| 2.7 | backup, add Campus, restore `--confirm` | Pass | backup < 1 s; restore 18 s | Campus BHS before the backup, ABK after. After `restore --file … --confirm temperature-alarms --yes`, only BHS remains; restore took its own safety backup first; health ok |
| 2.8 | `schedule-backup --at` (+2 min) | Pass | fired on the minute | One crontab line; repeating replaces it (still 1). Cron ran at 16:34:01, backup file at 16:34:02, `backup.log` written. `--at` is the CT's local time (UTC on a fresh CT); now said in the Proxmox notes |
| 2.9 | `docker restart ta-ct` | Pass | healthy 12 s after restart | docker, containerd, cron enabled; all three services healthy; BHS still there |
| 2.10 | `demo --web-port 8091` beside the real install | Pass | 29 s up, 13 s down | Separate project and volume; real install's Campuses unchanged while the demo seeded 4 Campuses / 24 Devices; `demo --down` removed the demo containers, images, volume, and `.env.demo`, real stack still healthy |
| 2.11 | migrate-legacy | Pass, doc gaps | 38 s | Legacy set built from the fixture in `backend/test/legacyMigration.test.ts` (the docs do not give the old schema): `devices`, `locations`, `alarms`, `ESP_2EB804` (PHP era, one bad date), `ESP_A1B2C3` (with humidity). Followed DEPLOYMENT "Migrating an old database in": `down -v`, set `LEGACY_TIME_ZONE`, `up --wait db`, restore, `deploy`. Log: 2 Campuses, 2 Devices, copied 2+2, skipped 1 (named). 3:07 PM on 9/20/2026 stored as 20:07 UTC (CDT, correct). Then an "old writer" row added and `deploy.sh migrate-legacy --yes`: backed up, copied exactly 1, progress table 3 copied / 1 skipped. **Doc bug:** step 2 said `install --yes --set LEGACY_TIME_ZONE=…` writes it, but step 0 leaves `.env` in place and `install` then warns "settings given but .env left unchanged". `--reconfigure` works and keeps the secrets. Docs fixed |
| 2.12 | `uninstall`, then `uninstall --wipe --confirm` | Pass after fix | | Containers and built images removed, volume kept; redeploy came back with the data; `--wipe` removed the volume; `.env` and `backups/` kept as documented. **Bug:** the `schedule-backup` crontab line survived both, so cron would run a failing backup every night. Fixed, re-tested (see Fixes) |
| 3 | Test suites in the CT | Pass | 1 m 04 s backend, 44 s frontend | Node 22.23.3 from NodeSource `setup_22.x` (**README gap:** says Node 22.18+ but not how to install it on Debian; Debian 12's own package is Node 18). Backend `npm ci`, `test:db` (nested Docker, MySQL on 127.0.0.1:3307), `npm test` **211/211**, `typecheck` clean. Frontend `npm ci`, `lint`, `typecheck`, `test` **29/29**, `build` all exit 0. `python3 -m unittest arduino/test_bench.py` **53 OK** (Python 3.11.2). `shellcheck` 0.9.0 from apt: **3 SC2015 infos** (fixed, now clean) |
| 4a | Browser walk from Windows → :8090, fresh empty DB | Pass | 19 s | `WEB=http://localhost:8090 node e2e/walk.mjs` with the tokens read from the CT's `.env` into the shell only: **36 of 36 checks passed** |
| 4b | Manual pass on the demo at 1440 and 390 px | Pass | | `.scratch/ct/shots.mjs` → `.scratch/ct/shots/`: Dashboard, Campuses, Incidents, History, Settings at both widths; all 200, no console errors, no horizontal overflow. Looked at Dashboard 1440, Campuses 390, Incidents 1440: real data, correct layout |
| 5 | Proxmox notes | Done | | DEPLOYMENT.md "Proxmox LXC" under the deploy script section |

Teardown: `ta-ct`, its image, and both volumes removed; no stack running on the host.

## Fixes

1. **`uninstall` left the nightly backup scheduled** (`deploy/deploy.sh`). After `uninstall` or `uninstall --wipe`, the crontab line kept running `backup` against a stack that no longer exists, failing into `backups/backup.log` every night. Now `uninstall` removes its own marked line (other crontab lines untouched) and says so; `schedule-backup` puts it back. Re-tested in the CT: with our line plus an unrelated line, `uninstall` removed only ours. `deploy.ps1` cannot remove a Task Scheduler task it did not create, so its `uninstall` now warns with the `schtasks /Delete` line when the task exists (parse-checked in PowerShell 5.1 and 7, and the query path run; not run end to end on a Windows Server).
2. **shellcheck not clean on Debian's shellcheck 0.9.0**: three SC2015 infos (`A && B || C`) in `need_value`, the preflight disk loop, and the restore picker. Rewritten as `if`s with the same behaviour. Re-tested: `shellcheck deploy/deploy.sh` exits 0; `backup --keep-days` with no value still says "needs a value"; the picker under a TTY refuses `x` and `99` with "no such backup" and restores the right file for a valid number.
3. **Preflight's disk message** said "the first build needs about 2 GB"; the first deploy here put 3.4 GB in Docker's stores. Now "about 3.5 GB" in both scripts (the threshold is unchanged).
4. **Docs**: DEPLOYMENT says how to get git on Debian/Ubuntu (a Proxmox template has none), that `uninstall` removes the crontab line and keeps `.env` and `backups/`, and that the legacy time zone needs `--reconfigure` on an existing `.env`; README's deploy section points minimal Debian at `apt-get install git` and the Proxmox notes. New DEPLOYMENT "Proxmox LXC" subsection.

No change to backend/src, frontend/src, or arduino/: no test exposed a bug there.

## Doc gaps noted, not fixed

- README "Working on the code" gives Node 22.18+ but not how to get it on Debian (outside this task's README ownership, which is the deployment sections). NodeSource `setup_22.x` worked.
- The old per-Device schema is not written down; making a legacy set needed the test fixture. A real operator has a real dump, so this matters only for testing.
- `uninstall` keeps pulled base images (mysql, node, nginx; 1.9 GB in `/var/lib/containerd` afterwards); `docker image prune -a` reclaims them. Not stated in the docs.
- Both docs use `<repo-url>`; the Proxmox sequence now gives the real URL.

## Resources observed

- Stack steady: db ~500 MiB, api ~120 MiB, web ~10 MiB (~640 MiB). Whole CT peak during a no-cache build: ~1.3 GiB (cgroup usage, includes page cache).
- Disk after the first deploy: `/var/lib/containerd` 2.1 GB + `/var/lib/docker` 1.3 GB (0.8 GB build cache); CT root otherwise ~1.5 GB (Debian, Docker packages, clone, plus Node and test node_modules here).
- Recommended CT: 2 GiB RAM, 512 MiB swap, 2 cores, 16 GB disk.

## What the stand-in cannot prove

- An **unprivileged** CT (uid mapping, keyctl): the stand-in was privileged with the host cgroup namespace.
- **AppArmor**: Docker Desktop's VM has none; a Proxmox host confines CTs with it, which is where nested Docker most often fails.
- **ZFS or LVM-thin** storage under the snapshotter (stand-in used ext4 volumes; overlayfs on ZFS needs ZFS ≥ 2.2).
- The **Proxmox kernel**, `vmbr0` bridge, and firewall: the port was published by Docker, not reached across a LAN.
- A **Proxmox host reboot** with `onboot: 1`: only the CT was restarted.
- Proxmox's own docs recommend a VM for Docker; the notes say so.
