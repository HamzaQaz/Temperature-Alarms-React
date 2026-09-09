// Reporter: turn a Sample into the JSON Reading the backend expects and POST it once.
#pragma once

#include "sensor.h"

// Resolves the readings URL from config.h once and logs where Readings will go.
void reporterBegin();

// POSTs {device, temp, humidity} to SERVER_URL/api/readings with the Device token as a
// bearer header and logs the HTTP status. Never retries: a failure is the next
// interval's problem.
void reportReading(const char* hostname, const Sample& sample);
