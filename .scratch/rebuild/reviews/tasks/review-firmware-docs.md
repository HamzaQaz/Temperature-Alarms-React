Target: arduino/ (the TemperatureAlarms sketch, bench.py, test_bench.py), compose.yaml, backend/Dockerfile, frontend/Dockerfile and its nginx config, .env.example, README.md, DEPLOYMENT.md, CONTEXT.md, and docs/adr/, against tickets 01, 13, 14, 18, 19.

Change: write a review report to .scratch/rebuild/reviews/firmware-docs.md. Check:
- The firmware: WiFi reconnect, DHT11 bad-sample rejection, HTTP timeouts, millis() wraparound, and the open-network path in network.cpp from commit 3d67145.
- bench.py against ticket 19.
- The containers: non-root, healthchecks, nginx SSE proxying (buffering, timeouts), image size, and no secrets baked into images.
- Every command and claim in README.md and DEPLOYMENT.md against the actual files, as a new operator who follows them literally.

Run `python -m unittest arduino/test_bench.py`. You may validate compose with `docker compose config` using a scratch env file outside the repo, but do not start the stack.

Constraints: read-only except the report. Another worker is writing new deploy tooling (deploy/, .claude/skills/deploy/, and the deployment sections of DEPLOYMENT.md and README.md). Review README.md and DEPLOYMENT.md as they stand at HEAD (`git show HEAD:<path>`) so you do not review half-written edits.

Ownership: .scratch/rebuild/reviews/firmware-docs.md only.

Observable acceptance: the report exists, ranked most severe first. Send worker_done with --report-path and --outcome succeeded if the review completed.
