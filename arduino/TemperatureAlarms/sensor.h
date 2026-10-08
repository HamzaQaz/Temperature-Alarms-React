// The board's sensor, chosen in config.h (SENSOR_TYPE): a DHT11 or DHT22 on a data pin, or an SHT31 on
// I2C. Read a sample and reject the ones the sensor could not deliver; the rest of the sketch never
// knows which sensor it is.
#pragma once

struct Sample {
  float tempF;
  float humidity;  // percent
};

// Starts the sensor (the DHT library on its data pin, or the I2C bus and the SHT31) and logs which
// one, on which pins. Call once from setup().
void sensorBegin();

// The sensor config.h names, "DHT11", "DHT22" or "SHT31", for the self-report.
const char* sensorType();

// Fills `out` and returns true, or logs why the sample was skipped and returns false.
// A failed read (unplugged sensor, bad wire, read too soon, a garbled I2C answer) comes back as NaN;
// it is never sent as a zero. A failed read is tried once more, 2 s later (the DHT sensors'
// minimum), so one hiccup is not a fault.
bool sensorRead(Sample& out);
