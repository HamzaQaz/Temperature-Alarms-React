Name: infra. Report: append an "Infra hardening applied" section to .scratch/prodtest/security.md.

Target: apply the security agent's routed infra changes, then prove them on the production deploy path. Read the "Infra changes to route" section of .scratch/prodtest/security.md, which has the nginx diff, the compose diff, `build --pull` in deploy.sh, and the DEPLOYMENT.md notes.

Change:
1. **Apply the diffs** to frontend/nginx.conf, compose.yaml (and compose.demo.yaml where the same services need it), deploy/deploy.sh, deploy/deploy.ps1 (mirror `build --pull`), and DEPLOYMENT.md. Keep shellcheck clean.
2. **Prove them in the CT stand-in**: .scratch/ct/Dockerfile and run.sh, from the CT agent. Build the CT, copy this worktree's tree in (a git bundle of HEAD plus the uncommitted infra changes, or `docker cp` of a `git archive` plus the changed files), and run `deploy/deploy.sh bootstrap` then `deploy --yes`.
3. **Check the deployed stack:**
   - every security header and CSP from the host (`curl -sI` on `/`, `/api/health`, and an asset)
   - the browser walk from the Windows host, `node frontend/e2e/walk.mjs`, against the CT's port. It must pass with zero CSP violations in the console (capture console errors in Chromium)
   - the SSE stream through nginx still delivering, and 25 streams from one address OK while the 21st+ per address are limited as designed (check that the limits agree: the backend caps 20 per address)
   - backup and restore under the read_only and cap_drop compose
   - the demo (`deploy.sh demo --web-port 8091`) still working under the new compose
   - a CT restart, after which it comes back healthy
4. **Run `deploy.sh uninstall --wipe --confirm`** and remove the CT, its image, and its volumes.

Constraints: follow prod-common.md (below). The CT agent is finished, so you now own deploy/, compose*.yaml, both Dockerfiles, frontend/nginx.conf, DEPLOYMENT.md, and README's deployment sections. The accessibility agent is editing frontend/src at the same time. The load agent is running a heavy stack (ta-load), so follow the memory rule strictly: wait until under 3 GB is in use before building the CT. If something in a diff breaks the app (for example, CSP blocking something), fix the diff, not the app, and say so.

Ownership: frontend/nginx.conf, compose.yaml, compose.demo.yaml, both Dockerfiles, deploy/, DEPLOYMENT.md, README.md (deployment sections), and .scratch/ct/.

Observable acceptance: worker_done listing each applied change, the header output, the walk result with 0 CSP violations, the SSE and limit checks, backup/restore, demo, and restart results, and --files-modified. Use --outcome succeeded only if all passed in the CT.
