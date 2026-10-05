/**
 * The Incidents page's windows and its shared ruler: which stretch of local time is shown
 * (a night, a day, or a week), where an instant falls on the ruler, and how long an incident
 * lasted. Whether something is an incident, and at what level, is the server's; this module
 * only places what it sent. Days are YYYY-MM-DD in this browser's zone, as on History.
 */
import { addDays, formatDayShort, toDateString } from './localDate.ts';
import { levelRank } from './conditions.ts';
import type { ConditionLevel, Incident } from '../types.ts';

/** Overnight is 18:00 to 08:00 local; Today is midnight to midnight; 7 days ends at the close of its last day. */
export type WindowKind = 'overnight' | 'today' | 'week';

export const WINDOW_KINDS: WindowKind[] = ['overnight', 'today', 'week'];

/** Overnight is the default and stays out of the URL. */
export const parseWindowKind = (value: string | null): WindowKind => (value === 'today' || value === 'week' ? value : 'overnight');

const NIGHT_STARTS = 18;
const NIGHT_ENDS = 8;

/** A local Date at an hour of a YYYY-MM-DD day; an hour past 23 runs into the next day. */
function at(date: string, hour: number): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day, hour);
}

/**
 * The day that names the most recent window that has begun: the evening of the night under
 * way or just ended for Overnight (before 18:00 that is yesterday's), and today otherwise.
 */
export function latestDate(kind: WindowKind, now: Date): string {
  const day = toDateString(now);
  if (kind === 'overnight' && now.getHours() < NIGHT_STARTS) return addDays(day, -1);
  return day;
}

/** The instants a window covers: `from` inclusive, `to` exclusive. A night is named by its evening, a week by its last day. */
export function windowBounds(kind: WindowKind, date: string): { from: Date; to: Date } {
  if (kind === 'overnight') return { from: at(date, NIGHT_STARTS), to: at(date, 24 + NIGHT_ENDS) };
  if (kind === 'today') return { from: at(date, 0), to: at(date, 24) };
  return { from: at(addDays(date, -6), 0), to: at(date, 24) };
}

/** How far Previous and Next move: a night or a day, or a whole week. */
export const stepDays = (kind: WindowKind): number => (kind === 'week' ? 7 : 1);

const monthDay = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const atNoon = (date: string): Date => at(date, 12);

/** "Sat, Oct 3 to Sun, Oct 4", "Sun, Oct 4", "Sep 28 to Oct 4". */
export function windowLabel(kind: WindowKind, date: string): string {
  if (kind === 'overnight') return `${formatDayShort(date)} to ${formatDayShort(addDays(date, 1))}`;
  if (kind === 'today') return formatDayShort(date);
  return `${monthDay.format(atNoon(addDays(date, -6)))} to ${monthDay.format(atNoon(date))}`;
}

/** How the summary and the empty state name the window: "overnight", "today", "on Sat, Oct 3", "in the 7 days to Oct 4". */
export function windowPhrase(kind: WindowKind, date: string, now: Date): string {
  if (kind === 'overnight') return date === latestDate('overnight', now) ? 'overnight' : `on the night of ${formatDayShort(date)}`;
  if (kind === 'today') return date === toDateString(now) ? 'today' : `on ${formatDayShort(date)}`;
  return date === toDateString(now) ? 'in the last 7 days' : `in the 7 days to ${monthDay.format(atNoon(date))}`;
}

/** The share of the window, 0 to 1, at which an instant falls; outside the window it is held at the edge. */
export function place(instant: number, from: number, to: number): number {
  return Math.min(1, Math.max(0, (instant - from) / (to - from)));
}

/** A mark on the ruler. `line` draws a grid line there; `label` is written above it; `major` marks survive on a phone. */
export interface Tick {
  at: number;
  label?: string;
  line: boolean;
  major: boolean;
}

const hour = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: true });
const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' });

/** The ruler's marks: every 2 hours of a night, every 3 of a day, and each day of a week (a line at midnight, the name at noon). */
export function ticks(kind: WindowKind, date: string): Tick[] {
  if (kind === 'week') {
    const days = Array.from({ length: 7 }, (_, i) => addDays(date, i - 6));
    return days.flatMap((day, i) => [
      ...(i === 0 ? [] : [{ at: at(day, 0).getTime(), line: true, major: true }]),
      { at: at(day, 12).getTime(), label: weekday.format(atNoon(day)), line: false, major: true },
    ]);
  }
  const [first, every, count] = kind === 'overnight' ? [NIGHT_STARTS, 2, 7] : [0, 3, 8];
  return Array.from({ length: count }, (_, i) => {
    const when = at(date, first + i * every);
    return { at: when.getTime(), label: hour.format(when), line: i > 0, major: i % 3 === 0 };
  });
}

/** One level's stretch inside a span, as shares (0 to 1) of the span. */
export interface SpanPiece {
  level: ConditionLevel;
  left: number;
  width: number;
}

/** Where an incident sits on the ruler, as shares of the window, and its level stretches inside it. */
export interface SpanLayout {
  left: number;
  width: number;
  /** Began before the window: the left edge is cut, not rounded. */
  cutStart: boolean;
  /** Still going: the right edge is the present, marked rather than rounded. */
  ongoing: boolean;
  /** Ends after the window (a past window, or a future edge): the right edge is cut. */
  cutEnd: boolean;
  pieces: SpanPiece[];
}

const ms = (iso: string): number => new Date(iso).getTime();

export function spanLayout(incident: Pick<Incident, 'start' | 'end' | 'segments'>, from: number, to: number, now: number): SpanLayout {
  const start = ms(incident.start);
  const end = incident.end === null ? now : ms(incident.end);
  const left = place(start, from, to);
  const right = place(end, from, to);
  const length = Math.max(end - start, 1);
  const pieces = incident.segments.map((segment) => {
    const a = ms(segment.start);
    const b = segment.end === null ? now : ms(segment.end);
    return { level: segment.level, left: (a - start) / length, width: Math.max(b - a, 0) / length };
  });
  return {
    left,
    width: right - left,
    cutStart: start < from,
    ongoing: incident.end === null && now <= to,
    cutEnd: end > to,
    pieces,
  };
}

/** "23 min", "1 h 25 min", "2 h", "1 d 3 h". Under a minute is "under 1 min". */
export function formatDuration(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 1) return 'under 1 min';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
  const days = Math.floor(hours / 24);
  return hours % 24 === 0 ? `${days} d` : `${days} d ${hours % 24} h`;
}

/** How long an incident has lasted: to its end, or to now while it goes on. */
export const durationOf = (incident: Pick<Incident, 'start' | 'end'>, now: number): number =>
  (incident.end === null ? now : ms(incident.end)) - ms(incident.start);

/**
 * The incident the summary names as the worst: the highest level the server recorded, and of
 * those the longest. The levels are the server's; this only picks among them.
 */
export function worstIncident<T extends Pick<Incident, 'level' | 'start' | 'end'>>(incidents: T[], now: number): T | undefined {
  let worst: T | undefined;
  for (const incident of incidents) {
    if (worst === undefined) {
      worst = incident;
      continue;
    }
    const byLevel = levelRank(incident.level) - levelRank(worst.level);
    if (byLevel > 0 || (byLevel === 0 && durationOf(incident, now) > durationOf(worst, now))) worst = incident;
  }
  return worst;
}

/** True when an incident overlaps the window at all, ongoing ones counting up to now. */
export function overlaps(incident: Pick<Incident, 'start' | 'end'>, from: number, to: number, now: number): boolean {
  const end = incident.end === null ? now : ms(incident.end);
  return ms(incident.start) < to && end >= from;
}
