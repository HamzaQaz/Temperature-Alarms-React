---
status: accepted
---

# Two shared secrets instead of user accounts

The site is public on the internet and had no authentication at all: anyone could delete Devices, wipe history, or post fake Readings. District SSO was the obvious "proper" answer but is a project of its own for a tool with one admin. We decided on two environment-variable secrets: an **admin token** required on every mutating request (entered once in the Settings page), and a separate **device token** that firmware sends on every `/api/readings`. Viewing the dashboard and history stays unauthenticated by design. Separate tokens mean a leaked admin token cannot forge Readings and a board pulled off a wall cannot wipe history.

## Consequences

- Rotating the device token means reflashing every board. Keep it in one firmware config header.
- If real logins are ever needed, the admin-token middleware is the single seam to replace.
- The firmware sends the device token over TLS without checking the server certificate (a pinned certificate would need a reflash at every renewal), so the token trusts DNS on each closet's network. Accepted for the same reason as the tokens themselves: one admin, no accounts, no certificate distribution.
