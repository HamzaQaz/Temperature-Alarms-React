---
status: accepted
---

# Devices send Readings over HTTP POST; browsers receive them over SSE; the backend runs as one process

The old firmware and the current dashboard disagreed about whether this is a logger or a live monitor, and "use websockets" was on the table for both links. We decided: the ESP8266 sends each Reading as an independent HTTP POST, because a persistent socket on a 40 KB-RAM chip across WiFi blips is the least stable option and gains nothing at one send per 30 seconds. Browsers get live updates over Server-Sent Events, not WebSockets, because the push is one-way and SSE reconnects for free. The backend must run as a single process: the previous PM2 cluster of two instances meant a Reading arriving at one process never reached browsers connected to the other, which was the actual source of "unstable" live updates. WebSockets would not have fixed that.

## Consequences

- `ecosystem.config.js` moves to `instances: 1`, fork mode.
- If horizontal scaling is ever needed, add a pub/sub layer (Redis) rather than switching transports.

## Note (2026-10, production security review)

The POST is plain HTTP unless a Device is flashed with an `https://` server URL, and then TLS runs without a certificate check (ADR 0003; superseded by the update below). Plain HTTP shows the Device token to anyone who can see the traffic, so plain-HTTP Devices belong on a VLAN or SSID of their own that reaches only the server. The HTTPS path is already in every build (BearSSL is linked whatever the URL), so choosing it costs heap at run time, not flash or IRAM. The firmware never follows a redirect, so the token goes only to the configured server; see the README's "Secrets on the board".

## Update 2026-10-06: production transport is HTTPS, checked against Let's Encrypt's roots

The owner chose, before the production install and flashing day, among (a) plain HTTP on an isolated device network, (b) HTTPS without a certificate check, and (c) HTTPS with a pinned public key (`.scratch/prodtest/security-firmware.md`, D1). Having leaned first to (a), then to (c), the owner chose HTTPS with the certificate **checked against Let's Encrypt's roots**, because the dashboard is served at the same name, `YOUR_DOMAIN`, over HTTPS anyway, and a pinned key would turn any accidental key change on the server into a reflash of every board:

- Production boards post to `https://YOUR_DOMAIN`. The firmware carries ISRG Root X1, X2, YE, and YR (`roots.cpp`, from letsencrypt.org) and checks the server's chain and hostname with BearSSL's X.509 validator, as a browser would. Today's default chains reach X1 and X2; Let's Encrypt is moving issuance to the YE and YR roots, which are in the list so that move needs no reflash. BearSSL does not check a trust anchor's own expiry.
- The token is encrypted on the wire and goes only to a server with a valid certificate for the name. A spoofed DNS answer, an ARP spoof, a rogue access point, or a name resolving somewhere unexpected all fail the handshake before the request, and the board records nothing. The firmware still never follows a redirect.
- Nothing about this server is in the boards: renewals, a new key, a different key type, or a rebuilt server need no reflash. A change of hostname, or new roots, ships as an over-the-air update (ADR 0007).
- Certificate dates need the time, and the ESP8266 has no clock: the board reads it from the server's own `Date` header (a GET of `/api/health` over TLS it does not check yet, with no token), refreshed twice a day, and sends nothing until it has it. So the device network needs no time server. A false time could only let an expired certificate for the name pass, and that still needs its private key.
- It fails closed: no roots loaded or no time means no request, said on serial.
- Cost, measured at compile time with core 3.1.2: about 10 KB more flash than the plain build (the roots stay in flash and are decoded once at boot), static RAM about the same, IRAM unchanged (92%). At run time a TLS session needs roughly 20 to 25 KB of heap, plus a few KB for the decoded roots, not yet measured on a board: the bench check of one board before the batch proves it.
- **What is accepted:** whoever can obtain a Let's Encrypt certificate for `YOUR_DOMAIN`, that is whoever controls its DNS, could stand in for the server, as for any browser.
- The boards still get an SSID and VLAN of their own with client isolation, reaching only the server on TCP 443 and the resolver: it keeps the WiFi password from opening anything else, though the token no longer depends on it.
- The plain-HTTP Readings route that DEPLOYMENT.md's TLS proxy keeps is only for boards flashed with `http://`; production boards do not use port 80.

README ("Transport for production boards") and DEPLOYMENT.md (Security, and TLS step 6) give the checks.
