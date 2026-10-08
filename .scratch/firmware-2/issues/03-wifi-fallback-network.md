# 03 — A second WiFi network to fall back to

**What to build:**
A board that cannot join its network tries a second configured one before going silent. Useful while closets move between networks (the test board was just moved to the open `CISD-MAC`), and for a closet whose primary SSID is down.

**Blocked by:** none

**Status:** needs-triage

**GitHub:** #18

- [ ] `config.h`: optional `WIFI_SSID_2` / `WIFI_PASSWORD_2` (empty password: open network, as for the first)
- [ ] `network.cpp`: try the first for N seconds, then the second, alternating; stay on whichever joined until it drops
- [ ] The self-report names which network the board is on; Settings shows it
- [ ] An OTA image carries both, so a board can be moved to a new network over the air by publishing an image whose second network is the new one, then a later image that makes it first
- [ ] Bench run: first network off, board joins the second and reports; first back, board stays until the second drops (`ready-for-human`)

## Open questions

- Should a board on its fallback network count as a warning on the Dashboard?

## Comments
