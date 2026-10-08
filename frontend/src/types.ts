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

/** A staged release stopped by itself: one of its named Devices failed it (docs/adr/0007). */
export interface FirmwareHold {
  at: string;
  hostname: string;
  reason: 'Offline' | 'Sensor fault' | 'update failed';
  /** What the board said, for a failed update; null otherwise. */
  detail: string | null;
}

/** The firmware build on offer to Devices over the air (docs/adr/0007). */
export interface FirmwareRelease {
  version: number;
  size: number;
  md5: string;
  publishedAt: string;
  /** The Devices it is offered to, or null for every Device. */
  only: string[] | null;
  /** The named Devices it went to first, kept once it is widened; null when it went to every Device at once. */
  staged: string[] | null;
  /** Offered to named Devices only, or to every Device. */
  stage: 'named' | 'all';
  /** When a staged release was opened to every Device; null until then. */
  widenedAt: string | null;
  /** Held releases are offered to no one, until withdrawn or replaced by a higher version. */
  hold: FirmwareHold | null;
}

/** One named Device of a staged release, as "Release to all" waits on it. */
export interface StagedDevice {
  hostname: string;
  /** Null when no Device is registered with this hostname. */
  id: number | null;
  firmwareVersion: number | null;
  lastReportAt: string | null;
  /** Offline and Sensor fault, as the server judges them from its reports; none is Online. Null when not registered. */
  conditions: Condition[] | null;
  /** Good Readings in a row on the version it runs. */
  cleanReports: number;
  /** It runs the release's version and has sent cleanReportsToWiden clean Readings on it. */
  ready: boolean;
}

/** GET /api/firmware/status (Admin token): the release, the version each Device last reported, and a staged release's named Devices. */
export interface FirmwareStatus {
  release: FirmwareRelease | null;
  /** Null unless the release is staged. */
  rollout: { cleanReportsToWiden: number; devices: StagedDevice[]; ready: boolean } | null;
  devices: Array<Device & { firmwareVersion: number | null; checkedAt: string | null; info: DeviceInfo | null }>;
}

/** The sensor a board carries, as its firmware names it (config.h, `SENSOR_TYPE`). */
export type SensorType = 'DHT11' | 'DHT22' | 'SHT31';

/** What a board said about itself with its latest Reading (firmware 3 and later); null for older firmware. */
export interface DeviceInfo {
  rssi: number | null;
  uptimeSeconds: number | null;
  freeHeap: number | null;
  resetReason: string | null;
  updateResult: string | null;
  /** Firmware 6 and later; null before. */
  sensor: SensorType | null;
  /** When it said so. */
  at: string;
}

/** One temperature and humidity sample sent by a Device at a single moment. */
export interface Reading {
  tempF: number;
  humidity: number | null;
  /** ISO instant in UTC; rendered in the browser's zone. */
  recordedAt: string;
}

export type ClosetType = 'IDF' | 'MDF';

export type ConditionName = 'Hot' | 'Cold' | 'Dry' | 'Mold risk' | 'Sensor fault' | 'Offline';

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
  /** When the board last reported, a Reading or a fault report; Online and Offline count from it. Null when it never has. */
  lastReportAt: string | null;
  /** Seconds since that report by the server's clock; null when it never has. */
  secondsSinceReport: number | null;
  /** Every Condition the Device is in, worst first. The browser renders these and computes none. */
  conditions: Condition[];
  /** When the board was last refused for its Device token, within 15 minutes; null otherwise. */
  tokenMismatchAt: string | null;
  /** Its incidents still open, oldest first, each with who acknowledged it: the card says who is on them. */
  openIncidents: OpenIncident[];
}

/** Who said they are on an incident, and when (CONTEXT.md, Acknowledgement). Free text: there are no user accounts. */
export interface Acknowledgement {
  /** A name or a short note, 1 to 60 characters. */
  by: string;
  /** ISO instant in UTC. */
  at: string;
}

/** An open incident as a Dashboard card carries it: enough to name it and say who is on it. */
export interface OpenIncident {
  id: number;
  condition: ConditionName;
  /** The worst level it has reached. */
  level: ConditionLevel;
  start: string;
  acknowledgement: Acknowledgement | null;
}

/** What the live stream sends when a Device posts a Reading: the card's new state, matched by hostname. */
export interface ReadingEvent {
  type: 'reading';
  device: string;
  reading: Reading;
  online: boolean;
  conditions: Condition[];
  /** The Reading's own time: it is the Device's last report. */
  lastReportAt: string;
}

/**
 * What the live stream sends when a Device posts a fault report (docs/adr/0009): heard from, but
 * no Reading, so the card keeps its last good one and takes the new state, matched by hostname.
 */
export interface FaultEvent {
  type: 'fault';
  device: string;
  fault: 'sensor';
  online: boolean;
  conditions: Condition[];
  /** When the fault report arrived: the Device's last report. */
  lastReportAt: string;
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
    /** The sensor its board last said it carries (firmware 6 and later); null until one has. */
    sensor: SensorType | null;
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
  /** How many days Readings are kept: the longest range the CSV download takes. */
  retentionDays: number;
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
  /** Who said they are on it; null until someone does. Kept after it ends. */
  acknowledgement: Acknowledgement | null;
}

/** Every incident that overlaps a window, oldest first. */
export interface Incidents {
  from: string;
  to: string;
  incidents: Incident[];
}

/** What the live stream sends when an incident opens, changes level, closes, or is acknowledged. */
export interface IncidentEvent {
  type: 'incident';
  change: 'opened' | 'level' | 'closed' | 'acknowledged';
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

/** GET /api/notifications/status (Admin token): whether Incidents are emailed, through which relay, to whom, and how the last send went. */
export interface NotificationStatus {
  enabled: boolean;
  /** Null when notifications are off. */
  relay: { host: string; port: number; secure: 'starttls' | 'tls' | 'none' } | null;
  from: string | null;
  recipients: string[];
  lastSent: { at: string; subject: string } | null;
  lastFailure: { at: string; error: string } | null;
  /** Notifications waiting to be sent, retries included. */
  pending: number;
  /** Notifications given up on after a day of retries, within the last week. */
  failed: number;
}

/** POST /api/notifications/test: what the relay said when it took the test email. */
export interface TestEmailResult {
  sentAt: string;
  accepted: string[];
  rejected: string[];
  /** The relay's final reply, e.g. `250 2.0.0 OK`. */
  response: string;
}

/** A line of Settings, System, as the server decided it: fine, a feature not set up, or something to act on. */
export type CheckStatus = 'ok' | 'off' | 'attention';

/** A Device as a System line names it. */
interface SystemDevice {
  id: number;
  hostname: string;
  closet: string;
  campus: Campus;
}

/** GET /api/system (Admin token): whether the system itself is OK, line by line, with the thresholds it was judged against. */
export interface SystemHealth {
  /** The server's clock when it looked: ages on the page are counted from it. */
  checkedAt: string;
  /** `storing` is false while the latest Reading could not be written. */
  database: { status: CheckStatus; sizeBytes: number; storing: boolean };
  /** Null figures, and why, when the disk could not be measured. */
  disk: { status: CheckStatus; freeBytes: number | null; totalBytes: number | null; minFreePercent: number; error: string | null };
  /** From the marker `deploy backup` writes; all null when none is recorded. */
  backup: { status: CheckStatus; at: string | null; file: string | null; sizeBytes: number | null; maxAgeDays: number };
  notifications: Pick<NotificationStatus, 'enabled' | 'lastSent' | 'lastFailure' | 'pending' | 'failed'> & { status: CheckStatus };
  /** How many installed Devices the release is offered to, how many of them run it, and those that checked and still run an older build. */
  firmware: {
    status: CheckStatus;
    release: Pick<FirmwareRelease, 'version' | 'publishedAt' | 'only'> | null;
    offered: number;
    current: number;
    behind: Array<SystemDevice & { firmwareVersion: number | null }>;
  };
  /** Installed Devices whose signal has been under `belowDbm` for `forHours` or more. */
  wifi: { status: CheckStatus; belowDbm: number; forHours: number; weak: Array<SystemDevice & { rssi: number; since: string }> };
  /** `version` is the commit the server was built from, null when it was built by hand. */
  server: { status: CheckStatus; version: string | null; startedAt: string; uptimeSeconds: number };
}
