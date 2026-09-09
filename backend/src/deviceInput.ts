/** What a Device needs before it can be inserted: the rules the API and the legacy migration share. */

interface DeviceInput {
  hostname: string;
  campusId: number;
  closet: string;
}

/** A Device is named by its ESP8266 hostname: `ESP_` plus the last six hex digits of its MAC. */
const HOSTNAME_PATTERN = /^ESP_[0-9A-F]{6}$/;
const CLOSET_MAX = 50;

/** Normalised device input, or the message explaining why the body is not one. */
export function parseDevice(body: unknown): DeviceInput | { error: string } {
  const { hostname, campusId, closet } = (body ?? {}) as Record<string, unknown>;
  const normalisedHostname = typeof hostname === 'string' ? hostname.trim().toUpperCase() : '';
  if (!HOSTNAME_PATTERN.test(normalisedHostname)) {
    return { error: 'The hostname must be ESP_ followed by six hex digits, like ESP_A1B2C3' };
  }
  if (typeof campusId !== 'number' || !Number.isInteger(campusId) || campusId <= 0) {
    return { error: 'A device needs a campus' };
  }
  if (typeof closet !== 'string' || closet.trim() === '') return { error: 'A device needs a closet name' };
  if (closet.trim().length > CLOSET_MAX) return { error: `The closet name must be at most ${CLOSET_MAX} characters` };
  return { hostname: normalisedHostname, campusId, closet: closet.trim() };
}
