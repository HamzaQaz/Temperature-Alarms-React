// Server: where SERVER_URL points, and a TLS client that trusts only a real certificate for it.
// Shared by the reporter (Readings) and the updater (firmware), so both send the Device token
// only to the same, checked server.
#pragma once

#include <Arduino.h>
#include <WiFiClientSecure.h>

// Reads SERVER_URL once; over https:// also loads Let's Encrypt's roots (roots.cpp).
void serverBegin();

// SERVER_URL without a trailing slash, followed by `path` (which starts with '/').
String serverUrl(const char* path);

// True when SERVER_URL is https://.
bool serverUsesTls();

// Sets `client` to accept only a certificate that chains to a Let's Encrypt root and names
// SERVER_URL's host, at the current time. Returns nullptr when ready, otherwise why not (no roots,
// or no time from the server yet), in which case nothing may be sent.
const __FlashStringHelper* serverSecure(BearSSL::WiFiClientSecure& client);
