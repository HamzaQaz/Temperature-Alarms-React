Target: backend/ (src, test, scripts, Dockerfile, migrations) against the backend parts of tickets 03, 04, 05, 06, 08, 09, 10, 11, 12, 15, 17.

Change: write a review report to .scratch/rebuild/reviews/backend.md. Run the backend checks: in backend/, `npm run test:db` (MySQL on 127.0.0.1:3307), `npm test`, `npm run typecheck`, then `npm run test:db:down`. If :3307 is already up and healthy, another worker owns it: use it and do not take it down. Look especially for security (token checks, timing-safe compare, SQL injection), data loss, SSE connection leaks, migration idempotency, retention locking, rate-limit correctness, and validation gaps.

Constraints: read-only except the report file.

Ownership: .scratch/rebuild/reviews/backend.md only.

Observable acceptance: the report exists with findings ranked most severe first, or an explicit "no findings" per ticket, plus the check results. Send worker_done with --report-path pointing at it and --outcome succeeded if the review completed (findings are not a failure).
