Target: frontend/ (src, nginx.conf, Dockerfile), the `web` service block of compose.yaml, and PRODUCT.md.

Change:
1. Fix findings 1 to 16 in .scratch/rebuild/reviews/frontend.md (your own review), the bugs first. For the DESIGN.md standards items, follow DESIGN.md exactly; if an item turns out to be a judgement call, say which way you went and why.
2. Finding 17, decided by the coordinator: keep the browser-side summary arithmetic (tickets 07 and 08 accepted it) and soften PRODUCT.md's line so it says Conditions and their levels come only from the API, while the dashboard's summary tiles may total what the API returned. Do not move the summary into the API.
3. The backend's History response now carries an additive `truncated: true` when a day exceeded 30,000 rows (backend/src/routes/readings.ts). Show a short, quiet note on the History page when it is set, and type the field.
4. From .scratch/rebuild/reviews/firmware-docs.md: finding 13 (index.html gets `Cache-Control: no-cache` in frontend/nginx.conf, hashed assets stay long-cached) and finding 15 (the web container runs nginx as non-root, for example nginxinc/nginx-unprivileged listening on 8080, and gets a healthcheck in compose.yaml's web service; keep the published host port `${WEB_PORT:-80}` the same for operators). Finding 10's root cause was fixed in the backend (trust proxy 1); leave nginx's X-Forwarded-For line as it is unless the fix needs it.
5. Re-run the UI walk the same way you did (project `uireview`, WEB_PORT=8081, scratch env file outside the repo, seeded with mock-device.mjs), confirming each fixed UI finding at 375 px and desktop and both themes, plus `node frontend/e2e/walk.mjs` (or however README says to run it) against the fresh stack. Then `docker compose -p uireview down -v` and delete the scratch env file.

Constraints: several Orca workers share this worktree; never commit, stash, reset, or checkout. Another worker (deploy tooling) may touch compose.yaml: edit only the `web` service block, re-read the file just before editing, and keep the change minimal. Do not edit backend/, arduino/, DEPLOYMENT.md, or README.md; if the README's description of the web container (port, user) needs updating, list the exact sentences in your summary instead.

Ownership: frontend/, compose.yaml (web block only), PRODUCT.md. Append a "Fixed" note per finding at the bottom of .scratch/rebuild/reviews/frontend.md, with new screenshots under .scratch/rebuild/reviews/ui/.

Observable acceptance: in frontend/, `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` pass under PowerShell; `docker compose config` is valid; the walk passes; each fixed UI finding is confirmed on screen. Send worker_done with --files-modified; --outcome succeeded only if all of that holds.
