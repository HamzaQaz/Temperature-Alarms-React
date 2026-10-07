// Updater: over-the-air firmware (docs/adr/0007). Once an hour the board asks the server for a
// build newer than its own and, if there is one, installs it and restarts. Only a build signed with
// the district's key (public.key in the sketch folder at build time) is ever installed.
#pragma once

#include <Arduino.h>

// Logs the firmware version and whether over-the-air updates are on in this build.
void updaterBegin();

// Checks for a newer build when one is due (30 seconds after boot, then every hour, or at once when
// the server has said one is waiting). Call from the loop while WiFi is up. Restarts the board when
// it installs one.
void updaterLoop();

// The server's answer to a Reading said a build newer than `version` is waiting: check at the next
// loop instead of at the hourly check (at most once a minute, so a refused build cannot loop).
void updaterOffered(long version);

// How the last check went, for the next Reading: "none newer", "failed, ...", or "" before the first.
const String& updaterLastResult();
