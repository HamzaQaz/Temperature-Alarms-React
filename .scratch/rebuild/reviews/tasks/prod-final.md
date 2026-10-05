Name: final. Report: .scratch/prodtest/final.md.

Target: the last fixes before production, then one final proof of the finished branch (HamzaQaz/prod-hardening at HEAD).

Part A. **Fix the resilience findings** in .scratch/prodtest/resilience.md. Read it fully: each finding has a reproduction and the exact fix. Work test-first.
- **B1 (blocker):** in backend/src/routes/readings.ts, the authFailureLimiter counts requests that a board abandoned during a DB outage or slow DB as wrong-token attempts, which locked every Device behind an address out for about 11 minutes. Fix: count only real 401s (`requestWasSuccessful: (_req, res) => res.statusCode !== 401` is wrong as used; the report's fix is `requestWasSuccessful === 401` semantics plus `skipFailedRequests: true`, but derive it correctly from express-rate-limit's docs and prove it). Tests:
  - a DB outage with many aborted requests does not lock anyone out
  - real wrong tokens still lock out at 100
- **S1:** the Dashboard stays on its error screen while Readings stream. A Reading or a successful reconnect must clear the error and reload (frontend/src).
- **S2:** the Offline sweep backdates false Offline incidents into the server's own downtime. After a server start, give Devices one Report-interval grace before declaring Offline, and never start an incident earlier than the server's own start time. Record the rule in ADR 0006.
- **S3:** nginx needs `proxy_connect_timeout 2s` (and a sensible `proxy_next_upstream` or retry for the stream) so that streams return within seconds after an api restart, not about 30 s.
- **S4:** health stays green on a full disk while every Reading fails with 500. /api/health must report unhealthy (503) when the DB cannot write: a cheap write probe, rate-limited to once per 30 s, or the error state from recent ingest failures.
- **S5:** `deploy.sh restore` leaves tables the dump lacks. Restore into a clean database: drop and recreate it inside the same confirmed operation, and keep the pre-restore safety backup. Mirror the change in deploy.ps1.
- **From the perf report:** a `DB_BUFFER_POOL_SIZE` setting (default 512M) in compose, .env.example, the deploy scripts' `--set`, and DEPLOYMENT.md's Proxmox RAM numbers.

Part B. **Final proof** of HEAD plus your fixes, in the CT stand-in (.scratch/ct/: Dockerfile, run.sh, csp-probe.mjs):
1. bootstrap and deploy as a new operator, per DEPLOYMENT.md
2. health from the host
3. walk.mjs (38+ steps) and csp-probe.mjs, with 0 CSP violations
4. the a11y check (frontend/e2e/a11y.mjs) against the CT with axe: 0 serious or critical
5. resilience drill 2 again: a 90 s DB outage with 50 Devices posting, using .scratch/prodtest/resilience/ and load/ scripts. No lockout, Devices resume within one interval, and no false Offline incidents.
6. backup and restore (S5)
7. a full 15-minute baseline: 100 Devices, 30 streams, with the load scripts. Report API p95s and ingest p99.
8. CT restart
9. uninstall --wipe, and remove the CT

Run all suites inside the CT: backend, frontend, Python, shellcheck.

Constraints: follow prod-common.md (below). You are the only agent now: run one stack at a time. Host memory is tight, so stop each stack before the next, and if Claude Code kills a long command, resume from where it stopped. Never commit, push, stash, reset, or checkout.

Ownership: the whole repo, for these fixes only.

Observable acceptance: worker_done with a pass/fail table for Part B, each fix with its test, the baseline numbers, and --files-modified. Use --outcome succeeded only if every Part B step passed.
