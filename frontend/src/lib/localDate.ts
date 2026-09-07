/**
 * Calendar days and clock times as the History page shows them: in this browser's zone,
 * with times in 12-hour form. A day is passed around as YYYY-MM-DD; arithmetic on it
 * goes through UTC so a clock change never turns "the next day" into the same day.
 */

const two = (n: number): string => String(n).padStart(2, '0');

/** YYYY-MM-DD of a Date's local calendar day. */
export function toDateString(date: Date): string {
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/** Today's YYYY-MM-DD in this browser's zone. */
export const today = (): string => toDateString(new Date());

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar day written YYYY-MM-DD. */
export function isDateString(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

/** The YYYY-MM-DD `days` after (or, negative, before) the given one. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${shifted.getUTCFullYear()}-${two(shifted.getUTCMonth() + 1)}-${two(shifted.getUTCDate())}`;
}

/** A local Date at noon on the day, safe to format without a zone shift moving it. */
function atNoon(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

const longDay = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const shortDay = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

/** "Saturday, September 5, 2026" (in the browser's locale). */
export const formatDayLong = (date: string): string => longDay.format(atNoon(date));

/** "Sat, Sep 5". */
export const formatDayShort = (date: string): string => shortDay.format(atNoon(date));

const clockTime = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
const clockTimeSeconds = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
const clockHour = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: true });

/** "2:05 PM". */
export const formatTime = (at: Date | number | string): string => clockTime.format(new Date(at));

/** "2:05:30 PM": the table's column, where two Readings a minute must tell apart. */
export const formatTimeSeconds = (at: Date | number | string): string => clockTimeSeconds.format(new Date(at));

/** "2 PM": a chart axis tick. */
export const formatHour = (at: Date | number): string => clockHour.format(new Date(at));
