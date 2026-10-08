# 01 — Sign in with a username and password, and manage users

**What to build:**
The site asks for a username and password before showing anything: the Dashboard, Campuses, Incidents, History and Settings are all behind sign-in, and so is the API they read. Admins add, edit, disable and remove users on Settings. A fresh install has one user, `admin` with password `admin`. Asked for by the owner, 2026-10-08.

This reverses ADR 0003's "viewing the dashboard and history stays unauthenticated by design" and replaces pasting the Admin token in Settings with signing in. A new ADR records it and marks 0003's viewing clause superseded. The Device token is unchanged. `ADMIN_TOKEN` stays as the machine credential for the bench watcher, `deploy.sh`/`deploy.ps1` and `e2e/walk.mjs`, so none of them changes.

**Blocked by:** none

**Status:** needs-triage

**GitHub:** #38

- [ ] Users in the database (a migration): username (unique, case-insensitive), password hash, role (`admin` or `viewer`), disabled flag, created and last-sign-in times. Passwords hashed with Node's `crypto.scrypt` and a per-user salt, compared in constant time; no new dependency
- [ ] First start with no users creates `admin` / `admin` with role admin, and logs that it did (never the password of any other user)
- [ ] Signing in with `admin` / `admin` (the default still in place) goes straight to a "Choose a new password" screen and nothing else until it is changed; the API refuses everything but that change for this session
- [ ] `POST /api/session` (sign in), `DELETE /api/session` (sign out), `GET /api/session` (who am I). A session is a random id in an `HttpOnly`, `SameSite=Strict` cookie (`Secure` over https), stored server-side so sign-out and disabling a user end it at once. It expires after 12 h idle and 7 days at most
- [ ] Sign-in failures say only "Wrong username or password", and are limited per address and per username (as the wrong-token limit is), so admin/admin cannot be guessed at speed
- [ ] Every API route the pages read (`/api/dashboard`, the stream, History, Incidents, Campuses, Devices) needs a session; every change needs an admin session or the Admin token; `/api/readings`, `/api/firmware` (Device token) and `/api/health` stay as they are. The SSE stream is authorized by the cookie, and a session that ends closes it
- [ ] Frontend: loading any page without a session shows a sign-in page, per DESIGN.md, and returns to the page asked for. A user menu shows who is signed in and has Sign out. The Admin-token box on Settings goes. Viewers see Settings' change controls hidden; the server refuses them anyway
- [ ] Settings, Users tab (admins only): list users (role, disabled, last sign-in); add one with a username, role and starting password; reset a password; change a role; disable or delete. The last enabled admin cannot be demoted, disabled or deleted, and you cannot delete yourself
- [ ] Every user can change their own password (current one required); at least 8 characters, except that it may not stay `admin`
- [ ] `deploy.sh`/`deploy.ps1` gain `reset-admin-password` for a locked-out owner: sets a typed password (never echoed) on an admin, or recreates `admin` if none is left
- [ ] Tests at the HTTP seam: no session → 401 on every read route and the stream; a viewer → 403 on every change; the Admin token still works for changes; the forced first change; sign-in limit; disabled user and sign-out end the session (stream included); the last-admin rules; cookie flags. Frontend: the sign-in redirect and return; the Users tab's refusals. `e2e/walk.mjs` signs in
- [ ] README, DEPLOYMENT.md, the new ADR, CONTEXT.md (User, Admin, Viewer)

**Decisions to confirm (owner):**
- Two roles, Admin and Viewer. Or only admins (everyone who signs in can change everything)?
- Wall displays (a Dashboard on a TV in a closet office) now need someone to sign in, and stay signed in for at most 7 days. Is that acceptable, or should there be a read-only kiosk link?
- `admin` / `admin` must be changed on first sign-in. Proposed because the site is on the internet and the pair is the first thing anyone tries; strike it if the owner wants it kept.

## Comments
