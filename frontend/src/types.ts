/** Wire types: the API's camelCase shape is the only contract. */

export interface Campus {
  id: number;
  name: string;
  shortcode: string;
}

/** A Device as the API lists it, with the Campus it belongs to. */
export interface Device {
  id: number;
  hostname: string;
  closet: string;
  campus: Campus;
}

/** One temperature and humidity sample sent by a Device at a single moment. */
export interface Reading {
  tempF: number;
  humidity: number | null;
  /** ISO instant in UTC; rendered in the browser's zone. */
  recordedAt: string;
}

export type ClosetType = 'IDF' | 'MDF';

/** A Device as the dashboard shows it: where it is and what it last reported. */
export interface DashboardDevice {
  id: number;
  hostname: string;
  campus: Campus;
  closet: string;
  closetType: ClosetType | null;
  latestReading: Reading | null;
  /** Computed on the server: the last Reading arrived within three Report intervals. */
  online: boolean;
  secondsSinceReading: number | null;
}

export interface Dashboard {
  /** How often a healthy Device sends a Reading, so the UI never hardcodes it. */
  reportIntervalSeconds: number;
  /** Three Report intervals: how long without a Reading before a Device is Offline. */
  offlineAfterSeconds: number;
  devices: DashboardDevice[];
}

// The type below still describes the legacy history route and is replaced by ticket 10.

export interface TemperatureData {
  ID: number;
  CAMPUS: string;
  LOCATION: string;
  DATE: string;
  TIME: string;
  TEMP: number;
  HUMIDITY: number | null;
}
