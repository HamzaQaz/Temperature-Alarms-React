// Updater: over-the-air firmware (docs/adr/0007). Once an hour the board asks the server for a
// build newer than its own and, if there is one, installs it and restarts. Only a build signed with
// the district's key (public.key in the sketch folder at build time) is ever installed.
#pragma once

// Logs the firmware version and whether over-the-air updates are on in this build.
void updaterBegin();

// Checks for a newer build when one is due (a minute after boot, then every hour). Call from the
// loop while WiFi is up. Restarts the board when it installs one.
void updaterLoop();
