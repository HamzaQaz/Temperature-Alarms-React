// Reporter: turn a Sample into the JSON Reading the backend expects and POST it once.
#pragma once

#include "sensor.h"

// Resolves the readings URL from config.h once and logs where Readings will go.
void reporterBegin();

// POSTs {device, temp, humidity} to SERVER_URL/api/readings with the Device token as a
// bearer header and logs the HTTP status. Never retries: a failure is the next
// interval's problem.
void reportReading(const char* hostname, const Sample& sample);

// POSTs a fault report, {device, fault: "sensor"} and no values, when the sensor did not answer,
// so the server knows the board is alive and its sensor is not (docs/adr/0009). 202 is success.
void reportFault(const char* hostname);
