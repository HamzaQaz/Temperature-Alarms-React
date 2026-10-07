// Copy this file to config.h in the same folder and fill in every value.
// config.h is gitignored, so the secrets never reach the repo.
#pragma once

// The WiFi network the Device joins. Leave the password empty ("") for an open
// network, such as one that admits Devices by MAC allowlist.
#define WIFI_SSID "your-network"
#define WIFI_PASSWORD "your-password"

// Where the backend is served, without a trailing slash. Readings are posted to
// SERVER_URL/api/readings, and the board checks /api/firmware for updates. Production boards:
// https://YOUR_DOMAIN, the name the dashboard is served at. Its certificate must chain to a Let's
// Encrypt root (roots.cpp) and name that host, so renewals and key changes on the server never
// need a reflash; the board takes the time from the server itself. Run the README's "Transport
// for production boards" checks before flashing. On a desk, the Compose stack is http://<host>
// (add :PORT only if WEB_PORT was changed).
#define SERVER_URL "https://YOUR_DOMAIN"

// Must match DEVICE_TOKEN in the backend .env (docs/adr/0003).
#define DEVICE_TOKEN "change-me-device"

// GPIO the DHT11 DATA pin is on. 5 is D1, where dht11-pinout.svg wires a separate sensor.
// A NodeMCU with the DHT11 soldered on (the "ESP8266 + DHT11" boards) has it on GPIO 4, D2.
#define DHT_PIN 5

// How often a Reading is sent. Must match REPORT_INTERVAL_SECONDS in the backend
// .env, which is 30 unless changed there. The DHT11 cannot sample faster than every 2 s.
#define REPORT_INTERVAL_SECONDS 30
