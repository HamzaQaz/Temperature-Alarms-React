Name: trust-proxy. Report: append a "TRUST_PROXY" section to .scratch/prodtest/security.md.

Target: the should-fix I1 from the infra agent (see .scratch/prodtest/security.md). Behind the TLS proxy that DEPLOYMENT.md documents ("TLS in front of the stack": Caddy or host nginx in front of the web container), every browser and every Device arrives at our nginx from the proxy's one address. Then:
- the API's per-address limits apply to the proxy's address district-wide: the 20-SSE-streams cap, so 20 dashboards for the whole district; the Device-token failure cap; and the general /api/ limit
- nginx's own `limit_conn` for the stream does the same

Change: add an opt-in `TRUST_PROXY` setting (in .env and compose, documented) that names the front proxy's address or CIDR (one or more, comma-separated). Default empty, meaning today's behaviour. When set:
- nginx (frontend/nginx.conf, frontend/security-headers.conf, or an include) uses `set_real_ip_from <each>` and `real_ip_header X-Forwarded-For` with `real_ip_recursive on`, so `$remote_addr` (and therefore `limit_conn` and the X-Forwarded-For it sends on) is the browser's real address.
  - nginx config is static, so use the nginx image's built-in envsubst templates (/etc/nginx/templates/*.template, supported by nginxinc/nginx-unprivileged) or an entrypoint snippet.
  - It must still run as non-root with a read-only root filesystem: check where the templates render (/etc/nginx/conf.d needs to be writable, so use a tmpfs mount in compose if needed).
- The backend keeps `trust proxy` at 1 hop (our nginx), which is correct once nginx has already resolved the real client address. Verify that this holds, and that a client cannot spoof X-Forwarded-For through the front proxy: only the configured proxy addresses are trusted by nginx.

Tests:
- Backend unit tests if any backend change is needed.
- An end-to-end proof: a compose stack (project `ta-tp`, port 8099, following prod-common.md's memory rule) with a throwaway caddy:2-alpine container in front, on the same Docker network, per DEPLOYMENT.md's Caddyfile. With TRUST_PROXY set to Caddy's address, open 25 streams from two different simulated clients (distinct X-Forwarded-For values sent to Caddy, which appends them): each client gets its own 20.
- A spoof attempt (a client setting X-Forwarded-For itself) does not escape the per-client cap.
- With TRUST_PROXY empty, behaviour is as today.
- `node frontend/e2e/walk.mjs` passes through Caddy.
- The deploy scripts' install prompts (deploy.sh and deploy.ps1) can ask for TRUST_PROXY only when the operator says a proxy is in front; keep it optional with `--set TRUST_PROXY=...`.
- DEPLOYMENT.md's "TLS in front" section explains when and how to set it.

Constraints: follow prod-common.md (below). The accessibility agent owns frontend/src, so do not edit it. The load agent's stack is heavy: watch memory. Tear down ta-tp and caddy at the end.

Ownership: frontend/nginx.conf, frontend/security-headers.conf, frontend/Dockerfile, compose.yaml, compose.demo.yaml, .env.example, deploy/, DEPLOYMENT.md, README.md (deployment sections), backend/src/config.ts and app.ts if needed with their tests, and the report section.

Observable acceptance: worker_done with the e2e results (per-client caps through Caddy, spoof refused, the default unchanged, the walk passing), the backend and frontend suites green, shellcheck clean, and --files-modified.
