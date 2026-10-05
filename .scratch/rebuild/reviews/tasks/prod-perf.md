Name: perf. Report: .scratch/prodtest/perf.md.

Target: the load agent's findings in .scratch/prodtest/load.md (read it fully: it has exact EXPLAINs, measurements, and proposed fixes), plus one coordinator decision.

Change:
1. **B1 (blocker).** The Campuses overview day-maxima query (backend/src/routes/campusOverview.ts) scans the whole readings index: 28 s cold and 8.7 s cached at 26M rows, and it starved ingest. Apply the measured fix:
   - an IN-list range query
   - a covering index `(device_id, recorded_at, temp_f)`, added through a new versioned migration (0006), re-runnable like the others, and built so it does not lock ingest for long on a large table. Use ALGORITHM=INPLACE, LOCK=NONE if MySQL 8.4 allows it, and measure the build time at 26M rows.
   - Keep the 5-minute cache of completed days.
   - Check whether the Dashboard's latest-Reading query, History, or incidents could use the same index or are hurt by it (insert cost per Reading).
2. **S2.** Run the compose `db` service with `--disable-log-bin` and `--innodb-buffer-pool-size=512M` (compose.yaml and compose.demo.yaml), and record why in DEPLOYMENT.md:
   - there is no replication and no point-in-time recovery; backups are the mysqldump files
   - the RAM guidance changes: update the Proxmox LXC section's numbers if needed
   - Confirm that backup and restore through deploy.sh still work with the binary log off.
3. **S3.** A host clock step froze the dashboard cards and locked Devices out of the per-Device write limiter (see the load report). Find the cause on both sides:
   - The limiter's window probably uses wall-clock time. Use a store or window robust to a backwards step, or at least make a step heal within one window.
   - The cards' late/Offline timing probably mixes the browser's clock with server timestamps. Base it on the server's `secondsSinceReading` and the elapsed time since the fetch (performance.now()), not Date.now() minus a server timestamp.
   - Add tests that simulate a step (fake timers).
4. **Coordinator decision (T1):** raise the per-address SSE stream cap from 20 to 60, at both the API (backend/src/sse.ts) and nginx (`limit_conn` in frontend/nginx.conf), and keep the 400 total. The load test showed 60 streams cost about nothing. Update the tests and DEPLOYMENT.md, and check that TRUST_PROXY's real-ip path still applies it per client.

Verify:
- Backend `npm test` and `typecheck`; frontend `lint`, `typecheck`, `test`, and `build`.
- Re-run B1 at scale with the load agent's scripts (.scratch/prodtest/load/; read its README or header comments): load 90 days for 100 Devices if memory allows (MySQL capped as the load agent did), otherwise 30 days, then measure the overview cold and cached, ingest p99 with 4 Campuses tabs open, and the migration's index build time.
- Run the 15-minute baseline once more on the final build to confirm nothing regressed.
- Tear everything down.

Constraints: follow prod-common.md (below). The resilience agent runs at the same time with its own stack (ta-res, :8096), so follow the memory rule strictly: big-data verification only when the host has room (`docker stats` under 3.5 GB, and free host RAM over 1.5 GB per `Get-CimInstance Win32_OperatingSystem`). Otherwise wait, checking every 2 minutes, and say how long you waited.

Ownership: backend/src, backend/test, the frontend/src timing code for S3, compose.yaml, compose.demo.yaml, frontend/nginx.conf, DEPLOYMENT.md, README.md (deployment sections), .scratch/prodtest/perf.md, and .scratch/prodtest/runs/.

Observable acceptance: worker_done with before/after numbers for B1 (cold, cached, ingest p99 under the 4 tabs) and the index build time, S2/S3/T1 done with their tests, the baseline re-run numbers, all suites green, and --files-modified.
