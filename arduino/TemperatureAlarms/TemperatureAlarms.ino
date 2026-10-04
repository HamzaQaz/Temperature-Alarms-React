// Temperature Alarms Device firmware: a NodeMCU (ESP8266) with a DHT11 on GPIO 5
// posts one Reading per Report interval to the backend with the Device token.
//
// Copy config.example.h to config.h before compiling. Each module has one job:
//   network.*  connect to WiFi, reconnect in the loop, know the Device hostname
//   sensor.*   read the DHT11 and skip bad samples
//   reporter.* build the JSON Reading and POST it, logging the HTTP status

#include "config.h"
#include "network.h"
#include "reporter.h"
#include "sensor.h"

static_assert(REPORT_INTERVAL_SECONDS >= 2, "The DHT11 cannot be read more often than every 2 seconds");

static const unsigned long REPORT_INTERVAL_MS = REPORT_INTERVAL_SECONDS * 1000UL;

// millis() of the last report attempt; until the first one, a Reading is due as soon as WiFi is up.
static bool attemptedOnce = false;
static unsigned long lastAttemptAt = 0;

static bool reportDue() {
  // Unsigned elapsed time is right at any age, across millis() wrapping after 49 days and after
  // an outage of any length. A deadline compared by signed difference stalls once 24.8 days pass.
  return !attemptedOnce || millis() - lastAttemptAt >= REPORT_INTERVAL_MS;
}

void setup() {
  Serial.begin(115200);
  Serial.println();
  Serial.println(F("Temperature Alarms Device"));
  sensorBegin();
  networkBegin();
  reporterBegin();
}

void loop() {
  if (!networkEnsureConnected()) {
    delay(100);
    return;
  }
  if (!reportDue()) return;
  // One attempt per interval. A failed read or POST waits for the next interval; nothing retries.
  attemptedOnce = true;
  lastAttemptAt = millis();

  Sample sample;
  if (!sensorRead(sample)) return;
  reportReading(deviceHostname(), sample);
}
