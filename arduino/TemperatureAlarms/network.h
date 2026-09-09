// WiFi: connect at boot, reconnect from the loop without a reboot, and name the Device.
#pragma once

// Puts the NodeMCU in station mode and starts connecting. Waits a little for the first
// connection so the serial log shows the address, but never blocks forever.
void networkBegin();

// True when WiFi is up. When it is down, starts a reconnect (at most once every
// few seconds) and returns false so the caller skips this loop.
bool networkEnsureConnected();

// The hostname the backend knows this Device by: `ESP_` plus the last six hex
// digits of its MAC, the same digits as the NodeMCU's `ESP-xxxxxx` DHCP name.
const char* deviceHostname();
