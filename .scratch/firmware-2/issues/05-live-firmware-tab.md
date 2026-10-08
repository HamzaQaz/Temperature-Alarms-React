# 05 — The Firmware tab updates live

**What to build:**
The Firmware tab on Settings shows a rollout as it happens, without a page refresh: a board checking in, downloading, restarting on the new version, its clean Readings counting up to 10, a hold, Release to all becoming available. Asked for by the owner on the bench, 2026-10-08, watching ESP_64533B update while refreshing by hand.

The dashboard already has a live stream (`GET /api/dashboard/stream`, `sse.ts`). Firmware status is Admin-only (it names WiFi networks), and the stream is not, so the stream carries only a signal that firmware status changed, never the status itself; the open tab then re-reads `GET /api/firmware/status` with the Admin token.

**Blocked by:** none

**Status:** ready-for-agent

**GitHub:** #34

- [ ] The stream gains a `firmware` event with no Device data in it (at most the release version), sent when firmware status can have changed: a release published, widened, withdrawn, or held; a firmware check answered (304 or image sent); a Reading whose self-report changes a Device's version or update result; a clean-Readings count moving for a Device in a staged release
- [ ] Coalesced on the server, at most one `firmware` event per second, so a fleet's Readings never flood the stream
- [ ] The Firmware tab, while open and the page visible, re-reads status on each `firmware` event (one request in flight at a time; one more queued if events arrive meanwhile), and also every 30 s as a fallback, with no flicker and no lost form input
- [ ] A small "Live" indicator on the tab, per DESIGN.md: live while the stream is connected; when it drops, "Reconnecting…" and the 30 s fallback continues; the time of the last update stays visible
- [ ] Waiting lines' times ("next check by 23:55") and "N of 10 clean Readings" stay current without user action
- [ ] Tests: the events at the HTTP seam (each trigger above sends one; a burst sends one; the event carries no hostname, SSID, or token); the tab's refetch logic (event → one refetch, burst → at most two, hidden page → none, fallback timer)

## Comments
