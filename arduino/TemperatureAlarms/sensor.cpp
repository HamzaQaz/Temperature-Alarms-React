#include "sensor.h"

#include <Arduino.h>
#include <DHT.h>

// Data pin: GPIO 5, labelled D1 on the NodeMCU. See dht11-pinout.svg.
static const uint8_t DHT_PIN = 5;

static DHT dht(DHT_PIN, DHT11);

void sensorBegin() {
  dht.begin();
}

bool sensorRead(Sample& out) {
  float tempF = dht.readTemperature(true);  // true: Fahrenheit
  float humidity = dht.readHumidity();
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
