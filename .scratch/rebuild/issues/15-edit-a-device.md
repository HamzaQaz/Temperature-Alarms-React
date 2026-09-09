# 15 — Edit a Device

**What to build:**
An admin corrects a Device's Closet name or moves it to another Campus without deleting it, so a typo never costs the Readings the product exists to keep. The hostname stays immutable: a replaced board is a new Device. Raised by the Settings critique of 2026-09-07 (`.impeccable/critique/2026-09-07T20-06-26Z__frontend-src-pages-settings-tsx.md`), which found delete-and-re-add to be the only correction path.

**Blocked by:** 10 — History by day

**Status:** done

- [x] `PATCH /api/devices/:id` accepts `{closet?, campusId?}`, requires the Admin token, validates as `POST /api/devices` does (closet 1 to 50 characters, campus must exist), and returns the updated Device with its Campus
- [x] The hostname is not editable: a body carrying `hostname` is 422 with a message saying a replaced board is a new Device
- [x] Readings are untouched by an edit; the dashboard and History show the new Closet and Campus on the next load
- [x] Settings gains an inline edit per Device row (pencil beside the trash): Closet text field and Campus select, Save and Cancel, the same InlineForm look as Add, 401 routed to the token prompt
- [x] After a save, focus returns to the row's edit button and a status line names the change
- [x] HTTP tests cover a closet rename, a campus move, an unknown campus, an attempt to change the hostname, and 401 without the token

## Comments

2026-09-09: Implemented. `PATCH /api/devices/:id` with `parseDeviceEdit` (only the fields present are validated; a body with neither closet nor campus is 422). The browser check caught that the CORS allow-list lacked PATCH; now allowed and covered by a preflight test. Settings turns the row into the same InlineForm as Add, with the hostname shown read-only and the reason beside it; an untouched form closes like Cancel without a request. Verified in Chromium: focus returns to the row's edit button after save and cancel, the status line names the change, a rejected token routes to the token panel, and the form stacks at 420px without sideways scroll.
