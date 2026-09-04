---
status: accepted
---

# Devices send Readings over HTTP POST; browsers receive them over SSE; the backend runs as one process

The old firmware and the current dashboard disagreed about whether this is a logger or a live monitor, and "use websockets" was on the table for both links. We decided: the ESP8266 sends each Reading as an independent HTTP POST, because a persistent socket on a 40 KB-RAM chip across WiFi blips is the least stable option and gains nothing at one send per 30 seconds. Browsers get live updates over Server-Sent Events, not WebSockets, because the push is one-way and SSE reconnects for free. The backend must run as a single process: the previous PM2 cluster of two instances meant a Reading arriving at one process never reached browsers connected to the other, which was the actual source of "unstable" live updates. WebSockets would not have fixed that.

## Consequences

- `ecosystem.config.js` moves to `instances: 1`, fork mode.
- If horizontal scaling is ever needed, add a pub/sub layer (Redis) rather than switching transports.
