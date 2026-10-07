Name: sec-server. Report: .scratch/prodtest/security-final.md.

Target: a final security review of master (4d9397b) for production, concentrating on what changed since the first security review. Run `git diff 88f02b7 4d9397b -- backend frontend deploy compose.yaml compose.demo.yaml .env.example DEPLOYMENT.md` (88f02b7 is the commit that review ended on; it exists locally). The new code includes:
- TRUST_PROXY (frontend/real-ip.sh and the nginx real_ip; validation of the values)
- the split read and write limiters
- the monotonic rate-limit store
- the wrong-token cap's new counting
- the SSE caps at 60 per address and 400 in all
- the health write probe
- the ingest-health state
- `deploy.sh restore` now dropping and recreating the database
- DB_BUFFER_POOL_SIZE
- binlog off
- the read-only containers
- migration 0006

Also re-check the whole attack surface once more, briefly, against the first review (.scratch/prodtest/security.md), so nothing regressed.

Check and prove each with a test, curl, or a script:
1. **TRUST_PROXY:**
   - can a value like `0.0.0.0/0`, `::/0`, a hostname, or shell metacharacters reach nginx config or a shell? real-ip.sh must validate strictly and fail closed
   - can a client spoof its address when TRUST_PROXY is empty, or set to a proxy?
   - IPv6 on all of it
2. **Limiters:**
   - the bypasses: header case, path variants (`/api/readings/`, `//api/readings`, `%2F`), HEAD vs GET counted as reads, OPTIONS
   - whether the read limiter can be used to exhaust memory (the store size bounded and keyed sanely)
   - whether the monotonic store is correct across process restarts
   - the wrong-token cap: confirm a right token never counts, and a guesser gets 100 per 15 min per address
3. **Health probe:**
   - it must not write unboundedly (a table or a row that grows?)
   - it must not be usable to load the DB (unauthenticated, so rate-limited)
   - it must not leak internal error text
4. **deploy.sh and deploy.ps1:**
   - restore's drop-and-recreate must be impossible to trigger without the typed confirmation, must not hit the wrong project, and must keep the safety backup
   - backups' file permissions (0600) and the directory's
   - `info --reveal` and the token handling, so no secrets in process arguments visible in `ps` (for example, a password passed via `-p` to mysqldump in `docker compose exec` args, visible on the host); prefer MYSQL_PWD via env, or a defaults file inside the container
   - `--host` remote mode: ssh options injection, and quoting of the server list file
   - `bootstrap`: it fetches Docker's repo keys over HTTPS and verifies them; curl | sh patterns are absent
5. **Containers:** the read-only fs, cap_drop ALL, no-new-privileges, non-root for api and web; MySQL's privileges (the app user is not root; the root password is only for backups); MySQL not published; images pinned by tag (and say whether digests are worth it); `npm audit --omit=dev` in both packages again; and base images current.
6. **Frontend:**
   - CSP strictness (`style-src 'unsafe-inline'`: can it be removed, or is it needed by Recharts and Radix? Say which.)
   - the Admin token in localStorage: confirm there is no XSS sink, since every user string is rendered as text, no `dangerouslySetInnerHTML`, and no `innerHTML` in the e2e-exposed paths
   - the new 404 page and skip link, so nothing reflects the URL unsafely
7. **Logs:** no tokens, no full request bodies with secrets, and log rotation configured (compose logging options) so a flood cannot fill the disk.

Fix clear bugs test-first in backend/src, frontend/src, real-ip.sh, nginx config, compose, and deploy/ (shellcheck clean). Put anything needing an owner decision under "Decisions for the owner". Bring up at most one stack (`ta-sec2`, port 8098), following the memory rule; host memory is tight.

Constraints: follow prod-common.md (below). Another agent is reviewing the firmware and bench at the same time and owns arduino/ and README's firmware chapter. Never commit, push, stash, reset, or checkout.

Ownership: backend/, frontend/, deploy/, compose*.yaml, .env.example, DEPLOYMENT.md, and .scratch/prodtest/security-final.md.

Observable acceptance: worker_done with a severity-ranked table, the fixes with their tests, all suites green (backend test and typecheck; frontend lint, typecheck, test, and build; shellcheck), the decisions for the owner, and --files-modified.
