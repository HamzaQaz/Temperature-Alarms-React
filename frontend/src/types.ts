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
  /** GET /api/devices only: when the board was last refused for its Device token, within 15 minutes. */
  tokenMismatchAt?: string | null;
}

/**
 * A Device token rotation (GET /api/devices/rotation, Admin token): while the previous token is
 * still accepted, the Devices whose latest Reading used it, and those not heard since `since`.
 */
export interface DeviceRotation {
  active: boolean;
  since: string;
  previous: Device[];
  unheard: Device[];
}

/** A board reporting with the Device token that is not registered yet, waiting to be adopted (GET /api/devices/pending). */
export interface PendingDevice {
  hostname: string;
  firstSeen: string;
  lastSeen: string;
  reports: number;
  lastReading: { tempF: number; humidity: number } | null;
  /** The address it reported from, to find it on the network. */
  address: string | null;
  /** Hidden from the pop-up; still listed in Settings. */
  ignored: boolean;
}

/** The firmware build on offer to Devices over the air (docs/adr/0007). */
export interface FirmwareRelease {
  version: number;
  size: number;
  md5: string;
  publishedAt: string;
  /** The Devices it is offered to, or null for every Device. */
  only: string[] | null;
}

/** GET /api/firmware/status (Admin token): the release and the version each Device last reported. */
export interface FirmwareStatus {
  release: FirmwareRelease | null;
  devices: Array<Device & { firmwareVersion: number | null; checkedAt: string | null }>;
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
  /** When the board was last refused for its Device token, within 15 minutes; null otherwise. */
  tokenMismatchAt: string | null;
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

/** One stretch of an incident at one level. ISO instants in UTC; `end` is null while it lasts. */
export interface IncidentSegment {
  level: ConditionLevel;
  start: string;
  end: string | null;
}

/** A stretch of time a Device spent in one Condition at warning or worse, as the server recorded it (ADR 0006). */
export interface Incident {
  id: number;
  device: Device;
  condition: ConditionName;
  /** The worst level any segment reached. */
  level: ConditionLevel;
  start: string;
  /** Null while the incident is ongoing. */
  end: string | null;
  /** The worst Reading during the incident; for Offline, the last Reading before it. `value` is °F for Hot and Cold, percent for Dry and Mold risk, null for Offline. */
  peak: { value: number | null; tempF: number; humidity: number | null; recordedAt: string };
  /** Oldest first; only the last can be open. */
  segments: IncidentSegment[];
}

/** Every incident that overlaps a window, oldest first. */
export interface Incidents {
  from: string;
  to: string;
  incidents: Incident[];
}

/** What the live stream sends when an incident opens, changes level, or closes. */
export interface IncidentEvent {
  type: 'incident';
  change: 'opened' | 'level' | 'closed';
  incident: Incident;
}

/** How many closets at a Campus are in one Condition at one level. */
export interface ConditionCount extends Condition {
  count: number;
}

/** One local day of a Campus's last seven, as the server cut it in the zone asked for. */
export interface OverviewDay {
  /** YYYY-MM-DD in the overview's zone. */
  date: string;
  from: string;
  to: string;
  /** Today, still going: its high so far. */
  partial: boolean;
  /** The highest temperature any of the Campus's closets reported that day; null with no Readings. */
  maxTempF: number | null;
  /** True when an incident at the Campus overlapped the day. */
  incident: boolean;
  /** The worst level an incident at the Campus reached that day; null without one. */
  incidentLevel: ConditionLevel | null;
}

/** One Campus as IT leadership reads it: now, its worst closet, its week, and its last incident. */
export interface CampusOverview {
  id: number;
  name: string;
  shortcode: string;
  closets: number;
  /** The level of its worst closet now; null when every closet is in range (or it has none). */
  level: ConditionLevel | null;
  now: {
    /** Each Condition at warning or worse, with how many closets are in it, worst first. */
    conditions: ConditionCount[];
    /** Moderate Mold risk: worth knowing, never an incident. */
    headsUp: ConditionCount[];
  };
  /** Its worst closet now; null when the Campus has no Devices. */
  worst: {
    id: number;
    hostname: string;
    closet: string;
    closetType: ClosetType | null;
    latestReading: Reading | null;
    level: ConditionLevel | null;
    offline: boolean;
    /** Seconds since its latest Reading by the server's clock; null with no Readings. */
    secondsSinceReading: number | null;
    conditions: Condition[];
  } | null;
  /** The last seven local days, oldest first; the last is today. */
  days: OverviewDay[];
  /** The open incident's start, or the end of the latest to close within the retention window. */
  lastIncident: { ongoing: true; start: string } | { ongoing: false; end: string } | null;
}

/** Every Campus, worst first, with the line the chart draws and how far back Readings reach. */
export interface Overview {
  timeZone: string;
  threshold: { name: ConditionName; level: ConditionLevel; tempF: number };
  retentionDays: number;
  campuses: CampusOverview[];
}
