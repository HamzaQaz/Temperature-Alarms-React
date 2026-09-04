# 01 — Repo housekeeping

**What to build:**
The repository contains only the React app, the backend, the firmware, and the docs that describe them. A developer cloning it sees one README that is right about the hardware and one deploy guide with no domain baked in. Both packages build and run exactly as they did before this ticket; nothing user-visible changes.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] The PHP-era `css` and `js` directories, `.DS_Store`, the standalone SQL files, the humidity migration file, the migration summary, security summary, security notice, and quick-start documents, and the domain-named nginx file are deleted
- [ ] `.gitignore` covers OS files, env files, and firmware `config.h`
- [ ] The frontend build script no longer runs `git pull` and writes to the default `dist` directory
- [ ] The backend no longer lists a charting library as a dependency
- [ ] The PM2 config runs a single fork-mode instance, per ADR 0001
- [ ] A README skeleton exists with correct hardware (NodeMCU + DHT11), sections for local dev, API, firmware, and links to `CONTEXT.md` and the ADRs; detail is filled in by ticket 14
- [ ] A `DEPLOYMENT.md` exists with a generic nginx template using a placeholder domain and a placeholder build path, plus PM2 instructions
- [ ] The root package scripts still install, build, and run both packages
- [ ] Both packages build with no errors
