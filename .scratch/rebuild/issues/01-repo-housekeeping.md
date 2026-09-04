# 01 — Repo housekeeping

**What to build:**
The repository contains only the React app, the backend, the firmware, and the docs that describe them. A developer cloning it sees one README that is right about the hardware and one deploy guide with no domain baked in. Both packages build and run exactly as they did before this ticket; nothing user-visible changes.

**Blocked by:** None — can start immediately

**Status:** done

- [x] The PHP-era `css` and `js` directories, `.DS_Store`, the standalone SQL files, the humidity migration file, the migration summary, security summary, security notice, and quick-start documents, and the domain-named nginx file are deleted
- [x] `.gitignore` covers OS files, env files, and firmware `config.h`
- [x] The frontend build script no longer runs `git pull` and writes to the default `dist` directory
- [x] The backend no longer lists a charting library as a dependency
- [x] The PM2 config runs a single fork-mode instance, per ADR 0001
- [x] A README skeleton exists with correct hardware (NodeMCU + DHT11), sections for local dev, API, firmware, and links to `CONTEXT.md` and the ADRs; detail is filled in by ticket 14
- [x] A `DEPLOYMENT.md` exists with a generic nginx template using a placeholder domain and a placeholder build path, plus PM2 instructions
- [x] The root package scripts still install, build, and run both packages
- [x] Both packages build with no errors

## Comments

**2026-09-04 — implemented.** Also removed the hardcoded `outDir` (`/var/www/envn/dist`) from `frontend/vite.config.ts`, which was the real source of the fixed build path, and deleted the Vite-template `frontend/README.md` so there is one README. Code review flagged that the README and DEPLOYMENT.md described the migration runner, tokens, and DHT11 sketch as if already present; those sections now say explicitly that they land with later tickets. With `data.sql` gone, a fresh database cannot be provisioned until ticket 3's migration runner exists; DEPLOYMENT.md says so.
