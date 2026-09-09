#include "network.h"

#include <Arduino.h>
#include <ESP8266WiFi.h>

#include "config.h"

// How long setup() waits for the first connection before handing over to the loop.
static const unsigned long BOOT_CONNECT_WAIT_MS = 20 * 1000UL;
// How often the loop re-issues a connect while the link is down. The core's own auto
// reconnect covers most drops; this covers the stalls it misses, without racing it.
static const unsigned long RECONNECT_EVERY_MS = 30 * 1000UL;

static char hostname[11] = "";  // "ESP_" + six hex digits + NUL
static bool wasConnected = false;
static unsigned long lastReconnectAt = 0;

const char* deviceHostname() {
  if (hostname[0] == '\0') {
    // The chip id is the low 24 bits of the station MAC, which is also what the core
    // uses for its default hostname.
    snprintf(hostname, sizeof(hostname), "ESP_%06X", ESP.getChipId());
  }
  return hostname;
}

static void logConnected(const __FlashStringHelper* how) {
  Serial.print(F("wifi: "));
  Serial.print(how);
  Serial.print(F(", IP "));
  Serial.print(WiFi.localIP());
  Serial.print(F(", hostname "));
  Serial.println(WiFi.hostname());
}

static void startConnecting() {
  lastReconnectAt = millis();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void networkBegin() {
  WiFi.persistent(false);   // do not wear the flash by saving credentials on every begin()
  WiFi.mode(WIFI_STA);      // never an access point, never a web server
  WiFi.setAutoReconnect(true);
  Serial.print(F("wifi: connecting to "));
  Serial.println(WIFI_SSID);
  startConnecting();

  unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startedAt < BOOT_CONNECT_WAIT_MS) {
    delay(500);
    Serial.print('.');
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    wasConnected = true;
    logConnected(F("connected"));
  } else {
    Serial.println(F("wifi: not connected yet, will keep trying"));
  }
  Serial.print(F("device: "));
  Serial.print(deviceHostname());
  Serial.println(F(" (register this hostname in Settings)"));
}

bool networkEnsureConnected() {
  if (WiFi.status() == WL_CONNECTED) {
    if (!wasConnected) {
      wasConnected = true;
      logConnected(F("reconnected"));
    }
    return true;
  }
  if (wasConnected) {
    wasConnected = false;
    Serial.println(F("wifi: connection lost, reconnecting"));
  }
  if (millis() - lastReconnectAt >= RECONNECT_EVERY_MS) startConnecting();
  return false;
}
