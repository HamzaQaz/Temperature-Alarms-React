# 09 — Live updates over SSE

**What to build:**
A Reading posted by a Device appears on every open dashboard within seconds, with its Conditions, without a refresh. A dashboard left open on a wall screen survives network blips and proxy idle timeouts. Per ADR 0001.

**Blocked by:** 08 — Conditions

**Status:** ready-for-agent

- [ ] `GET /api/dashboard/stream` is an SSE endpoint using the shared CORS middleware, with no ad hoc wildcard header
- [ ] A heartbeat comment is sent every 25 seconds
- [ ] Each ingested Reading is broadcast as `{type: "reading", device, reading, online, conditions}` from one in-process client set
- [ ] The dashboard subscribes, updates the matching card in place including badges and border, and resets that card's countdown
- [ ] Connection loss relies on the browser's built-in EventSource reconnect, and the page reloads its data after a reconnect so nothing is missed
- [ ] An HTTP test subscribes a client, posts a Reading, and asserts the client receives the broadcast
