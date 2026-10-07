/**
 * Incidents: a stretch of time a Device spent in one Condition at warning or worse
 * (docs/adr/0006). This module holds every incident rule; the thresholds stay in
 * conditions.ts, whose output these rules read and never re-derive.
 *
 * Pure functions only: no I/O, no clock. The database layer (incidentStore.ts) loads the open
 * incidents, asks these rules what a Reading, a fault report, or a silence does to them, and
 * saves the answer.
 * The demo replays its backfilled week through `replayIncidents`, so the two cannot disagree.
 */
import {
  conditionsFor,
  LEVELS_WORST_FIRST,
  offlineAfterSeconds,
  type ConditionLevel,
  type ConditionName,
  type ConditionRules,
} from './conditions';

/** One Reading at a moment, as the rules see it. */
export interface TimedReading {
  tempF: number;
  humidity: number | null;
  recordedAt: Date;
}

/** One stretch of an incident at one level. `end` is null while it lasts. */
export interface Segment {
  /** The stored row's id, once saved. */
  id?: number;
  level: ConditionLevel;
  start: Date;
  end: Date | null;
}

export interface IncidentState {
  /** The stored row's id, once saved. */
  id?: number;
  condition: ConditionName;
  /** The worst level any segment reached. */
  level: ConditionLevel;
  start: Date;
  /** Null while the incident is open. */
  end: Date | null;
  /** The worst Reading during the incident; for Offline and Sensor fault, the last good Reading before it. */
  peak: TimedReading;
  /** Oldest first; only the last can be open. */
  segments: Segment[];
  /** Consecutive Readings without the Condition at warning or worse since it was last seen. */
  cleanReadings: number;
  /** When the first of those clean Readings arrived: the end, should a second follow. */
  firstCleanAt: Date | null;
}

/** What a Reading or a sweep did to an incident; null when it changed nothing worth telling a browser. */
export type IncidentChange = 'opened' | 'level' | 'closed';

export interface IncidentStep {
  incident: IncidentState;
  change: IncidentChange | null;
  /** True when anything about the stored row must be written (a peak, a clean count, a change). */
  dirty: boolean;
}

/** Clean Readings in a row that close an incident: one is a blip, two is over. */
export const CLEAN_READINGS_TO_CLOSE = 2;

const rank = (level: ConditionLevel): number => LEVELS_WORST_FIRST.indexOf(level);

/** Warning or worse: what makes a Condition an incident. Moderate Mold risk is a heads-up only. */
export const isIncidentLevel = (level: ConditionLevel): boolean => rank(level) <= rank('warning');

/**
 * The Conditions a just-arrived Reading puts the Device in at incident level, by name. Offline
 * is never among them: a Reading is proof the Device is talking. Nor is Sensor fault: a Reading
 * is proof the sensor answers.
 */
export function incidentConditions(reading: Omit<TimedReading, 'recordedAt'>, rules: ConditionRules): Map<ConditionName, ConditionLevel> {
  const found = conditionsFor({ reading, secondsSinceReport: 0, ...rules });
  return new Map(found.filter((c) => c.name !== 'Offline' && isIncidentLevel(c.level)).map((c) => [c.name, c.level]));
}

/** The Conditions judged on a Reading's values, as opposed to on the Device's reports. */
type ValueCondition = Exclude<ConditionName, 'Offline' | 'Sensor fault'>;

const isValueCondition = (condition: ConditionName): condition is ValueCondition => condition !== 'Offline' && condition !== 'Sensor fault';

/** The number a Condition is judged on, and which way is worse: higher (+1) or lower (-1). */
const MEASURE: Record<ValueCondition, { value: (r: TimedReading) => number | null; worse: 1 | -1 }> = {
  Hot: { value: (r) => r.tempF, worse: 1 },
  Cold: { value: (r) => r.tempF, worse: -1 },
  Dry: { value: (r) => r.humidity, worse: -1 },
  'Mold risk': { value: (r) => r.humidity, worse: 1 },
};

/** The value the peak Reading is reported by: °F for Hot and Cold, percent for Dry and Mold risk, null for Offline and Sensor fault. */
export function peakValue(condition: ConditionName, peak: TimedReading): number | null {
  return isValueCondition(condition) ? MEASURE[condition].value(peak) : null;
}

function isWorsePeak(condition: ValueCondition, candidate: TimedReading, peak: TimedReading): boolean {
  const { value, worse } = MEASURE[condition];
  const a = value(candidate);
  const b = value(peak);
  if (a === null) return false;
  return b === null || (a - b) * worse > 0;
}

function opened(condition: ConditionName, level: ConditionLevel, start: Date, peak: TimedReading): IncidentStep {
  return {
    incident: { condition, level, start, end: null, peak, segments: [{ level, start, end: null }], cleanReadings: 0, firstCleanAt: null },
    change: 'opened',
    dirty: true,
  };
}

function close(incident: IncidentState, end: Date): IncidentStep {
  const segments = incident.segments.map((s) => (s.end === null ? { ...s, end } : s));
  return { incident: { ...incident, end, segments }, change: 'closed', dirty: true };
}

/** One open incident under a new Reading. */
function stepOne(incident: IncidentState, reading: TimedReading, now: Map<ConditionName, ConditionLevel>): IncidentStep {
  const at = reading.recordedAt;
  // Offline ends the moment the Device is heard from again.
  if (incident.condition === 'Offline') return close(incident, at);

  const level = now.get(incident.condition);
  if (level === undefined) {
    const cleanReadings = incident.cleanReadings + 1;
    const firstCleanAt = incident.firstCleanAt ?? at;
    if (cleanReadings >= CLEAN_READINGS_TO_CLOSE) return close(incident, firstCleanAt);
    return { incident: { ...incident, cleanReadings, firstCleanAt }, change: null, dirty: true };
  }

  let next: IncidentState = { ...incident, cleanReadings: 0, firstCleanAt: null };
  let change: IncidentChange | null = null;
  const current = incident.segments[incident.segments.length - 1];
  if (current.level !== level) {
    next.segments = [...incident.segments.slice(0, -1), { ...current, end: at }, { level, start: at, end: null }];
    if (rank(level) < rank(incident.level)) next.level = level;
    change = 'level';
  }
  if (isValueCondition(incident.condition) && isWorsePeak(incident.condition, reading, incident.peak)) next = { ...next, peak: reading };
  const dirty = change !== null || next.peak !== incident.peak || incident.cleanReadings !== 0;
  return { incident: next, change, dirty };
}

/**
 * What a Reading does to a Device's open incidents: each continues, changes level, counts a
 * clean Reading, or closes, and any Condition at warning or worse with no open incident opens
 * one. Returns a step per incident touched, the closed ones included. An open Sensor fault
 * counts the Reading as clean, so two good Readings in a row close it like any other.
 */
export function applyReading(open: IncidentState[], reading: TimedReading, rules: ConditionRules): IncidentStep[] {
  const now = incidentConditions(reading, rules);
  const steps = open.map((incident) => stepOne(incident, reading, now));
  const covered = new Set(open.map((i) => i.condition));
  for (const [condition, level] of now) {
    if (!covered.has(condition)) steps.push(opened(condition, level, reading.recordedAt, reading));
  }
  return steps;
}

/**
 * What a fault report (docs/adr/0009) does to a Device's open incidents. `sensorFaults` is the
 * count including this report. It is hearing from the board, so an open Offline incident ends
 * here. An open Sensor fault continues, and its clean count starts again: the sensor failed
 * between good Readings. Value incidents are left as they are, their clean count frozen until
 * Readings resume. Sensor fault opens on the report that brings the count to the threshold,
 * judged by conditions.ts, peaking at `lastReading`, the last good Reading. A Device that has
 * never sent a Reading has nothing to peak at, so it opens none; its Condition still shows.
 */
export function applyFaultReport(
  open: IncidentState[],
  { at, sensorFaults }: { at: Date; sensorFaults: number },
  lastReading: TimedReading | null,
  rules: ConditionRules,
): IncidentStep[] {
  const steps = open.map((incident): IncidentStep => {
    if (incident.condition === 'Offline') return close(incident, at);
    if (incident.condition !== 'Sensor fault' || incident.cleanReadings === 0) return { incident, change: null, dirty: false };
    return { incident: { ...incident, cleanReadings: 0, firstCleanAt: null }, change: null, dirty: true };
  });
  const fault = conditionsFor({ reading: null, secondsSinceReport: 0, sensorFaults, ...rules }).find((c) => c.name === 'Sensor fault');
  if (fault !== undefined && lastReading !== null && !open.some((i) => i.condition === 'Sensor fault')) {
    steps.push(opened('Sensor fault', fault.level, at, lastReading));
  }
  return steps;
}

/**
 * When a Device last reported, a Reading or a fault report, and its last good Reading: Offline
 * counts silence from the one and reports the other as its peak.
 */
export interface LastReport {
  at: Date;
  /** Null when the Device has only ever sent fault reports. */
  reading: TimedReading | null;
}

/**
 * The first whole second at which conditions.ts reports the Device Offline after `last`
 * (Offline begins *after* the allowed missed reports).
 */
export function offlineStartsAt(last: Date, rules: ConditionRules): Date {
  return new Date(last.getTime() + (offlineAfterSeconds(rules.reportIntervalSeconds, rules.thresholds) + 1) * 1000);
}

/**
 * When a Device's silence began, as far as the server can tell: its last report, or the moment
 * the server could hear it again (`heardSince`, listening.ts) if that is later. The server's own
 * downtime is not the Device's silence.
 */
const silentSince = (last: Date, heardSince: Date | undefined): Date =>
  heardSince !== undefined && heardSince.getTime() > last.getTime() ? heardSince : last;

/**
 * The Offline incident a silence opens, or null while the Device is still Online at `now`. A
 * Device that has never reported has no Offline incident: there is nothing to have lost. Nor
 * has one that has never sent a Reading, which leaves it no peak.
 */
export function offlineIncident(last: LastReport | null, now: Date, rules: ConditionRules, heardSince?: Date): IncidentStep | null {
  if (last === null || last.reading === null) return null;
  const start = offlineStartsAt(silentSince(last.at, heardSince), rules);
  if (start.getTime() > now.getTime()) return null;
  return opened('Offline', 'warning', start, last.reading);
}

/**
 * The Offline stretch a report arriving `at` (a Reading or a fault report) ends that the sweep
 * never got to open: the Device went Offline after `previous` and is back before the next pass.
 * Recorded already closed, from when the server would first have reported it Offline to this
 * report. Only a stretch that began within the last `sweepSeconds` counts: an older one with
 * nothing open means no sweep was running, so the silence was the server's own (a restart, an
 * outage), not the Device's. Silence counts from `heardSince` when that is later than
 * `previous`, as in offlineIncident.
 */
export function missedOffline(previous: LastReport | null, at: Date, rules: ConditionRules, sweepSeconds: number, heardSince?: Date): IncidentStep | null {
  if (previous === null || previous.reading === null) return null;
  const start = offlineStartsAt(silentSince(previous.at, heardSince), rules);
  if (start.getTime() > at.getTime() || start.getTime() < at.getTime() - sweepSeconds * 1000) return null;
  return close(opened('Offline', 'warning', start, previous.reading).incident, at);
}

/**
 * Run the rules over a Device's Readings, oldest first, as ingest and the Offline sweep would
 * have seen them live: every gap longer than the allowed missed reports opens an Offline
 * incident that the next Reading closes. A silence after the last Reading counts up to `until`.
 * Returns every incident, the ones still open at the end included (end null).
 */
export function replayIncidents(readings: TimedReading[], rules: ConditionRules, until?: Date): IncidentState[] {
  const all: IncidentState[] = [];
  let open: IncidentState[] = [];
  let last: TimedReading | null = null;
  const advance = (steps: IncidentStep[]) => {
    open = [];
    for (const { incident } of steps) {
      if (incident.end === null) open.push(incident);
      else all.push(incident);
    }
  };
  const silence = (at: Date) => {
    if (open.some((i) => i.condition === 'Offline')) return;
    const offline = offlineIncident(last === null ? null : { at: last.recordedAt, reading: last }, at, rules);
    if (offline !== null) open.push(offline.incident);
  };
  for (const reading of readings) {
    silence(new Date(reading.recordedAt.getTime() - 1000));
    advance(applyReading(open, reading, rules));
    last = reading;
  }
  if (until !== undefined) silence(until);
  return [...all, ...open].sort((a, b) => a.start.getTime() - b.start.getTime());
}
