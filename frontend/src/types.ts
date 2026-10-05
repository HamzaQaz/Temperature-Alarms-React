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

export type ConditionName = 'Hot' | 'Cold' | 'Dry' | 'Mold risk' | 'Offline';

/** Worst first: critical, high, warning, moderate. Mold risk uses moderate/high; the rest warning/critical. */
export type ConditionLevel = 'critical' | 'high' | 'warning' | 'moderate';

/** A named state the Device's latest Reading is in, decided on the server from fixed thresholds. */
export interface Condition {
  name: ConditionName;
  level: ConditionLevel;
}

/** A Device as the dashboard shows it: where it is and what it last reported. */
export interface DashboardDevice {
  id: number;
  hostname: string;
  campus: Campus;
  closet: string;
  closetType: ClosetType | null;
  latestReading: Reading | null;
  /** Computed on the server: the Device is not in the Offline Condition. */
  online: boolean;
  secondsSinceReading: number | null;
  /** Every Condition the Device is in, worst first. The browser renders these and computes none. */
  conditions: Condition[];
}

/** What the live stream sends when a Device posts a Reading: the card's new state, matched by hostname. */
export interface ReadingEvent {
  type: 'reading';
  device: string;
  reading: Reading;
  online: boolean;
  conditions: Condition[];
}

/** How the dashboard lists its Devices; the server sorts, the browser shows the order it gets. */
export type DashboardOrder = 'worst' | 'campus';

export interface Dashboard {
  /** How often a healthy Device sends a Reading, so the UI never hardcodes it. */
  reportIntervalSeconds: number;
  /** Three Report intervals: how long without a Reading before a Device is Offline. */
  offlineAfterSeconds: number;
  devices: DashboardDevice[];
}

export interface DaySummary {
  min: number;
  max: number;
  /** To one decimal place. */
  avg: number;
}

/** One local day of a Device's Readings, oldest first, with the day's numbers. */
export interface History {
  device: {
    id: number;
    hostname: string;
    closet: string;
    closetType: ClosetType | null;
    campus: Campus;
  };
  /** The day shown, YYYY-MM-DD in `timeZone`. */
  date: string;
  /** The IANA zone the day was cut in: this browser's, as sent with the request. */
  timeZone: string;
  /** The day's bounds as UTC instants: from inclusive, to exclusive. */
  from: string;
  to: string;
  readings: Reading[];
  /** True when the day held more Readings than one response carries: `readings` is the day's first ones and the summary covers only those. */
  truncated?: boolean;
  summary: {
    tempF: DaySummary | null;
    humidity: DaySummary | null;
  };
}
