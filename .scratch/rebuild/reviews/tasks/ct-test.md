Target: an end-to-end test of master (https://github.com/HamzaQaz/Temperature-Alarms-React, public, latest commit 91288a5 or newer) inside a Docker container that stands in for a fresh Proxmox LXC (a "CT"). Another agent will next deploy to a real production Proxmox LXC; your report and docs are their handoff.

Change:

1. **Build the CT.**
   - Make a container from debian:12 (Proxmox's most common CT template) with systemd as PID 1, sudo, openssh-server, curl, ca-certificates, and locales. Do NOT preinstall Docker or git: `bootstrap` must do that.
   - Add a non-root user `admin` with passwordless sudo, as a typical CT setup has.
   - Run it the way an LXC with nesting behaves: `docker run -d --privileged --cgroupns=host -v /sys/fs/cgroup:/sys/fs/cgroup:rw --tmpfs /run --tmpfs /run/lock -p 8090:80 --name ta-ct --hostname ta-ct <image> /sbin/init`. Adjust only as needed for Docker Desktop's cgroup v2, and record exactly what was needed.
   - Put the build files under .scratch/ct/ (a Dockerfile and a run script), so the test is repeatable.
   - Docker Desktop has about 6 GB of memory: run one stack at a time inside the CT.

2. **Deploy from master inside the CT, as `admin`, following DEPLOYMENT.md literally as a new operator would.** Note every place the docs were wrong or unclear.
   1. `git clone` the repo. If the docs say `deploy/deploy.sh bootstrap` needs git first, follow them.
   2. Run `deploy/deploy.sh bootstrap`, then run it a second time (idempotent).
   3. Log in again, or use newgrp.
   4. `deploy/deploy.sh deploy --yes` on port 80, published as host port 8090.
   5. Health through web from inside the CT, and from the Windows host at http://localhost:8090.
   6. status, logs, info (masked).
   7. backup, then restore with --confirm, after adding a Campus and checking that the restore removed it.
   8. schedule-backup: check the crontab, and that cron actually runs (use `--at` a minute ahead and wait for the backup file to appear).
   9. Restart the CT itself (`docker restart ta-ct`) and confirm that the stack comes back on its own, healthy, with its data.
   10. `deploy/deploy.sh demo --web-port 8091` beside the real install. Publish 8091 too, or check it from inside. Confirm that the two do not interfere, then run `demo --down`.
   11. Also run migrate-legacy if you can create a small legacy per-Device table set per README/DEPLOYMENT (skip it and say so if that is unclear).
   12. Finally, `uninstall`, then `uninstall --wipe --confirm`.

3. **Run every test suite inside the CT**, in the cloned repo:
   - backend `npm ci` and `npm test` (it needs the throwaway test DB, `npm run test:db`, nested Docker), plus `npm run typecheck`
   - frontend `npm ci`, `npm run lint`, `typecheck`, `test`, and `build`
   - `python3 -m unittest arduino/test_bench.py`
   - `shellcheck deploy/deploy.sh` if it is available via apt

   Install Node per the README's stated version (Node 22.18+) the way the README says. If the README does not say how on Debian, note that as a doc gap and use NodeSource or the official tarball.

4. **Browser walk from the Windows host** against the CT's published port, while the real install runs with a fresh, empty DB: run `node frontend/e2e/walk.mjs` from this worktree, with the base URL and admin token per README "The browser walk". Then do a quick manual pass of Dashboard, Campuses, Incidents, History, and Settings at 1440 and 390 px against the demo, with Playwright screenshots to .scratch/ct/shots/.

5. **Proxmox notes for the next agent.** Add a "Proxmox LXC" subsection to DEPLOYMENT.md, under the deploy-script section, with only what you verified here, and say plainly what this Docker stand-in cannot prove:
   - the CT settings this needs: `features: nesting=1,keyctl=1`, privileged vs unprivileged, and the AppArmor/storage driver notes
   - the Docker storage driver that worked inside (overlay2 vs fuse-overlayfs vs vfs)
   - minimum resources observed (RAM and disk after install)
   - the exact command sequence

   Write the full pass/fail report to .scratch/rebuild/reviews/ct-test.md: each step, its result, the time taken, and any fix you made.

Constraints:
- **Fixes:** any bug found in deploy/deploy.sh, deploy.ps1, compose files, Dockerfiles, or the docs, fix it here in this worktree, minimally and with shellcheck clean. Then re-test the fix inside the CT: copy the changed files into the CT's clone, or point the clone at this worktree with a git bundle. Do not change backend/src, frontend/src, or arduino/ unless a test inside the CT exposes a real bug; if so, fix it test-first and say so.
- **Git:** never commit, push, stash, reset, or checkout: the coordinator commits.
- **Teardown at the end:** stop and remove ta-ct, its image, and its volumes, and leave no stack running on the host. Leave the .scratch/ct/ files, but no secrets in them.

Ownership: deploy/, compose*.yaml, both Dockerfiles, frontend/nginx.conf, DEPLOYMENT.md, README.md (deployment sections only), .scratch/ct/, .scratch/rebuild/reviews/ct-test.md, and bug fixes elsewhere only as described above.

Observable acceptance: worker_done with the pass/fail table (each step above), every fix made, the Proxmox settings you recommend, what remains unproven for a real LXC, and --files-modified. Use --outcome succeeded only if bootstrap, deploy, health from the host, backup/restore, restart survival, and all test suites passed inside the CT.
