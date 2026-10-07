/**
 * Conditions: the named states a Device is in (Hot, Cold, Dry, Mold risk from its latest
 * Reading; Sensor fault and Offline from its reports), each with a level. Every rule and every
 * threshold lives here; the browser renders what this module returns and computes nothing itself.
 *
 * Pure functions only: no I/O, no clock. Callers pass the latest Reading, how many seconds ago
 * the Device last reported, and how many fault reports it has sent in a row.
 */

export type ConditionName = 'Hot' | 'Cold' | 'Dry' | 'Mold risk' | 'Sensor fault' | 'Offline';

/** Worst first. Mold risk uses moderate/high (the existing rule); the others use warning/critical. */
export const LEVELS_WORST_FIRST = ['critical', 'high', 'warning', 'moderate'] as const;
export type ConditionLevel = (typeof LEVELS_WORST_FIRST)[number];

export interface Condition {
  name: ConditionName;
  level: ConditionLevel;
}

/** The one place a number lives. Change a threshold here (or through the environment, see config). */
export interface Thresholds {
  /** Hot warning at or above this many °F. */
  hotWarningF: number;
  /** Hot critical at or above this many °F. */
  hotCriticalF: number;
  /** Cold warning at or below this many °F. */
  coldWarningF: number;
  /** Dry warning at or below this percent relative humidity. */
  dryWarningPercent: number;
  /** Offline once this many Report intervals have passed with no report. */
  missedReportsBeforeOffline: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  hotWarningF: 82,
  hotCriticalF: 90,
  coldWarningF: 50,
  dryWarningPercent: 20,
  missedReportsBeforeOffline: 3,
};

/**
 * Sensor fault once this many fault reports arrive in a row (docs/adr/0009): the same three
 * intervals Offline waits by default, so one failed DHT11 read raises nothing. Fixed, not configured.
 */
export const FAULT_REPORTS_BEFORE_SENSOR_FAULT = 3;

/**
 * Mold risk keeps the rule the browser used before Conditions moved to the server:
 * moderate when humidity is above 60 percent anywhere mold can grow (32 to 100 °F),
 * high when humidity is above 70 percent in mold's preferred range (77 to 86 °F).
 */
const MOLD = {
  growthMinF: 32,
  growthMaxF: 100,
  moderateAbovePercent: 60,
  preferredMinF: 77,
  preferredMaxF: 86,
  highAbovePercent: 70,
} as const;

export interface LatestReading {
  tempF: number;
  humidity: number | null;
}

/** What the rules need besides the Reading itself: the deployment's interval and thresholds. */
export interface ConditionRules {
  reportIntervalSeconds: number;
  thresholds?: Thresholds;
}

export interface ConditionsInput extends ConditionRules {
  /** The Device's latest Reading, or null when it has never sent one. */
  reading: LatestReading | null;
  /** Seconds since the Device last reported, a Reading or a fault report; null when it never has. */
  secondsSinceReport: number | null;
  /** Fault reports in a row since its last Reading; 0 when omitted (firmware before 5 sends none). */
  sensorFaults?: number;
}

/** How long without a report before a Device is Offline: three Report intervals by default. */
/** Online is the absence of the Offline Condition, so the flag and the badge can never disagree. */
export const isOffline = (conditions: Condition[]): boolean => conditions.some((c) => c.name === 'Offline');

export function offlineAfterSeconds(reportIntervalSeconds: number, thresholds: Thresholds = DEFAULT_THRESHOLDS): number {
  return thresholds.missedReportsBeforeOffline * reportIntervalSeconds;
}

function hot(tempF: number, thresholds: Thresholds): Condition | null {
  if (tempF >= thresholds.hotCriticalF) return { name: 'Hot', level: 'critical' };
  if (tempF >= thresholds.hotWarningF) return { name: 'Hot', level: 'warning' };
  return null;
}

function cold(tempF: number, thresholds: Thresholds): Condition | null {
  return tempF <= thresholds.coldWarningF ? { name: 'Cold', level: 'warning' } : null;
}

function dry(humidity: number, thresholds: Thresholds): Condition | null {
  return humidity <= thresholds.dryWarningPercent ? { name: 'Dry', level: 'warning' } : null;
}

function moldRisk(tempF: number, humidity: number): Condition | null {
  const preferredTemp = tempF >= MOLD.preferredMinF && tempF <= MOLD.preferredMaxF;
  if (preferredTemp && humidity > MOLD.highAbovePercent) return { name: 'Mold risk', level: 'high' };
  const growthTemp = tempF >= MOLD.growthMinF && tempF <= MOLD.growthMaxF;
  if (growthTemp && humidity > MOLD.moderateAbovePercent) return { name: 'Mold risk', level: 'moderate' };
  return null;
}

/**
 * Sensor fault once the board has said its sensor is not answering three times in a row. It is
 * critical: the board is talking, but the closet is unwatched.
 */
function sensorFault(sensorFaults: number): Condition | null {
  return sensorFaults >= FAULT_REPORTS_BEFORE_SENSOR_FAULT ? { name: 'Sensor fault', level: 'critical' } : null;
}

/**
 * Offline once the last report is older than the allowed missed reports; never having
 * reported counts. Exactly three intervals is still Online (Offline begins *after* them).
 * A fault report counts as a report: it is hearing from the board (docs/adr/0009).
 * It carries the warning level: a silent closet needs a visit as much as a hot one.
 */
function offline(secondsSinceReport: number | null, reportIntervalSeconds: number, thresholds: Thresholds): Condition | null {
  const stale = secondsSinceReport === null || secondsSinceReport > offlineAfterSeconds(reportIntervalSeconds, thresholds);
  return stale ? { name: 'Offline', level: 'warning' } : null;
}

const rank = (level: ConditionLevel): number => LEVELS_WORST_FIRST.indexOf(level);

/**
 * Every Condition the Device is in right now, worst level first (ties keep the order
 * Hot, Cold, Dry, Mold risk, Sensor fault, Offline). A stale Reading still reports what it
 * said, alongside Offline, so a closet that was hot when its Device died stays visible. Under
 * a Sensor fault it does not: the sensor died, so its last Reading says nothing about the
 * closet now, and a sensor that died hot must not keep the closet Hot.
 */
export function conditionsFor({
  reading,
  secondsSinceReport,
  sensorFaults = 0,
  reportIntervalSeconds,
  thresholds = DEFAULT_THRESHOLDS,
}: ConditionsInput): Condition[] {
  const found: (Condition | null)[] = [];
  const fault = sensorFault(sensorFaults);
  if (reading !== null && fault === null) {
    found.push(hot(reading.tempF, thresholds), cold(reading.tempF, thresholds));
    if (reading.humidity !== null) {
      found.push(dry(reading.humidity, thresholds), moldRisk(reading.tempF, reading.humidity));
    }
  }
  found.push(fault, offline(secondsSinceReport, reportIntervalSeconds, thresholds));
  // Array sort is stable, so ties keep the push order above.
  return found.filter((c): c is Condition => c !== null).sort((a, b) => rank(a.level) - rank(b.level));
}

/** The most severe level present, or null when the Device is in no Condition. */
export function worstLevel(conditions: Condition[]): ConditionLevel | null {
  return conditions.reduce<ConditionLevel | null>((worst, { level }) => (worst === null || rank(level) < rank(worst) ? level : worst), null);
}
