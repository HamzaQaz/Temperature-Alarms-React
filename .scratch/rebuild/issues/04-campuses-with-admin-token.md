# 04 — Campuses end to end with the Admin token

**What to build:**
An admin opens Settings, is asked once for the Admin token, and can add and delete Campuses. Anyone can list them. A wrong token produces a clear "not authorised" message rather than a generic failure. This is the first `/impeccable` pass on Settings.

**Blocked by:** 02 — Frontend dead code and dependency cleanup; 03 — Backend skeleton, config, schema, and test harness

**Status:** done

- [x] `GET /api/campuses` needs no token and returns camelCase objects
- [x] `POST /api/campuses` and `DELETE /api/campuses/:id` require the Admin token as a bearer token and return 401 without it
- [x] Shared auth middleware exists and is the only place the Admin token is checked
- [x] Frontend types use the API's camelCase shape, not database column casing
- [x] A single API client module attaches the stored Admin token to mutating calls and surfaces 401 as a distinct error
- [x] Settings prompts for the token when none is stored or when a request returns 401, and remembers it in the browser
- [x] The Campuses tab lists, adds, and deletes, with the delete behind a confirmation
- [x] The Settings page has had an `/impeccable` pass: hierarchy, spacing, loading, empty, and error states
- [x] HTTP tests cover list, add, delete, missing token, wrong token, and duplicate shortcode

## Comments

Done 2026-09-04. Backend: `GET/POST/DELETE /api/campuses` in `backend/src/routes/campuses.ts`, guarded by the existing `requireAdminToken` middleware; shortcodes are trimmed and upper-cased; duplicate shortcode is 409, campus-with-devices delete is 409, unknown id is 404; 11 HTTP tests in `backend/test/campuses.test.ts`. Frontend: `src/api.ts` is the single client (`ApiError`, `UnauthorisedError`, token attached to non-GET calls), token store in `src/lib/adminToken.ts`, Settings rebuilt as tabs with an inline Admin token panel and per-section loading, empty, and error states. Devices and Alarms tabs are wired to the legacy routes and show a load error until ticket 05 adds the routes.
