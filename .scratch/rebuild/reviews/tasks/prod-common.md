Shared rules for the production-readiness agents. The repo is this worktree, at master 91288a5: Temperature Alarms, an Express+MySQL backend, a React frontend served by nginx, Docker Compose, and deploy/deploy.sh. The district deploys to a Proxmox LXC next, with about 100 Devices posting every 30 s, and technicians and IT leadership watching in browsers.

- Five agents share this worktree, so edit only what your spec says you own. Never commit, push, stash, reset, or checkout: the coordinator commits after you report.
  - The CT test agent owns deploy/, compose*.yaml, the Dockerfiles, frontend/nginx.conf, DEPLOYMENT.md, and the README's deployment sections.
  - The security agent owns backend/src (security fixes) and package dependency bumps.
  - The accessibility agent owns frontend/src.
  - The load and resilience agents own only their own scripts and reports under .scratch/prodtest/.
  - If you need a change in a file you do not own, describe the exact change in your report (or send a question), and the coordinator routes it.
- **Docker memory is about 6 GB in total.** Before any `docker compose up`, run `docker stats --no-stream` and check that the running containers use under 3 GB in total and that at most one other full stack is up; otherwise wait, checking every 2 minutes. Use your own compose project name and a port of your own (load: 8095, resilience: 8096, accessibility: 8097, security: the test DB only). Tear your stacks down when done. The shared test DB (backend-test-db-1 on :3307) may be up: use it, and do not take it down unless you started it.
- **Put evidence under .scratch/prodtest/** (your report as .scratch/prodtest/<your-name>.md, raw logs under .scratch/prodtest/runs/, which is gitignored).
- **Report format:** a pass/fail table first, then findings ranked by production impact (blocker / should-fix / note), each with a reproduction, plus fixes made and the tests that cover them.
- Any code fix is test-first where a test can show it, and the existing suites must stay green: backend `npm test`/`typecheck`, frontend `lint`/`typecheck`/`test`/`build`.
