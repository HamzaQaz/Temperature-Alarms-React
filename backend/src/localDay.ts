/**
 * One calendar day in an IANA time zone, as the pair of UTC instants that bound it.
 *
 * Readings are stored in UTC and a technician asks for "5 September" in their own zone,
 * so the day is cut where their midnight falls. A day is whatever the zone says it is:
 * 23 hours when the clocks go forward, 25 when they go back.
 */

export interface LocalDay {
  /** YYYY-MM-DD, as asked for. */
  date: string;
  timeZone: string;
  /** Midnight starting the day, inclusive. */
  from: Date;
  /** Midnight starting the next day, exclusive. */
  to: Date;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a zone the runtime knows (`America/Chicago`, `UTC`); false for anything else. */
export function isTimeZone(value: string): boolean {
  if (value === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The runtime's own zone, from TZ or the system. */
export const serverTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Parts formatter per zone, numeric and 24-hour, cached because constructing one is slow. */
function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** What a clock on the wall in the zone reads at the instant. */
function wallClock(at: Date, timeZone: string): WallClock {
  const read: Partial<WallClock> = {};
  for (const { type, value } of partsFormatter(timeZone).formatToParts(at)) {
    if (type === 'year' || type === 'month' || type === 'day' || type === 'hour' || type === 'minute' || type === 'second') {
      read[type] = Number(value);
    }
  }
  return read as WallClock;
}

/** Milliseconds the zone is ahead of UTC at the instant (negative west of Greenwich). */
function offsetMs(at: Date, timeZone: string): number {
  const { year, month, day, hour, minute, second } = wallClock(at, timeZone);
  return Date.UTC(year, month - 1, day, hour, minute, second) - at.getTime();
}

/**
 * The instant at which the zone's clocks read midnight on the calendar day.
 * Start from midnight UTC and correct by the zone's offset; a second pass settles a day
 * that begins on the far side of a clock change.
 */
function midnightIn(year: number, month: number, day: number, timeZone: string): Date {
  const wall = Date.UTC(year, month - 1, day);
  let guess = wall - offsetMs(new Date(wall), timeZone);
  guess = wall - offsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

/** The calendar day, or undefined when `date` is not a real YYYY-MM-DD day. */
export function localDay(date: string, timeZone: string): LocalDay | undefined {
  const match = DATE_PATTERN.exec(date);
  if (match === null) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  // Date.UTC rolls an impossible day into the next month; a real day round-trips unchanged.
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return undefined;
  return {
    date,
    timeZone,
    from: midnightIn(year, month, day, timeZone),
    to: midnightIn(year, month, day + 1, timeZone),
  };
}

/** The calendar date, YYYY-MM-DD, that the instant falls on in the zone. */
export function todayIn(at: Date, timeZone: string): string {
  const { year, month, day } = wallClock(at, timeZone);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
