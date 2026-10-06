// Roots: the certificate authorities an https:// SERVER_URL is trusted through.
#pragma once

#include <stddef.h>

// ISRG Root X1, X2, YE, and YR, as PEM in flash (PROGMEM). Read them with the _P functions.
// All four, so the server's chain is accepted whichever of them it reaches first: today's
// default chains run up to X1 and X2, and Let's Encrypt is moving issuance to YE and YR.
extern const char* const LETS_ENCRYPT_ROOTS[];
extern const size_t LETS_ENCRYPT_ROOT_COUNT;
