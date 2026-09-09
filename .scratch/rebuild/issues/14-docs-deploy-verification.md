# 14 — Docs, deploy, and end-to-end verification

**What to build:**
A new operator can clone the repo, follow the README and `DEPLOYMENT.md`, and get from a blank server to a board's Reading appearing on a card, with nothing left over from the old system. Every earlier ticket's behaviour is confirmed together.

**Blocked by:** 10 — History by day; 11 — Legacy table migration; 12 — 90-day retention job; 13 — DHT11 firmware

**Status:** done

- [x] The README is correct about the hardware, describes local dev for both packages including the Docker test database, lists every API route with its token requirement, and links the firmware section, `CONTEXT.md`, and the ADRs
- [x] `DEPLOYMENT.md` covers MySQL setup, env variables including both tokens, running the migrations, the legacy-table verification and drop, nginx with a placeholder domain and the SSE proxy settings, PM2 as a single instance, and certificate renewal
- [x] Both `.env.example` files are complete and match the config module
- [x] The full flow is exercised end to end: fresh database, backend up, Campus and Device created through Settings, a Reading posted with the Device token, the card updates live, History shows the day, a wrong token is refused
- [x] Lint, typecheck, and the backend test suite all pass from a clean clone
- [x] No reference to the old domain, the old sensor, the Alarms feature, or per-Device tables remains anywhere except the ADRs

## Comments

**2026-09-09 — done.** Verification record for this ticket:

- **README.** Prerequisites now name MySQL 8 and Docker; a "Tests and checks" section covers the Docker Compose test database, `TEST_DATABASE_URL`, `npm test`, `npm run typecheck`, and the frontend lint and typecheck. The API section lost its "converging on" caveat and now lists every mounted route with its token and its request and response shape, checked against `backend/src/routes/*.ts`. Devices list by Campus name then closet; the stream sends unnamed messages whose data carries `type: "reading"`.
- **DEPLOYMENT.md.** Step 3 gained a table of the required env variables with both tokens and how to generate them; step 6 explains certbot's renewal timer and that Devices need no reflash at renewal; Checks gained a curl walk (201 with the Device token, 401 with a wrong one) and the Settings → dashboard → History path. MySQL setup, migrations, the legacy verification and drop, the nginx SSE settings, and the single PM2 instance were already in place from tickets 01, 09, 11, and 12.
- **`.env.example`.** Backend: dropped `NODE_ENV` (the config module never reads it; `ecosystem.config.js` sets it for PM2). Every other key matches `config.ts` one for one. Frontend: `VITE_API_URL` is the only variable `frontend/src` reads.
- **End to end**, driven by Playwright against a fresh `temperature_alarms_e2e` database on the scratch MySQL and a backend started with `ADMIN_TOKEN=e2e-admin DEVICE_TOKEN=e2e-device`: 23 of 23 checks passed. Fresh database empty; Admin token pasted in Settings; Campus `chs` added and shown as `CHS`; Device `ESP_C0FFEE` added with the campus picker; dashboard card "No readings yet"; a Reading with a wrong Device token, no token, and the Admin token each 401; a Campus with a wrong Admin token and with the Device token each 401; a Reading with the Device token 201, card flipped to 72 °F / 41 % and Online without a reload; a 91 °F Reading flipped the card to Hot · critical live; History showed today with both Readings and a summary (min 72, max 91, avg 81.5); after a reload the card still showed 91. NumberFlow keeps its digits in shadow DOM, so the script reads them from there rather than from `innerText`.
- **Clean clone.** `git clone` into the scratchpad, `npm run install:all`, then backend `npm run typecheck` and `npm test` (159 tests, 0 failures) and frontend `npm run lint` and `tsc -b`: all exit 0.
- **Stale references.** `git grep` finds no `envn.celinaisd.tech`, no DS18B20, OneWire, or Dallas, and no MariaDB claim outside the ADRs. The words "per-Device tables", `ESP_xxxxxx` table names, and the `alarms` table remain only where they are the subject: the legacy-migration section of `DEPLOYMENT.md`, the migration code and its tests, and the `LEGACY_TIME_ZONE` comments. "Celina ISD" in the sidebar is the district, not the old domain, and stays.
- **Code review** (Standards and Spec axes, both agents): fixed the vocabulary slips ("board" for Device, "row" for Campus or Device), the dashboard row that read as if Devices were ordered worst first, the missing 400 and 429 statuses, the "all three" count, the thresholds pointer (they live in `.env.example`, not `CONTEXT.md`), the certbot wording, and the Checks advice that told the operator to Reset history after the real Device was reporting (that deletes every Reading of the Device). `backend/docker-compose.yml` now publishes the test database on `127.0.0.1:3307` only, as the README says. Left alone: the required-variable list appearing in both README and DEPLOYMENT.md (one sentence each, on purpose).
