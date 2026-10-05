Name: resilience. Report: .scratch/prodtest/resilience.md. Scripts: .scratch/prodtest/resilience/.

Target: how the production stack fails and recovers, and the upgrade path the district will take. Use your own project `ta-res` on port 8096 with a scratch env, following the memory rule. You may reuse the load agent's simulators in .scratch/prodtest/load/ (run 50 Devices posting the whole time).

**Failure drills.** For each drill, record what Devices, browsers, and the data saw, and how long recovery took:
1. `docker kill` of the api mid-ingest: Readings lost (count them), how Devices see it (5xx or connection refused; check what the firmware does, from arduino/TemperatureAlarms/network.cpp: does it retry, drop, or buffer?), whether browsers' SSE reconnects on its own and the dashboard catches up without a reload, and whether incidents stay consistent (no duplicate open incident, no lost close).
2. `docker kill` of the db: the api's behaviour (does it crash-loop, or report unhealthy and recover when the DB returns?), the healthcheck status, and recovery.
3. Restart of web (nginx) while streams are open.
4. A whole-stack `docker compose restart`, and a host reboot simulated by `docker compose down` then `up` without -v: data intact, migrations a no-op, and the Offline sweep not raising false incidents for every Device after the downtime (or, if it does, say whether that is right).
5. Disk pressure: what happens when MySQL cannot write. Simulate with a small tmpfs or a full volume if feasible; otherwise reason it from the code and say so.
6. Clock skew: a Device has no clock (server timestamps), but check that the server's TZ and DST handling for the Overnight window and the overview's local days come out right across the next DST change (simulate with TZ and a fixed clock in tests if needed).
7. A slow network (`tc` in the api container, or a toxiproxy container) between the api and the db: ingest timeouts, and no connection-pool exhaustion.

**Upgrade path.**
1. Deploy commit fa39159 (master before the incident log, which is what an early adopter might run), seeded with Devices and 2 days of Readings.
2. Upgrade to current master exactly as DEPLOYMENT.md says: `deploy/deploy.sh deploy --pull`, or the documented sequence.
3. Verify that migration 0005 applied, the data is intact, incidents begin recording, and the downtime is measured.
4. Roll back to fa39159 (it should run with the extra tables present), then forward again.
5. Take a backup before the upgrade and restore it after, to prove the documented restore path.
6. Also run the legacy-table migration (ticket 11 / ADR 0002) from a small set of synthetic old per-Device tables, end to end, through the deploy script's migrate-legacy.

Do not change product code. For each failure, write the cause and the exact recommended fix in your report (blocker / should-fix / note). The coordinator routes it.

Constraints: follow prod-common.md. You start after the load agent finishes, so the host has the memory. Leave nothing running.

Ownership: .scratch/prodtest/resilience/, .scratch/prodtest/resilience.md, and .scratch/prodtest/runs/.

Observable acceptance: worker_done with the drill table, the upgrade/rollback/restore results, the findings with their fixes, and confirmation that nothing is left running. Use --outcome succeeded if every drill and the upgrade path ran.
