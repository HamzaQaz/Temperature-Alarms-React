# 05 — Devices end to end

**What to build:**
An admin adds a Device by hostname, Campus, and Closet name, and deletes one. Hostnames are validated, the Campus is picked from a dropdown, deleting a Device removes its Readings, and a Campus that still has Devices cannot be deleted. The Alarms feature is gone.

**Blocked by:** 04 — Campuses end to end with the Admin token

**Status:** ready-for-agent

- [ ] `GET`, `POST`, and `DELETE` for devices, with the same token rules as campuses
- [ ] Hostname must match `ESP_` plus six hex digits; the server rejects anything else with 422 and the form validates client-side too
- [ ] Deleting a Device cascades to its Readings
- [ ] Deleting a Campus with Devices returns 409 and the UI explains why
- [ ] The Devices tab shows Campus name and Closet, adds with a Campus dropdown, and deletes behind a confirmation
- [ ] The Alarms tab, its API routes, and its types are removed
- [ ] HTTP tests cover list, add, invalid hostname, duplicate hostname, delete with cascade, and campus-with-devices refusal
