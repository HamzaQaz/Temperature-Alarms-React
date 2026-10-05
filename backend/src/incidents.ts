/**
 * Incidents: a stretch of time a Device spent in one Condition at warning or worse
 * (docs/adr/0006). This module holds every incident rule; the thresholds stay in
 * conditions.ts, whose output these rules read and never re-derive.
 *
 * Pure functions only: no I/O, no clock. The database layer (incidentStore.ts) loads the open
 * incidents, asks these rules what a Reading or a silence does to them, and saves the answer.
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
  /** The worst Reading during the incident; for Offline, the last Reading before it. */
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
 * is never among them: a Reading is proof the Device is talking.
 */
export function incidentConditions(reading: Omit<TimedReading, 'recordedAt'>, rules: ConditionRules): Map<ConditionName, ConditionLevel> {
  const found = conditionsFor({ reading, secondsSinceReading: 0, ...rules });
  return new Map(found.filter((c) => c.name !== 'Offline' && isIncidentLevel(c.level)).map((c) => [c.name, c.level]));
}

/** The number a Condition is judged on, and which way is worse: higher (+1) or lower (-1). */
const MEASURE: Record<Exclude<ConditionName, 'Offline'>, { value: (r: TimedReading) => number | null; worse: 1 | -1 }> = {
  Hot: { value: (r) => r.tempF, worse: 1 },
  Cold: { value: (r) => r.tempF, worse: -1 },
  Dry: { value: (r) => r.humidity, worse: -1 },
  'Mold risk': { value: (r) => r.humidity, worse: 1 },
};

/** The value the peak Reading is reported by: °F for Hot and Cold, percent for Dry and Mold risk, null for Offline. */
export function peakValue(condition: ConditionName, peak: TimedReading): number | null {
  return condition === 'Offline' ? null : MEASURE[condition].value(peak);
}

function isWorsePeak(condition: Exclude<ConditionName, 'Offline'>, candidate: TimedReading, peak: TimedReading): boolean {
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
  if (isWorsePeak(incident.condition, reading, incident.peak)) next = { ...next, peak: reading };
  const dirty = change !== null || next.peak !== incident.peak || incident.cleanReadings !== 0;
  return { incident: next, change, dirty };
}

/**
 * What a Reading does to a Device's open incidents: each continues, changes level, counts a
 * clean Reading, or closes, and any Condition at warning or worse with no open incident opens
 * one. Returns a step per incident touched, the closed ones included.
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
 * The first whole second at which conditions.ts reports the Device Offline after `last`
 * (Offline begins *after* the allowed missed reports).
 */
export function offlineStartsAt(last: Date, rules: ConditionRules): Date {
  return new Date(last.getTime() + (offlineAfterSeconds(rules.reportIntervalSeconds, rules.thresholds) + 1) * 1000);
}

/**
 * When a Device's silence began, as far as the server can tell: its last Reading, or the moment
 * the server could hear it again (`heardSince`, listening.ts) if that is later. The server's own
 * downtime is not the Device's silence.
 */
const silentSince = (last: Date, heardSince: Date | undefined): Date =>
  heardSince !== undefined && heardSince.getTime() > last.getTime() ? heardSince : last;

/**
 * The Offline incident a silence opens, or null while the Device is still Online at `now`. A
 * Device that has never reported has no Offline incident: there is nothing to have lost.
 */
export function offlineIncident(last: TimedReading | null, now: Date, rules: ConditionRules, heardSince?: Date): IncidentStep | null {
  if (last === null) return null;
  const start = offlineStartsAt(silentSince(last.recordedAt, heardSince), rules);
  if (start.getTime() > now.getTime()) return null;
  return opened('Offline', 'warning', start, last);
}

/**
 * The Offline stretch a Reading ends that the sweep never got to open: the Device went Offline
 * after `previous` and is back before the next pass. Recorded already closed, from when the
 * server would first have reported it Offline to this Reading. Only a stretch that began within
 * the last `sweepSeconds` counts: an older one with nothing open means no sweep was running, so
 * the silence was the server's own (a restart, an outage), not the Device's. Silence counts from `heardSince`
 * when that is later than `previous`, as in offlineIncident.
 */
export function missedOffline(previous: TimedReading | null, reading: TimedReading, rules: ConditionRules, sweepSeconds: number, heardSince?: Date): IncidentStep | null {
  if (previous === null) return null;
  const start = offlineStartsAt(silentSince(previous.recordedAt, heardSince), rules);
  const at = reading.recordedAt.getTime();
  if (start.getTime() > at || start.getTime() < at - sweepSeconds * 1000) return null;
  return close(opened('Offline', 'warning', start, previous).incident, reading.recordedAt);
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
    const offline = offlineIncident(last, at, rules);
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
