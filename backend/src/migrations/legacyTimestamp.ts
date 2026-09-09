/**
 * Timestamps from the per-Device tables (docs/adr/0002), where each row carried the date
 * and the time as two strings written in the server's local zone.
 *
 * Two writers produced them. The PHP era used `date("m/d/Y")` and `date('g:i:s A')` with
 * the zone pinned to America/Chicago. The first Node backend used `toLocaleDateString()`
 * and `toLocaleTimeString()` in the server's own zone, which on an en-US server gives
 * `7/4/2024` and `3:07:09 PM`, and on Node 20 a narrow no-break space before AM/PM
 * (covered by `\s`, which spans every Unicode space).
 * ISO dates and 24-hour times are accepted too, in case a server was set to another locale.
 * Day-first dates are indistinguishable from month-first ones and are not guessed at:
 * a first field above 12 fails to parse rather than being read the other way round.
 */
import { instantIn, isCalendarDay, type WallClock } from '../localDay';

const SLASH_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AaPp])\.?[Mm]\.?)?$/;

type CalendarDate = Pick<WallClock, 'year' | 'month' | 'day'>;

function parseDate(text: string): CalendarDate | undefined {
  let year: number;
  let month: number;
  let day: number;
  const slash = SLASH_DATE.exec(text);
  const isoMatch = slash === null ? ISO_DATE.exec(text) : null;
  if (slash !== null) {
    [month, day, year] = [Number(slash[1]), Number(slash[2]), Number(slash[3])];
  } else if (isoMatch !== null) {
    [year, month, day] = [Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3])];
  } else {
    return undefined;
  }
  return isCalendarDay(year, month, day) ? { year, month, day } : undefined;
}

function parseTime(text: string): Pick<WallClock, 'hour' | 'minute' | 'second'> | undefined {
  const match = TIME.exec(text);
  if (match === null) return undefined;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = match[3] === undefined ? 0 : Number(match[3]);
  const meridiem = match[4]?.toUpperCase();
  if (minute > 59 || second > 59) return undefined;
  if (meridiem === undefined) {
    if (hour > 23) return undefined;
  } else {
    if (hour < 1 || hour > 12) return undefined;
    hour = hour % 12;
    if (meridiem === 'P') hour += 12;
  }
  return { hour, minute, second };
}

/** The instant a legacy DATE and TIME pair names, or undefined when either cannot be read. */
export function parseLegacyTimestamp(date: string, time: string, timeZone: string): Date | undefined {
  const calendar = parseDate(date.trim());
  const clock = parseTime(time.trim());
  if (calendar === undefined || clock === undefined) return undefined;
  return instantIn({ ...calendar, ...clock }, timeZone);
}
