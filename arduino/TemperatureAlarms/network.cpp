#include "network.h"

#include <Arduino.h>
#include <ESP8266WiFi.h>

#include "config.h"

// The second network is optional: a config.h from before firmware 7 names none, and an empty
// WIFI_SSID_2 is none too.
#ifndef WIFI_SSID_2
#define WIFI_SSID_2 ""
#endif
#ifndef WIFI_PASSWORD_2
#define WIFI_PASSWORD_2 ""
#endif

// How long setup() waits for the first connection before handing over to the loop.
static const unsigned long BOOT_CONNECT_WAIT_MS = 20 * 1000UL;
// How long one network gets to join before the other is tried, or, with one network, before a
// connect is re-issued. The core's own auto reconnect covers most drops; this covers the stalls it
// misses, and a network that is gone, without racing it.
static const unsigned long TRY_NETWORK_MS = 30 * 1000UL;

struct Network {
  const char* ssid;
  const char* password;  // empty: an open network (a MAC allowlist, say), joined with no passphrase
};

static const Network NETWORKS[] = {{WIFI_SSID, WIFI_PASSWORD}, {WIFI_SSID_2, WIFI_PASSWORD_2}};
// sizeof a string literal counts its NUL, so an empty WIFI_SSID_2 is 1: no second network.
static const uint8_t NETWORK_COUNT = sizeof(WIFI_SSID_2) > 1 ? 2 : 1;

static char hostname[11] = "";  // "ESP_" + six hex digits + NUL
static uint8_t current = 0;     // the index in NETWORKS of the network joined, or being tried
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

const char* networkSsid() {
  return NETWORKS[current].ssid;
}

uint8_t networkNumber() {
  return current + 1;
}

// The network's SSID, and "(fallback network)" after the second, as every wifi line names it.
static void printNetwork() {
  Serial.print(NETWORKS[current].ssid);
  if (current == 1) Serial.print(F(" (fallback network)"));
}

static void logConnected(const __FlashStringHelper* how) {
  Serial.print(F("wifi: "));
  Serial.print(how);
  Serial.print(F(" to "));
  printNetwork();
  Serial.print(F(", IP "));
  Serial.print(WiFi.localIP());
  Serial.print(F(", hostname "));
  Serial.println(WiFi.hostname());
}

static void startConnecting(uint8_t index) {
  current = index;
  lastReconnectAt = millis();
  const Network& network = NETWORKS[index];
  if (network.password[0] == '\0') {
    WiFi.begin(network.ssid);  // open network: no passphrase at all
  } else {
    WiFi.begin(network.ssid, network.password);
  }
}

void networkBegin() {
  WiFi.persistent(false);   // do not wear the flash by saving credentials on every begin()
  WiFi.mode(WIFI_STA);      // never an access point, never a web server
  WiFi.setAutoReconnect(true);
  Serial.print(F("wifi: connecting to "));
  printNetwork();
  Serial.println();
  startConnecting(0);

  unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startedAt < BOOT_CONNECT_WAIT_MS) {
    delay(500);
    Serial.print('.');
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    wasConnected = true;
    logConnected(F("connected"));
  } else if (NETWORK_COUNT > 1) {
    Serial.println(F("wifi: not connected yet, will keep trying both networks in turn"));
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
    // The core's auto reconnect starts on its own at the drop, to the same network; give it a full
    // interval before re-issuing a connect or moving to the other network, rather than at once.
    lastReconnectAt = millis();
    Serial.println(F("wifi: connection lost, reconnecting"));
  }
  if (millis() - lastReconnectAt >= TRY_NETWORK_MS) {
    // The other network when there are two, so neither is given up on; the same one when there is one.
    uint8_t next = (current + 1) % NETWORK_COUNT;
    bool moving = next != current;
    startConnecting(next);
    if (moving) {
      Serial.print(F("wifi: not joined, trying "));
      printNetwork();
      Serial.println();
    }
  }
  return false;
}
