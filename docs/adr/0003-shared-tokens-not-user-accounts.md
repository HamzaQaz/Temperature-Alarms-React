---
status: accepted
---

# Two shared secrets instead of user accounts

The site is public on the internet and had no authentication at all: anyone could delete Devices, wipe history, or post fake Readings. District SSO was the obvious "proper" answer but is a project of its own for a tool with one admin. We decided on two environment-variable secrets: an **admin token** required on every mutating request (entered once in the Settings page), and a separate **device token** that firmware sends on every `/api/readings`. Viewing the dashboard and history stays unauthenticated by design. Separate tokens mean a leaked admin token cannot forge Readings and a board pulled off a wall cannot wipe history.

## Consequences

- Rotating the device token means reflashing every board. Keep it in one firmware config header.
- If real logins are ever needed, the admin-token middleware is the single seam to replace.
- The firmware sends the device token over TLS without checking the server certificate (a pinned certificate would need a reflash at every renewal), so the token trusts DNS on each closet's network. Accepted for the same reason as the tokens themselves: one admin, no accounts, no certificate distribution.

## Note (2026-10, production security review)

- The device token sits in plain text in every board's flash, and the ESP8266 has no flash encryption, so anyone holding a board can read it with `esptool read_flash`. It is one token for every board: a single lost board exposes the fleet's ability to post Readings (only for registered hostnames, at most 20 a minute each), though never to change Campuses or Devices.
- The backend accepts one device token at a time, so a rotation is a flag day: from the moment `DEVICE_TOKEN` changes, every board still on the old token is refused until it is reflashed. The README's "Secrets on the board" gives the procedure. Accepting a previous token during a rotation window, or per-Device tokens, would be a new decision.
