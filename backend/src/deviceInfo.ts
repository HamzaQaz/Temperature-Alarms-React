/** The sensors the firmware can drive (config.h, `SENSOR_TYPE`). */
export const SENSOR_TYPES = ['DHT11', 'DHT22', 'SHT31'] as const;
export type SensorType = (typeof SENSOR_TYPES)[number];

/**
 * What a board says about itself with each Reading (firmware 3 and later): its firmware version,
 * WiFi signal, uptime, free memory, why it last restarted, and how its last update attempt went;
 * from firmware 6, which sensor it carries. For technicians on the Firmware tab and History; nothing
 * decides on it. Every field is optional, a value out of range is dropped rather than refusing the
 * Reading, and text is cut to printable ASCII.
 */
export interface DeviceInfo {
  firmwareVersion: number | null;
  rssi: number | null;
  uptimeSeconds: number | null;
  freeHeap: number | null;
  resetReason: string | null;
  updateResult: string | null;
  sensor: SensorType | null;
}

const int = (value: unknown, min: number, max: number): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null;

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/[^\x20-\x7e]+/g, ' ').trim().slice(0, max).trim();
  return clean === '' ? null : clean;
};

const sensorType = (value: unknown): SensorType | null => (SENSOR_TYPES as readonly unknown[]).includes(value) ? (value as SensorType) : null;

/** The fields a Reading carries about its board, or null when it carries none (older firmware). */
export function parseDeviceInfo(body: unknown): DeviceInfo | null {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!['fw', 'rssi', 'uptime', 'heap', 'reset', 'update', 'sensor'].some((key) => key in b)) return null;
  return {
    firmwareVersion: int(b.fw, 0, 999_999_999),
    rssi: int(b.rssi, -127, 0),
    uptimeSeconds: int(b.uptime, 0, 4_294_967),
    freeHeap: int(b.heap, 0, 1_048_576),
    resetReason: text(b.reset, 60),
    updateResult: text(b.update, 80),
    sensor: sensorType(b.sensor),
  };
}
