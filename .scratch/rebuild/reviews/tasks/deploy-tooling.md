Target: deployment of the whole stack (compose.yaml: db, api, and web on one port; .env.example; DEPLOYMENT.md; the README "Deployment" section; docs/adr/0005) for the school district's IT staff, on any of their servers.

Change: make deployment one step, two ways.

1. A deploy TUI script for every server: `deploy/deploy.sh` (bash, for Linux and macOS) and `deploy/deploy.ps1` (PowerShell 7 and Windows PowerShell 5.1, for Windows Server with Docker). It is menu-driven, and also scriptable with flags (--yes for non-interactive). Actions:
   - preflight: Docker and Compose v2 present, daemon up, port free, disk space
   - first install: create .env from .env.example; generate ADMIN_TOKEN, DEVICE_TOKEN, and DB_PASSWORD with a CSPRNG; ask for WEB_PORT and the tunables, offering defaults; never overwrite an existing .env without confirmation; chmod 600 on Linux
   - deploy/upgrade: git pull if this is a clean git checkout and the user agrees, `docker compose up -d --build`, wait for healthy, then hit /api/health through web
   - status and logs
   - backup the DB (mysqldump through `docker compose exec db` to a timestamped .sql.gz under backups/) and restore (behind a typed confirmation)
   - run the legacy migration (README and DEPLOYMENT.md describe migrate:legacy)
   - show the tokens (masked unless asked), the URL, and the Device token line for firmware config.h
   - stop and uninstall (`down`; `down -v` only behind a typed confirmation)

   For "all servers", support deploying to one or many remote hosts from one machine: a repeatable `--host user@server` flag, or a deploy/servers.txt list. Each host keeps its own .env and secrets on that host. Pick the simplest robust approach (for example, ssh to the server, git clone or pull the repo there, and run the same script remotely) and document it. Use plain ANSI prompts (no whiptail) so it works over a bare SSH session, with colour only when stdout is a TTY. It must be idempotent: running deploy twice is safe.

2. "Tell your Claude agent": add a project skill `.claude/skills/deploy/SKILL.md` (follow the writing-for-agents skill's conventions) so that an operator in Claude Code in this repo can say "deploy this to <server>", "upgrade", or "back up the database", and the agent drives deploy.sh or deploy.ps1 non-interactively. It asks only for what it cannot know (server address, port), never prints secrets into the chat, and verifies health at the end. Add a short pointer in CLAUDE.md under a "Deploy" heading.

Update DEPLOYMENT.md and the README deployment section to lead with these two paths, keeping the manual compose path as the fallback. Add .gitignore entries for backups/ and any per-host state.

Constraints: do not change compose.yaml service behaviour, backend/, frontend/src, or arduino/; other workers own them. Make only small additive compose changes, and only if strictly needed; say so if you do. Several workers share this worktree: never commit, stash, reset, or checkout.

Test for real. Run deploy.sh under Git Bash (or WSL if available) and deploy.ps1 under pwsh against the local Docker Desktop, with project name `deploytest` (-p or COMPOSE_PROJECT_NAME) and WEB_PORT=8082. Cover first install, re-deploy, status, backup, restore, and uninstall. If the script writes .env in the repo root, test in a scratch copy of the repo outside this worktree (git clone this worktree into your temp directory, then copy your uncommitted deploy/ files in). Leave nothing running, and remove any test .env or backups you created. Remote mode: test --host against localhost over ssh if sshd is available; otherwise state clearly that it is untested. Run shellcheck if it is available.

Ownership: deploy/ (new), .claude/skills/deploy/ (new), DEPLOYMENT.md, README.md (deployment section and the repo layout tree only), CLAUDE.md (the Deploy pointer only), and .gitignore.

Observable acceptance: worker_done lists each action tested on each script with its result, says what is untested, and passes the files added or changed with --files-modified. Use --outcome succeeded only if first install, deploy, status, backup and restore, and uninstall all worked on at least one script locally.
