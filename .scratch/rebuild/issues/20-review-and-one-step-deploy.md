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
