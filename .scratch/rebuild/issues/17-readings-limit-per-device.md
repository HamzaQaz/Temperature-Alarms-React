# 17 — Reading limit is per address, so a campus behind one NAT loses Readings

**What to build:**
Every Device on a campus can reach the backend through one public address, and the write limit on `POST /api/readings` must not make them share one allowance. Found on 2026-09-09 with the virtual Device (`backend/scripts/mock-device.mjs`) while bug-hunting after the first bench test.

**Blocked by:** 06 — Reading ingest with the Device token

**Status:** done

- [x] The Reading limit is keyed by hostname, so twenty Readings a minute is per Device, not per address
- [x] Readings are not counted against the general per-address limit on `/api/`, which sixteen boards at one Reading per 30 seconds would exhaust
- [x] Requests without the Device token are refused before they reach the Device limit
- [x] The readings test covers a second Device at the same address getting through after the first is limited

## Comments

**2026-09-09 — measured and fixed.**

- **Loop.** Twelve virtual Devices posting every 2 s from one address for 60 s against the 2-second-interval backend: 20 accepted, 340 refused with 429. At the real 30-second interval the same limiter caps a shared address at ten Devices, and the general limiter (500 per 15 minutes per address) at sixteen.
- **Fix.** The write limiter's key is the posted hostname (normalised as the route does), falling back to the address when the body has none; the token check now runs before it, so only requests carrying the Device token are counted. The general `/api/` limiter skips `POST /readings`, which has its own limit. `trust proxy` stays as it was; with the address no longer keying Readings, a spoofed `X-Forwarded-For` gains nothing there.
- **Confirmed live.** The same twelve virtual Devices at one Reading each per 4 s (under the per-Device allowance) against the fixed backend: 180 of 180 accepted. A first rerun showed all 429 because a stale backend process still held the port; it was measuring the old code, and the fix commit had already gone in on the strength of the tests. Killed, restarted, remeasured.
- **Test.** `backend/test/readings.test.ts`: twenty Readings from one Device, the twenty-first is 429 with a message naming the Device, a second Device from the same address is 201, a wrong token is 401, and the rest of the API is unaffected.
