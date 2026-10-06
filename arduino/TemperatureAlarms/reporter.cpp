#include "reporter.h"

#include <Arduino.h>
#include <ESP8266HTTPClient.h>
#include <ESP8266WiFi.h>
#include <WiFiClientSecure.h>

#include "config.h"

static const char READINGS_PATH[] = "/api/readings";
static const unsigned long HTTP_TIMEOUT_MS = 10 * 1000UL;
// How much of a refusal's body is read for the log, and for how long in all. HTTPClient's own
// getString() reads everything the server sends, waiting up to the timeout per byte, so a server
// that trickles a byte at a time would hold the loop for good.
static const size_t RESPONSE_LOG_MAX = 120;
static const unsigned long RESPONSE_READ_MS = 2 * 1000UL;

// SERVER_URL plus the readings path, built once in reporterBegin() so no String is
// rebuilt on the heap every interval.
static String readingsUrl;

static bool usesTls() {
  return readingsUrl.startsWith("https://");
}

static String readingJson(const char* hostname, const Sample& sample) {
  String json;
  json.reserve(64);
  json += F("{\"device\":\"");
  json += hostname;
  json += F("\",\"temp\":");
  json += String(sample.tempF, 1);
  json += F(",\"humidity\":");
  json += String(sample.humidity, 0);
  json += '}';
  return json;
}

// The start of the response body, printable ASCII only, so a server cannot write a line of its own
// (a fake `report: 201 created`, say) into the serial log the bench reads.
static String responseStart(WiFiClient& client) {
  String text;
  text.reserve(RESPONSE_LOG_MAX);
  unsigned long startedAt = millis();
  while (text.length() < RESPONSE_LOG_MAX && millis() - startedAt < RESPONSE_READ_MS) {
    int c = client.read();
    if (c < 0) {
      if (!client.connected()) break;
      delay(10);
      continue;
    }
    if (c >= 0x20 && c < 0x7f) text += (char)c;
  }
  return text;
}

// One POST over the given client. Returns the HTTP status, or a negative HTTPClient error.
// Redirects stay off (HTTPClient's default): the token goes only to SERVER_URL.
static int post(WiFiClient& client, const String& body, String& response) {
  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.setReuse(false);
  if (!http.begin(client, readingsUrl)) return HTTPC_ERROR_CONNECTION_FAILED;
  http.addHeader(F("Content-Type"), F("application/json"));
  http.addHeader(F("Authorization"), String(F("Bearer ")) + DEVICE_TOKEN);
  int status = http.POST(body);
  if (status > 0 && status != HTTP_CODE_CREATED) response = responseStart(client);
  http.end();
  return status;
}

void reporterBegin() {
  readingsUrl = SERVER_URL;
  if (readingsUrl.endsWith("/")) readingsUrl.remove(readingsUrl.length() - 1);  // forgive the common typo
  readingsUrl += READINGS_PATH;
  Serial.print(F("report: every "));
  Serial.print(REPORT_INTERVAL_SECONDS);
  Serial.print(F(" s to "));
  Serial.println(readingsUrl);
}

void reportReading(const char* hostname, const Sample& sample) {
  String body = readingJson(hostname, sample);
  String response;
  int status;
  if (usesTls()) {
    // No certificate check: a pinned fingerprint would need a reflash at every renewal
    // (docs/adr/0003). The default 16 KB receive buffer stays: a smaller one only works
    // when the server negotiates MFLN, which nginx does not, and the heap has room.
    BearSSL::WiFiClientSecure client;
    client.setInsecure();
    status = post(client, body, response);
  } else {
    WiFiClient client;
    status = post(client, body, response);
  }

  if (status == HTTP_CODE_CREATED) {
    Serial.println(F("report: 201 created"));
    return;
  }
  if (status < 0) {
    Serial.print(F("report: failed, "));
    Serial.println(HTTPClient::errorToString(status));
  } else {
    Serial.print(F("report: "));
    Serial.print(status);
    Serial.print(' ');
    Serial.println(response);
  }
}
