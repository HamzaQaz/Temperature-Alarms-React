// WiFi: connect at boot, fall back to a second network (config.h, WIFI_SSID_2) when the first cannot
// be joined, reconnect from the loop without a reboot, and name the Device.
#pragma once

#include <stdint.h>

// Puts the NodeMCU in station mode and starts joining the first network. Waits a little for the
// first connection so the serial log shows the address, but never blocks forever.
void networkBegin();

// True when WiFi is up. When it is down, gives the network it is trying 30 seconds to join (after a
// drop, the core's own auto reconnect has those 30 seconds first), then tries the other one: the
// two in turn until one joins, or the one network again when config.h names a single network. The
// board stays on whichever joined until it drops. Returns false so the caller skips this loop.
bool networkEnsureConnected();

// The network the board is on (or trying): its SSID, and which of config.h's it is, 1 for WIFI_SSID
// or 2 for WIFI_SSID_2, the fallback network. For the self-report.
const char* networkSsid();
uint8_t networkNumber();

// The hostname the backend knows this Device by: `ESP_` plus the last six hex
// digits of its MAC, the same digits as the NodeMCU's `ESP-xxxxxx` DHCP name.
const char* deviceHostname();
