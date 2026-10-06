---
status: accepted
---

# Devices send Readings over HTTP POST; browsers receive them over SSE; the backend runs as one process

The old firmware and the current dashboard disagreed about whether this is a logger or a live monitor, and "use websockets" was on the table for both links. We decided: the ESP8266 sends each Reading as an independent HTTP POST, because a persistent socket on a 40 KB-RAM chip across WiFi blips is the least stable option and gains nothing at one send per 30 seconds. Browsers get live updates over Server-Sent Events, not WebSockets, because the push is one-way and SSE reconnects for free. The backend must run as a single process: the previous PM2 cluster of two instances meant a Reading arriving at one process never reached browsers connected to the other, which was the actual source of "unstable" live updates. WebSockets would not have fixed that.

## Consequences

- `ecosystem.config.js` moves to `instances: 1`, fork mode.
- If horizontal scaling is ever needed, add a pub/sub layer (Redis) rather than switching transports.

## Note (2026-10, production security review)

The POST is plain HTTP unless a Device is flashed with an `https://` server URL, and then TLS runs without a certificate check (ADR 0003). Plain HTTP shows the Device token to anyone who can see the traffic, so plain-HTTP Devices belong on a VLAN or SSID of their own that reaches only the server. The HTTPS path is already in every build (BearSSL is linked whatever the URL), so choosing it costs heap at run time, not flash or IRAM. The firmware never follows a redirect, so the token goes only to the configured server; see the README's "Secrets on the board".
