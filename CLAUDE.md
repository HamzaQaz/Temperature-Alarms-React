# Temperature Alarms

Live temperature and humidity monitoring for network closets, fed by NodeMCU boards with DHT11 sensors. React + Vite frontend, Express + MySQL backend, ESP8266 firmware.

## Agent skills

### Issue tracker

Issues and specs are local markdown under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels, unchanged: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Design context

`PRODUCT.md` (who it is for, positioning, principles, anti-references) and `DESIGN.md` (tokens, type, components, do's and don'ts) at the repo root. Read both before any frontend work; `/impeccable` commands load them automatically.

## Commits

Commit only when asked. Feature work goes on its own branch (`feat/<feature>`), one commit per ticket, then back onto the working branch with `git merge --no-ff` (message `Merge feat/<feature>: <summary>`), so the history graph shows each feature as a branch. Small one-off fixes may go straight on the working branch. Then push the working branch and bring it to `master` through a GitHub PR merged with a merge commit (`gh pr merge --merge`, never squash or rebase), so `master` always ends up with everything. Never rewrite pushed history: the test server pulls the working branch.

## Deploy

Deploying, upgrading, backing up, or removing the stack, here or on a server, goes through `deploy/deploy.sh` or `deploy/deploy.ps1`, driven by the `deploy` skill (`.claude/skills/deploy/`).
