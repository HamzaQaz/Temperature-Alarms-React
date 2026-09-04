# 14 — Docs, deploy, and end-to-end verification

**What to build:**
A new operator can clone the repo, follow the README and `DEPLOYMENT.md`, and get from a blank server to a board's Reading appearing on a card, with nothing left over from the old system. Every earlier ticket's behaviour is confirmed together.

**Blocked by:** 10 — History by day; 11 — Legacy table migration; 12 — 90-day retention job; 13 — DHT11 firmware

**Status:** ready-for-agent

- [ ] The README is correct about the hardware, describes local dev for both packages including the Docker test database, lists every API route with its token requirement, and links the firmware section, `CONTEXT.md`, and the ADRs
- [ ] `DEPLOYMENT.md` covers MySQL setup, env variables including both tokens, running the migrations, the legacy-table verification and drop, nginx with a placeholder domain and the SSE proxy settings, PM2 as a single instance, and certificate renewal
- [ ] Both `.env.example` files are complete and match the config module
- [ ] The full flow is exercised end to end: fresh database, backend up, Campus and Device created through Settings, a Reading posted with the Device token, the card updates live, History shows the day, a wrong token is refused
- [ ] Lint, typecheck, and the backend test suite all pass from a clean clone
- [ ] No reference to the old domain, the old sensor, the Alarms feature, or per-Device tables remains anywhere except the ADRs
