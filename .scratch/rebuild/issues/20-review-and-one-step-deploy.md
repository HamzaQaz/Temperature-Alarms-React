# 20 — Review every ticket, and deploy in one step

**What to build:**
Every earlier ticket is reviewed against its spec and the repo's standards, what the review finds is fixed, the UI is walked end to end on a real stack, and a district operator can deploy, upgrade, back up, or remove the system on any of their servers either by asking their Claude agent or by running one menu-driven script.

**Blocked by:** 19 — Flash and check a batch of Devices from the bench

**Status:** done

- [x] Backend, frontend, and firmware/containers/docs reviewed on the Standards and Spec axes; reports in `.scratch/rebuild/reviews/` (`backend.md`, `frontend.md`, `firmware-docs.md`), each finding with a "Fixed" note
- [x] Every finding fixed, test-first where a test could show it
- [x] UI walked on a fresh, seeded stack at 375 px and desktop, in both themes, before and after the fixes; `frontend/e2e/walk.mjs` 31/31 both times
- [x] `deploy/deploy.sh` (bash) and `deploy/deploy.ps1` (PowerShell 5.1 and 7): preflight, install, deploy/upgrade, status, logs, backup, restore, legacy migration, info, stop, uninstall; menu or flags; `--host` / `--servers` for many servers over ssh
- [x] `.claude/skills/deploy/` lets an operator say "deploy this to <server>" in Claude Code; CLAUDE.md points at it
- [x] DEPLOYMENT.md and README lead with the two paths; Compose by hand is the fallback

## Comments

**2026-10-04 — done, by supervised Orca workers.** Three read-only reviewers ran in parallel with the deploy-tooling worker. Each reviewer then fixed its own findings in the files it owned, and the deploy worker took the docs findings once its own edits were in. The task specs are in `.scratch/rebuild/reviews/tasks/`.

What changed, in short:
- **Backend:** `trust proxy` is 1, so a spoofed `X-Forwarded-For` no longer slips past the `/api/` limit. A `GET_LOCK` around the migrations stops two runners from copying legacy rows twice. Out-of-range temperature, humidity, and `campusId` return 422. Body-parser's 4xx statuses are kept. Migrations 0001 and 0004 can be re-run. History is capped at 30,000 rows with an additive `truncated` flag. 171 tests.
- **Frontend:** on a phone, the sidebar closes after a tap. Blocked storage no longer blanks the page. A stale dashboard load can't overwrite a newer one. The History token prompt can be dismissed. The Offline re-check uses `>` as the server does. "Expected 0s ago" no longer shows. Next day stops at today. The DESIGN.md items are done. `index.html` is `no-cache`. The web container runs nginx as non-root on 8080 with a healthcheck; the host port is unchanged.
- **Decision (finding 17 of the frontend review):** the dashboard's summary tiles keep totalling in the browser, as tickets 07 and 08 accepted. PRODUCT.md now says only Conditions and their levels must come from the API.
- **Firmware and bench:** wrap-safe report timing (no 24.8-day stall). WiFi-drop handling now matches its comments. The bench stop summary counts boards that were appended to the sheet. Compiled with arduino-cli 1.5.1 on esp8266 core 3.1.2: 0 warnings, 34% flash. 53 Python tests.
- **Docs:** the TLS-in-front recipes keep `POST /api/readings` on plain HTTP so Devices flashed with `http://` keep reporting, checked in throwaway caddy and nginx containers. The manual nginx template passes `nginx -t` before certbot. Node 22.18+. `.env` is sourced before `$DB_PASSWORD`. The volume naming is explained. The legacy count check accounts for retention.

Verified: the deploy scripts ran every action locally on Docker Desktop, and remotely over ssh to a throwaway sshd. A headless `claude -p` session deployed with the skill alone and then backed up, with health OK and no secret in either transcript.

Untested: certbot against a real domain, a real Windows Server, macOS, an interactive menu over a real `ssh -t`, `deploy.ps1 --servers`, and the legacy count SQL against a real dump.

**2026-10-04 — follow-up: a fresh Linux server from nothing, by an Orca worker** (spec: `.scratch/rebuild/reviews/tasks/linux-bootstrap.md`). `deploy.sh` gained `bootstrap` (Docker Engine, Compose, and buildx from Docker's own apt or dnf repository with its GPG key, plus git and cron; starts docker and cron; adds the sudo caller to the `docker` group; skips what is installed), `schedule-backup` / `unschedule-backup` (one crontab line per checkout, marked `# temperature-alarms backup: <checkout>`, replaced in place; other lines untouched), and `backup --keep-days N`. Cron, not a systemd timer: `bootstrap` installs `cronie` on RHEL-family servers. `--host` / `--servers` copy `deploy.sh` over on its own for `bootstrap`, so the server needs no git, and `deploy --bootstrap` runs both in one call. `deploy.ps1` does the same remotely, and on Windows `schedule-backup` prints a `schtasks` line.

Tested on fresh WSL 2 distros with systemd and their own Docker Engine (Docker Desktop integration off for them), as a non-root user with passwordless sudo:

| | Ubuntu 24.04 | AlmaLinux 9.8 | Debian 13 |
| --- | --- | --- | --- |
| bootstrap | local: pass | local: pass (installed git and cronie) | remote from Git Bash, `deploy --bootstrap`: pass (no git or curl beforehand) |
| re-run | pass, nothing reinstalled | pass | pass, from `deploy.ps1` on PowerShell 5.1 |
| deploy and health | pass | pass | pass, cloned by the remote deploy |
| backup | pass | pass | pass (remote, `deploy.ps1`) |
| schedule twice | one line, `--at`/`--keep-days` replaced it; an unrelated line kept | the same | the same (remote, `deploy.ps1`) |
| a real cron run | the backup ran and pruned | the same | not run |
| unschedule, twice | pass; the unrelated line kept | pass | pass (remote) |
| `uninstall --wipe` | pass, no volumes left | pass | pass (remote) |

Remote `bootstrap` also passed against Ubuntu from Git Bash, PowerShell 5.1, and PowerShell 7. Over ssh with no tty, sudo needing a password stops with a clear error. Alpine is refused by name, and a non-root user without sudo is told to get root. shellcheck 0.11.0 `-S style` is clean, and `bash -n` passes on bash 3.2.57. The local regression smoke with `-p deploytest` (install, deploy, status, backup, restore, uninstall `--wipe`) passed on Docker Desktop for `deploy.sh` in Git Bash and for `deploy.ps1` on PowerShell 5.1. The Git Bash `schtasks` line was created, run once (a real backup, exit 0), and deleted.

Found: `deploy/deploy.sh` is committed as 100644, so `deploy/deploy.sh …` on a Linux clone fails with "Permission denied" until the mode is committed as 100755 (`git update-index --chmod=+x deploy/deploy.sh`). The tests ran with it set. Also, `pwsh -File deploy.ps1 … --ssh-opts "-i C:\key"` is split at the colon by PowerShell's `-File` argument binding (this was already the case before the follow-up). `DEPLOY_SSH_OPTS` works around it.

Untested: RHEL itself, Rocky, CentOS Stream, Fedora, and Ubuntu 22.04. Also untested: the sudo password prompt over `ssh -t`; a server with a distribution `docker` but no Compose (it is refused, not replaced); macOS `schedule-backup`; and the `deploy.ps1` `schtasks` line (printed only, never run).
