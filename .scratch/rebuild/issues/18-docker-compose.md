# 18 — Run the whole system with Docker Compose

**What to build:**
An Operator clones the repo, copies `.env.example` to `.env`, sets two tokens and a database password, and `docker compose up -d --build` gives them the dashboard on one port with a persistent database, on a laptop or on the district server alike. Decided in the grilling of 2026-09-09; the trade-offs are in ADR 0005.

**Blocked by:** 14 — Docs, deploy, and end-to-end verification

**Status:** ready-for-agent

- [ ] `compose.yaml` at the repo root defines `db` (MySQL 8.4, named volume, healthcheck, port not published), `api` (built from `backend/Dockerfile`, one instance, healthcheck on `/api/health`, not published, waits for `db` healthy), and `web` (built from `frontend/Dockerfile`, nginx serving the built frontend and proxying `/api/` with the SSE settings, published on `WEB_PORT`, default 80); all `restart: unless-stopped` with log rotation capped
- [ ] A root `.env.example` carries `ADMIN_TOKEN`, `DEVICE_TOKEN`, `DB_PASSWORD` (required; Compose refuses to start naming any that is unset, with an `openssl rand -hex 32` hint), `WEB_PORT`, and the backend's optional settings including a commented `LEGACY_TIME_ZONE`; `.env` is gitignored
- [ ] Both Dockerfiles are multi-stage on Node 22 Alpine: the backend image runs `dist/index.js` as a non-root user and carries `scripts/mock-device.mjs`; the frontend image builds with no API address and serves from nginx
- [ ] The frontend treats an unset `VITE_API_URL` as same-origin; local dev with `.env` pointing at port 3001 is unchanged
- [ ] `DEPLOYMENT.md` leads with Compose: setup, first run, upgrades (`git pull` and rebuild), backups and restore through `docker compose exec db`, migrating an old database in (dump, restore into the volume, `LEGACY_TIME_ZONE`, then `migrate:legacy` through `exec`), and TLS in front of the stack; the manual PM2 and nginx path stays below as the fallback
- [ ] README's local development, deployment, and firmware sections say the stack is the way to run it, that boards point `SERVER_URL` at `http://<host>` (the port only if changed), and how to run the virtual Device against the stack with `docker compose exec`
- [ ] Verified from a clean clone against Docker Desktop: build, `up`, health, the ticket 14 end-to-end walk through the published port (Settings, a Reading with the Device token, the card live over SSE through nginx, History, wrong tokens refused), the virtual Device posting through `exec`, data surviving `down` and `up`, and `down -v` wiping it
- [ ] Lint, typecheck, and both test suites still pass; `backend/docker-compose.yml` and `npm run test:db` are unchanged
