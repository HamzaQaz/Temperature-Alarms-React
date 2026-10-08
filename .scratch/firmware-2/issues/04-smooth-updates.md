# 04 — Firmware updates that say what is happening

**What to build:**
Publishing a build should either reach the boards it names or say plainly why not, and the Firmware tab (and `deploy.sh firmware-status`) should show each board's way to the new version step by step. Found on the bench, 2026-10-07: firmware 7 was uploaded on Settings, the test board (ESP_64533B, on firmware 4) checked 30 s after a reset and was told "none newer", and nothing anywhere said the release did not include it. Its serial log prints the network hostname `ESP-64533B` (hyphen) while the Device is `ESP_64533B` (underscore), an easy name to get wrong in "Only these Devices".

**Blocked by:** none

**Status:** ready-for-agent

**GitHub:** #30

- [ ] Publishing with `only` checks each name: `ESP-64533B`, `esp_64533b`, and `64533B` are read as `ESP_64533B`; a name that matches no registered Device is refused (422) naming it, before anything is stored, in the API, the Firmware tab, and `deploy.sh publish-firmware --only`
- [ ] The publish answer, and the Firmware tab after it, say who it is offered to: "Offered to ESP_64533B (CHS IDF 2, running 4)", or "Offered to every Device (12)"; publishing that would reach no Device is refused
- [ ] Per offered Device, one line with where it is: waiting for its next check → downloading (the server sent the image) → running the new version → N of 10 clean Readings; or stuck: never checked in, refused the image (its update result), Offline
- [ ] Each waiting line says when to expect the next step: a board that sends Readings checks at its next one, nudged by `X-Firmware-Available` (firmware 4 already does: on the bench it logged `update: version 7 is waiting, checking now` within one Report interval); one that is silent checks hourly and 30 s after a restart, so "next check by 23:55, or restart the board"
- [ ] The board's serial log says what the server answered (on the bench the ~60 s download and signature check printed nothing between `checking now` and the restart): `update: v7 offered, downloading`, `update: installed, restarting`, `update: refused, <reason>`, and for a 304 `update: none newer for ESP_64533B (running 4)`, so a bench log names the Device the server knows it as
- [ ] `deploy.sh firmware-status` (and `deploy.ps1`) prints the same per-Device lines
- [ ] Tests: name forms accepted and an unknown name refused; the per-Device states at the HTTP seam (never checked, sent, running, counting, failed); the expected-next-check text for old and new firmware

## Comments

**2026-10-07 — bench result.** After republishing with `only=ESP_64533B`, the board went from 4 to 7 over the air in about 70 s: the nudge with its next Reading, a silent ~60 s download and check, then a restart on 7. So the delay was entirely the release not naming it.
