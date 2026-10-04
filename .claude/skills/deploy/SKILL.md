---
name: deploy
description: Deploy the Temperature Alarms stack to this machine or district servers by driving deploy/deploy.sh or deploy/deploy.ps1 non-interactively. Use when the operator asks to deploy, install, or upgrade it, back up or restore the database, check its status or logs, or stop or remove it.
---

# Deploy

`deploy/deploy.sh` (Linux, macOS, Git Bash) and `deploy/deploy.ps1` (Windows PowerShell 5.1 and 7) are one tool: same actions, same flags. `--help` on either is the flag reference, and `DEPLOYMENT.md` explains each action. You are the hands of an operator who cannot see your terminal, so every call is **non-interactive**: it carries `--yes`, and a prompt never waits on you.

## Secrets stay on the server

The Admin token, Device token, and database password live only in each server's `.env`. Keep them out of the conversation: show `info --yes`, which masks them, and leave `.env` unread. When the operator needs one in full (the Settings page, a board's `config.h`), give them the command to run in their own terminal on the server: `deploy/deploy.sh info --reveal`.

## Steps

1. **Target.** Decide where it runs and which script:
   - This machine: `bash deploy/deploy.sh …`; on Windows without bash, `powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1 …`.
   - Servers: add `--host USER@SERVER` (repeatable) or `--servers deploy/servers.txt`. The script ssh's in, clones the repo into `~/temperature-alarms` if missing (`--dir` for an existing checkout), and runs `deploy.sh` there, so remote targets are Linux or macOS.

   Ask the operator only for what you cannot find: the server's `USER@HOST`, and on a first install the web port (default 80). For a server, prove ssh works unattended with `ssh -o BatchMode=yes USER@HOST true`; when it fails, ask the operator to set up key-based ssh, since you cannot answer a password prompt. Done when the command line is settled and ssh answers.

2. **Preflight.** Run `preflight --yes` with the same target flags (and `--web-port` on a first install). Done when every line reads `[ ok ]` or `[warn]`. A `[FAIL]` line is the answer: report it with its fix and stop.

3. **Act.** Map the request to one action; the first build takes minutes, so give it a 15-minute timeout. Run the script unpiped, so the exit status you read is the script's (a `| tail` reports `tail`'s); its output is already short apart from the build log.

   | The operator says | Run |
   | --- | --- |
   | deploy, install | `deploy --yes --web-port PORT`, plus `--set KEY=VALUE` for any threshold they named |
   | upgrade, update | `deploy --yes --pull` (a remote deploy pulls by default) |
   | back up the database | `backup --yes` |
   | restore | `restore --file backups/NAME.sql.gz --yes --confirm PROJECT` |
   | status, logs | `status --yes`; `logs --yes --service api --tail 200` |
   | migrate the old database | `migrate-legacy --yes` |
   | stop, take it down | `stop --yes`; `uninstall --yes` |
   | wipe it | `uninstall --yes --wipe --confirm PROJECT` |

   `--confirm PROJECT` stands in for the operator typing the project name, so it is theirs to give: before a restore or a wipe, name the file or the data that will be replaced or deleted, and run it only after they say yes in the chat. The project names the database volume: it is Compose's default (the checkout's folder name), which the first install pins in `.env`. Pass `-p` only when the operator names a project; the first install pins it too, so later calls need no `-p`. The project for `--confirm` is the one `status` prints in its `Containers (PROJECT)` heading.

4. **Verify.** Finish with `status --yes` on the same target. Done when it prints `[ ok ] http://…/api/health -> {"status":"ok","database":"connected"}` and exits 0. Report the dashboard URL from `info --yes`; after a first install, add the `info --reveal` command for the tokens and the reminder that `DEVICE_TOKEN` goes into every board's `config.h`.
