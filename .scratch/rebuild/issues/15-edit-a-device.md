# 15 — Edit a Device

**What to build:**
An admin corrects a Device's Closet name or moves it to another Campus without deleting it, so a typo never costs the Readings the product exists to keep. The hostname stays immutable: a replaced board is a new Device. Raised by the Settings critique of 2026-09-07 (`.impeccable/critique/2026-09-07T20-06-26Z__frontend-src-pages-settings-tsx.md`), which found delete-and-re-add to be the only correction path.

**Blocked by:** 10 — History by day

**Status:** ready-for-agent

- [ ] `PATCH /api/devices/:id` accepts `{closet?, campusId?}`, requires the Admin token, validates as `POST /api/devices` does (closet 1 to 50 characters, campus must exist), and returns the updated Device with its Campus
- [ ] The hostname is not editable: a body carrying `hostname` is 422 with a message saying a replaced board is a new Device
- [ ] Readings are untouched by an edit; the dashboard and History show the new Closet and Campus on the next load
- [ ] Settings gains an inline edit per Device row (pencil beside the trash): Closet text field and Campus select, Save and Cancel, the same InlineForm look as Add, 401 routed to the token prompt
- [ ] After a save, focus returns to the row's edit button and a status line names the change
- [ ] HTTP tests cover a closet rename, a campus move, an unknown campus, an attempt to change the hostname, and 401 without the token
