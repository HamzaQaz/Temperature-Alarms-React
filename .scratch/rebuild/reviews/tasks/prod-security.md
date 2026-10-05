Name: security. Report: .scratch/prodtest/security.md.

Target: a production security review of the whole system as deployed by compose.yaml behind nginx: backend/src, frontend/src (read only), frontend/nginx.conf, the Dockerfiles and compose (read only), deploy/ (read only), and the firmware's use of the Device token (read only).

Check and prove each with a test or a curl:
- **Tokens.**
  - The Admin and Device tokens are compared in constant time, are never logged, and are never echoed in errors.
  - The Admin token is stored in browser localStorage: assess the XSS exposure.
  - The Device token is sent in plain HTTP by design (ADR 0001/0003): say what that means on a school LAN, and what the TLS-in-front option already covers.
- **Rate limits:**
  - per Device, and the general /api/ limit with trust proxy 1 behind nginx
  - brute force of the Admin token: how many guesses per hour from one host, and is that acceptable?
- **Input.**
  - SQL injection on every route, including query params on incidents, overview, and history.
  - Oversized bodies, unicode or emoji in Closet and Campus names, and XSS via Closet/Campus names rendered in the UI.
  - Header injection.
- **HTTP hardening.**
  - nginx security headers: CSP, X-Content-Type-Options, Referrer-Policy, frame-ancestors, Permissions-Policy.
  - CORS behaviour, and whether the server version is hidden.
  - Error pages that leak stack traces.
  - The SSE endpoint: the limit on open streams per IP, so it cannot exhaust file descriptors.
- **Secrets:**
  - .env permissions
  - nothing secret in images (`docker history`), logs, or backups' file permissions
  - deploy.sh's handling of tokens (`info --reveal`)
- **Dependencies:** `npm audit --omit=dev` in backend and frontend, and the base-image freshness in both Dockerfiles.
- **Containers:** non-root, read-only root filesystem feasibility, cap_drop, `no-new-privileges`, and MySQL not published.

Fixes: make them in backend/src, test-first. Bump backend and frontend dependencies only for real advisories, keeping the suites green. For nginx, Dockerfile, and compose hardening (the CT agent owns those files), write the exact diff in your report under "Infra changes to route"; do not edit those files.

Constraints: follow prod-common.md (below). Bring up a full stack only if you need one for the header and HTTP checks, on port 8098 with project `ta-sec`, following the memory rule.

Ownership: backend/src, backend tests, the package.json/package-lock.json files (for advisories only), and .scratch/prodtest/security.md.

Observable acceptance: worker_done with the pass/fail table, the findings by severity, the fixes with their tests, the infra diffs to route, and --files-modified. Use --outcome succeeded if the review completed and the suites are green.
