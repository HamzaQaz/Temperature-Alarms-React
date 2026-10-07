# 01 — Graceful shutdown

**What to build:**
On SIGTERM (every `docker compose up -d` that recreates `api`, and every `deploy`), the backend stops taking requests, lets the notifier and Offline sweep finish the pass they are in, closes SSE streams, and closes the pool, all within Docker's 10 s grace. Today `index.ts` starts the retention job, the Offline sweep, and the notifier and never stops them, so a deploy can cut a sender pass mid-send (it rolls back and resends, which ADR 0008 accepts, but a clean stop avoids the duplicate).

**Blocked by:** none

**Status:** ready-for-agent

- [ ] `startRetentionJob`, `startOfflineSweep`, and `startNotifier` each return a `stop(): Promise<void>` that clears the timer and waits for an in-flight pass
- [ ] `index.ts` handles SIGTERM and SIGINT: `server.close()`, end SSE streams (clients reconnect in 2 s), stop the jobs, `pool.end()`, exit 0; a second signal or 8 s exits at once
- [ ] Health answers 503 while stopping, so a proxy stops sending
- [ ] Tests: `stop()` waits for a pass in flight; a test server shuts down cleanly with a stream open

## Comments
