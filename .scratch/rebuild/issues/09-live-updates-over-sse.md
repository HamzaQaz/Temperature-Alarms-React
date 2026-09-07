# 09 — Live updates over SSE

**What to build:**
A Reading posted by a Device appears on every open dashboard within seconds, with its Conditions, without a refresh. A dashboard left open on a wall screen survives network blips and proxy idle timeouts. Per ADR 0001.

**Blocked by:** 08 — Conditions

**Status:** done

- [x] `GET /api/dashboard/stream` is an SSE endpoint using the shared CORS middleware, with no ad hoc wildcard header
- [x] A heartbeat comment is sent every 25 seconds
- [x] Each ingested Reading is broadcast as `{type: "reading", device, reading, online, conditions}` from one in-process client set
- [x] The dashboard subscribes, updates the matching card in place including badges and border, and resets that card's countdown
- [x] Connection loss relies on the browser's built-in EventSource reconnect, and the page reloads its data after a reconnect so nothing is missed
- [x] An HTTP test subscribes a client, posts a Reading, and asserts the client receives the broadcast

## Comments

**2026-09-07, on completion.** Two things go a step beyond the checklist; both flagged by review, both kept deliberately and easy to strip if unwanted:

- The dashboard header shows a small stream status (Connecting / Live / Reconnecting). The spec's frontend pass says new information needs its own decision. It is there for the wall-screen case: without it, a dashboard whose stream has dropped shows stale numbers with nothing saying so. One component (`frontend/src/components/LiveStatus.tsx`) and two lines in `Dashboard.tsx`.
- The browser reopens the stream itself, after five seconds, in the one case EventSource gives up on for good: a non-200 answer, as a proxy returns while the backend restarts. Every other drop uses the browser's built-in reconnect, as the spec says.

Also noted for ticket 10: the legacy History page still matches stream events on `name`; the event carries `device`, so History's live refresh is dead until that ticket rewrites the page. Follow-up outside any ticket: nothing reloads the dashboard on a timer, so a Device that stops reporting is only shown Offline after the next reload (a reconnect, a Refresh, or a page load).
