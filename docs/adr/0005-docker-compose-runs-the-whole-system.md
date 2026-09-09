---
status: accepted
---

# The supported way to run the system is one Docker Compose file, built from the clone

Getting from a clone to a running system used to mean provisioning MySQL, PM2, nginx, and certificates by hand, and a laptop demo and the district server were different setups. We decided that one `compose.yaml` at the repo root is both: a `db` service (MySQL 8.4 on a named volume), an `api` service (the backend, one instance per ADR 0001, not published), and a `web` service (nginx serving the built frontend and proxying `/api/` with the SSE settings) on one port, plain HTTP. An operator copies `.env.example` to `.env`, sets the two tokens and a database password, and runs `docker compose up -d --build`. Compose refuses to start with any of the three unset. The manual PM2 and nginx guide stays as the fallback for a server that cannot run Docker.

## Considered Options

- **Express serving the frontend, no nginx.** Fewer containers, but the backend takes on static serving and caching it was not written for, and the SSE proxy settings the manual guide already carries would go unused. nginx in a container is the existing deployment shape, containerised.
- **Two published ports with the API's absolute address baked into the frontend build.** Every hostname would mean a rebuild, and CORS would come back. Same origin through nginx means one image works anywhere, so the frontend now treats an unset API address as "this origin".
- **Prebuilt images on a registry with CI.** Seconds to first start, but a registry to keep public, versions to think about, and drift between what is published and what is in `master`. The audience clones the repo and may edit it; a two-minute build is the fair price.
- **TLS inside the stack (Caddy).** A fourth container that cannot be verified without a public address. Boards send `https://` without certificate checks and a LAN browser is fine on HTTP, so TLS is whatever sits in front of the stack, documented.

## Consequences

- Containers run in UTC. The only place a zone matters, migrating an old database's string timestamps, is an explicit `LEGACY_TIME_ZONE` in `.env`.
- The database port is not published; the way in is `docker compose exec db mysql`, and backups are a documented `mysqldump` through the same door.
- There is no seed data. The virtual Device ships in the `api` image so a first run can show a live card with one `docker compose exec` command after registering the hostname in Settings, the same flow a real board needs.
- `backend/docker-compose.yml` remains the throwaway test database and is unrelated to the root file.
