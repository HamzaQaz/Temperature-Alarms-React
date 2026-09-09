// Copy this file to config.h in the same folder and fill in every value.
// config.h is gitignored, so the secrets never reach the repo.
#pragma once

// The WiFi network the Device joins.
#define WIFI_SSID "your-network"
#define WIFI_PASSWORD "your-password"

// Where the backend is served, without a trailing slash. Readings are posted to
// SERVER_URL/api/readings. An https:// URL is sent over TLS (see the firmware README).
#define SERVER_URL "https://YOUR_DOMAIN"

// Must match DEVICE_TOKEN in the backend .env (docs/adr/0003).
#define DEVICE_TOKEN "change-me-device"

// GPIO the DHT11 DATA pin is on. 5 is D1, where dht11-pinout.svg wires a separate sensor.
// A NodeMCU with the DHT11 soldered on (the "ESP8266 + DHT11" boards) has it on GPIO 4, D2.
#define DHT_PIN 5

// How often a Reading is sent. Must match REPORT_INTERVAL_SECONDS in the backend
// .env, which is 30 unless changed there. The DHT11 cannot sample faster than every 2 s.
#define REPORT_INTERVAL_SECONDS 30
