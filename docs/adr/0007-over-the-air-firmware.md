---
status: accepted
---

# Boards update their firmware over the air, signed builds only

Every change that touches the boards (the server's name, Let's Encrypt's roots, the Device token, a bug fix) used to mean a technician at every closet with a laptop and a USB cable, about 100 visits. Before the production flashing day the owner decided boards update themselves instead (2026-10-06).

- **Pull, hourly.** Each board asks `GET /api/firmware` once an hour (first a minute after boot) with the ESP8266 core's `ESPhttpUpdate`, over the same certificate-checked HTTPS as its Readings (ADR 0001), sending the Device token and its current `FIRMWARE_VERSION`. The server answers 304, or the image when a build with a higher version is published for that Device. Nothing listens on the board: no ArduinoOTA port, no push.
- **Signed, checked on the board.** Builds are signed with an RSA key the district keeps off the server (`private.key` on the build laptop, plus one offline backup). The core's build signs the image when the key is in the sketch folder, and a board built with `public.key` refuses any image without a valid signature before it switches to it. A board built without the key never checks for updates at all, so an unsigned board can never be made to install anything. The server's own copy is therefore not trusted: taking over the server, or the Admin token, is not enough to run code on the boards.
- **The image is a secret.** It holds the WiFi password and the Device token, so the server hands it only to requests carrying a Device token (current or, during a rotation, previous), behind the same wrong-token limit as Readings. The ESP8266 update library can only send Basic credentials, so the Device token is also accepted as `device:<token>` there. Publishing and the status view need the Admin token.
- **One release, staged.** The server holds one published build (`firmware_release`, in MySQL, so backups carry it). It can be offered to named Devices first, a bench board, and then to every Device by publishing the same file again. A lower version than the published one is refused, since boards only move up; the version is read from a marker in the image itself, so it cannot be mistyped. Each check records the version the board reported, for Settings' Firmware tab and `deploy.sh firmware-status`.
- **Publishing** is the Firmware tab in Settings (an upload with the Admin token), or `deploy.sh publish-firmware` on the server.

## Update (2026-10-07): faster, and the boards report on themselves

- **A nudge with each Reading.** Waiting up to an hour for the hourly check was too slow on the bench. When a build newer than the board's own is published for it, the server's 201 to its Reading carries `X-Firmware-Available: <version>`, and the board checks at once (at most once a minute, so a build it refuses cannot loop). A header, because the firmware never reads a 201's body (security-firmware.md, S2). The release is read from a 30-second cache, not the database, on each Reading. The hourly check stays as the fallback, and the first check after boot moves from 60 to 30 seconds.
- **What the board says about itself.** Each Reading also carries the firmware version, WiFi signal, uptime, free memory, the reason for the last restart, and the last update check's result, stored on the Device (migration 0009) and shown on the Firmware tab. All optional, so older firmware is unaffected; values out of range are dropped, never a reason to refuse a Reading.

## Consequences

- Flashing day is the last USB flash, provided those builds have the keys. A board flashed before this decision needs one more.
- A build that cannot join WiFi or reach the server cannot be undone over the air, and the ESP8266 does not roll back by itself. The staged release (one bench board, then all) is the safeguard; the README's procedure makes it the normal path.
- Losing `private.key` does not stop the boards, but the next update is USB for every board, with new keys. A leaked key is the same, plus a rotation of the Admin token if the server may also be in other hands.
- Backups now hold the published image, which holds the WiFi password and the Device token; they were already kept owner-only.
- The firmware grows by about 35 KB (the updater, the server module, and the roots); the 4 MB NodeMCU has room for two copies, which an update needs.
