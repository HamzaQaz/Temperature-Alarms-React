Name: load. Report: .scratch/prodtest/load.md. Scripts: .scratch/prodtest/load/ (Node, no new repo dependencies; use undici/fetch).

Target: the production stack (compose.yaml, not the demo) under the district's real load and 3× headroom. It runs on your own project `ta-load`, port 8095, with a scratch env file outside the repo, and it must follow the memory rule.

Build and run, in this order:
1. **Write the scripts first** (no stack needed): a Device simulator that registers N Devices through the admin API and posts every 30 s with jitter, with values that drift and occasionally cross thresholds (about 5% of Devices in some Condition at any time); a browser simulator that opens M SSE streams on /api/dashboard/stream and measures the delivery latency from a Reading's POST to its arrival on every stream; and an HTTP poller for /api/dashboard, /api/campuses/overview, /api/incidents, and a History day, with p50/p95/p99 latency.
2. **Baseline:** 100 Devices, 30 streams, 15 minutes. Record ingest p99, SSE fan-out p99, API p95s, CPU and memory per container (`docker stats`, sampled every 10 s), error and 429 counts (there should be none), and DB growth per hour extrapolated to 90 days of retention.
3. **Headroom:** 300 Devices and 60 streams for 10 minutes. Find the breaking point if one is under 1000 Devices: where p99 ingest goes over 1 s, or errors appear.
4. **Big data:** load 90 days of Readings for 100 Devices directly into MySQL (about 26 M rows; use batched inserts, which must finish in minutes, not hours). Measure the time for /api/dashboard, the overview (cold and cached), incidents over 7 days, History for one day, the retention job's run, its lock or blocking effect on ingest while it runs (ingest p99 during retention), the Offline sweep with 100 Devices, the backup time and size via `deploy/deploy.sh backup` (use `-p ta-load` if the script supports it), and the restore time.
5. **NAT and many devices:** confirm that the per-Device limit holds when all traffic comes from one IP, so no 429s at 100 Devices.

Do not change product code. If something fails or is slow, find the cause (EXPLAIN, a profile) and write the exact recommended fix in your report as a blocker or should-fix. The coordinator will route it.

Constraints: follow prod-common.md. Memory: this stack plus the 26 M rows is heavy, so give MySQL what it needs, and if the host runs short, scale the big-data step down to 30 days and extrapolate. Tear down with `down -v`.

Ownership: .scratch/prodtest/load/, .scratch/prodtest/load.md, and .scratch/prodtest/runs/.

Observable acceptance: worker_done with the measured table (baseline, headroom, big data), the breaking point, the findings with their recommended fixes, and confirmation that the stack is down. Use --outcome succeeded if all three phases ran.
