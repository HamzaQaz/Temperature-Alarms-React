#include "sensor.h"

#include <Arduino.h>
#include <DHT.h>

#include "config.h"

// Data pin, from config.h. GPIO 5 (D1) for a sensor wired per dht11-pinout.svg; boards with the
// DHT11 soldered on carry it on GPIO 4 (D2), which config.h sets.
#ifndef DHT_PIN
#define DHT_PIN 5
#endif

static DHT dht(DHT_PIN, DHT11);

void sensorBegin() {
  dht.begin();
}

// The DHT11 cannot be read again sooner than this.
static const unsigned long RETRY_AFTER_MS = 2 * 1000UL;

bool sensorRead(Sample& out) {
  float tempF = dht.readTemperature(true);  // true: Fahrenheit
  float humidity = dht.readHumidity();
  if (isnan(tempF) || isnan(humidity)) {
    Serial.println(F("sensor: read failed (NaN), trying once more"));
    delay(RETRY_AFTER_MS);
    tempF = dht.readTemperature(true, true);  // force: the library would hand back its cached NaN
    humidity = dht.readHumidity();
  }
  if (isnan(tempF) || isnan(humidity)) {
    Serial.println(F("sensor: read failed (NaN), sample skipped"));
    return false;
  }
  out.tempF = tempF;
  out.humidity = humidity;
  Serial.print(F("sensor: "));
  Serial.print(tempF, 1);
  Serial.print(F(" F, "));
  Serial.print(humidity, 0);
  Serial.println(F(" %"));
  return true;
}
