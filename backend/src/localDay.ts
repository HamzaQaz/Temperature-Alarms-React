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

/** What a clock on the wall reads: a calendar date and a 24-hour time, in no particular zone. */
export interface WallClock {
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

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** "2026-09-05 14:30:00": what a clock on the wall in the zone reads at the instant, in the form Excel takes as a date and time. */
export function wallClockText(at: Date, timeZone: string): string {
  const { year, month, day, hour, minute, second } = wallClock(at, timeZone);
  return `${pad(year, 4)}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

/** Milliseconds the zone is ahead of UTC at the instant (negative west of Greenwich). */
function offsetMs(at: Date, timeZone: string): number {
  const { year, month, day, hour, minute, second } = wallClock(at, timeZone);
  return Date.UTC(year, month - 1, day, hour, minute, second) - at.getTime();
}

/**
 * The instant at which the zone's clocks read the wall-clock time.
 * Start from the same wall-clock time in UTC and correct by the zone's offset; a second
 * pass settles a time on the far side of a clock change. A time that happens twice when
 * the clocks go back resolves to one of the two; a time that never happens resolves to the
 * instant the clocks skipped to.
 */
export function instantIn({ year, month, day, hour, minute, second }: WallClock, timeZone: string): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = wall - offsetMs(new Date(wall), timeZone);
  guess = wall - offsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

const midnightIn = (year: number, month: number, day: number, timeZone: string): Date =>
  instantIn({ year, month, day, hour: 0, minute: 0, second: 0 }, timeZone);

/** True when the numbers name a day that exists: 2024-02-29 yes, 2024-02-30 no. */
export function isCalendarDay(year: number, month: number, day: number): boolean {
  // Date.UTC rolls an impossible day into the next month; a real day round-trips unchanged.
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

/** The calendar day, or undefined when `date` is not a real YYYY-MM-DD day. */
export function localDay(date: string, timeZone: string): LocalDay | undefined {
  const match = DATE_PATTERN.exec(date);
  if (match === null) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (!isCalendarDay(year, month, day)) return undefined;
  return {
    date,
    timeZone,
    from: midnightIn(year, month, day, timeZone),
    to: midnightIn(year, month, day + 1, timeZone),
  };
}

/** One calendar month in a zone, as the pair of UTC instants that bound it. */
export interface LocalMonth {
  /** YYYY-MM. */
  month: string;
  timeZone: string;
  /** Midnight starting its first day, inclusive. */
  from: Date;
  /** Midnight starting the next month's first day, exclusive. */
  to: Date;
}

const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

/** The calendar month, or undefined when `month` is not a real YYYY-MM month. */
export function localMonth(month: string, timeZone: string): LocalMonth | undefined {
  const match = MONTH_PATTERN.exec(month);
  if (match === null) return undefined;
  const [year, number] = [Number(match[1]), Number(match[2])];
  if (number < 1 || number > 12) return undefined;
  // Month 13 rolls into January of the next year.
  return { month, timeZone, from: midnightIn(year, number, 1, timeZone), to: midnightIn(year, number + 1, 1, timeZone) };
}

/** The calendar month before the one the instant falls in, in the zone: the month just ended. */
export function monthBefore(at: Date, timeZone: string): LocalMonth {
  const { year, month } = wallClock(at, timeZone);
  const [y, m] = month === 1 ? [year - 1, 12] : [year, month - 1];
  return { month: `${pad(y, 4)}-${pad(m)}`, timeZone, from: midnightIn(y, m, 1, timeZone), to: midnightIn(y, m + 1, 1, timeZone) };
}

/** The calendar date, YYYY-MM-DD, that the instant falls on in the zone. */
export function todayIn(at: Date, timeZone: string): string {
  const { year, month, day } = wallClock(at, timeZone);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
