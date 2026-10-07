// DHT11 on GPIO 5: read a sample and reject the ones the sensor could not deliver.
#pragma once

struct Sample {
  float tempF;
  float humidity;  // percent
};

// Starts the DHT library on the data pin. Call once from setup().
void sensorBegin();

// Fills `out` and returns true, or logs why the sample was skipped and returns false.
// A failed read (unplugged sensor, bad wire, read too soon) comes back as NaN from the
// library; it is never sent as a zero. A failed read is tried once more, 2 s later (the
// DHT11's minimum), so one hiccup is not a fault.
bool sensorRead(Sample& out);
