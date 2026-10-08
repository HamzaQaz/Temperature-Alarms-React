#include "sensor.h"

#include <Arduino.h>

#include "config.h"

// Which sensor, from config.h. A config.h from before firmware 6 names none: the DHT11 was the only one.
#ifndef SENSOR_TYPE
#define SENSOR_TYPE DHT11
#endif

// SENSOR_TYPE is a bare word (DHT11, DHT22, SHT31); pasted onto SENSOR_ID_ it becomes a number the
// preprocessor can compare, so a build compiles only its own sensor's code and library. An unknown
// word pastes into a name nothing defines, which compares as 0 and stops the build below.
#define SENSOR_ID_DHT11 11
#define SENSOR_ID_DHT22 22
#define SENSOR_ID_SHT31 31
#define SENSOR_ID_(type) SENSOR_ID_##type
#define SENSOR_ID(type) SENSOR_ID_(type)
#define SENSOR_NAME_(type) #type
#define SENSOR_NAME(type) SENSOR_NAME_(type)

#if SENSOR_ID(SENSOR_TYPE) == 11 || SENSOR_ID(SENSOR_TYPE) == 22
#define SENSOR_IS_DHT 1
#elif SENSOR_ID(SENSOR_TYPE) == 31
#define SENSOR_IS_DHT 0
#else
#error "SENSOR_TYPE in config.h must be DHT11, DHT22 or SHT31"
#endif

const char* sensorType() {
  return SENSOR_NAME(SENSOR_TYPE);
}

// The DHT sensors cannot be read again sooner than this; the SHT31 waits the same, so a failed read
// is retried the same way whatever the sensor.
static const unsigned long RETRY_AFTER_MS = 2 * 1000UL;

#if SENSOR_IS_DHT

#include <DHT.h>

// Data pin, from config.h. GPIO 5 (D1) for a sensor wired per dht11-pinout.svg; boards with the
// DHT11 soldered on carry it on GPIO 4 (D2), which config.h sets.
#ifndef DHT_PIN
#define DHT_PIN 5
#endif

// The DHT library takes the same names as config.h: DHT11 or DHT22.
static DHT dht(DHT_PIN, SENSOR_TYPE);

void sensorBegin() {
  dht.begin();
  Serial.print(F("sensor: " SENSOR_NAME(SENSOR_TYPE) " on GPIO "));
  Serial.println(DHT_PIN);
}

// One read of both values; `again` forces it, since after a failure the library would hand back its cached NaN.
static bool readOnce(float& tempF, float& humidity, bool again) {
  tempF = dht.readTemperature(true, again);  // true: Fahrenheit
  humidity = dht.readHumidity();
  return !isnan(tempF) && !isnan(humidity);
}

#else  // SHT31

#include <Adafruit_SHT31.h>
#include <Wire.h>

// I2C pins and address, from config.h. GPIO 4 (D2) and 5 (D1) are the NodeMCU's usual SDA and SCL;
// the address is 0x44, or 0x45 on a breakout whose ADDR pin is tied high.
#ifndef SHT31_SDA_PIN
#define SHT31_SDA_PIN 4
#endif
#ifndef SHT31_SCL_PIN
#define SHT31_SCL_PIN 5
#endif
#ifndef SHT31_ADDRESS
#define SHT31_ADDRESS 0x44
#endif

static Adafruit_SHT31 sht31;

void sensorBegin() {
  // The library starts the bus on the core's default pins, which this call sets first.
  Wire.begin(SHT31_SDA_PIN, SHT31_SCL_PIN);
  // A sensor that does not answer now is still read every interval: it may be plugged in later.
  bool found = sht31.begin(SHT31_ADDRESS);
  Serial.print(found ? F("sensor: SHT31 at 0x") : F("sensor: SHT31 not answering at 0x"));
  Serial.print(SHT31_ADDRESS, HEX);
  Serial.print(F(", SDA GPIO "));
  Serial.print(SHT31_SDA_PIN);
  Serial.print(F(", SCL GPIO "));
  Serial.println(SHT31_SCL_PIN);
}

// One measurement of both values. The library gives NaN when the sensor does not answer on the bus or
// its answer fails the checksum; every SHT31 read is a fresh one, so `again` changes nothing.
static bool readOnce(float& tempF, float& humidity, bool /* again */) {
  float tempC;
  if (!sht31.readBoth(&tempC, &humidity)) return false;
  tempF = tempC * 9.0f / 5.0f + 32.0f;
  return !isnan(tempF) && !isnan(humidity);
}

#endif

bool sensorRead(Sample& out) {
  float tempF;
  float humidity;
  if (!readOnce(tempF, humidity, false)) {
    Serial.println(F("sensor: read failed (NaN), trying once more"));
    delay(RETRY_AFTER_MS);
    if (!readOnce(tempF, humidity, true)) {
      Serial.println(F("sensor: read failed (NaN), sample skipped"));
      return false;
    }
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
