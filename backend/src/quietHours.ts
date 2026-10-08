/**
 * Quiet hours (docs/adr/0008): when warning emails wait. A daily window on the server's clock
 * (NOTIFY_QUIET_HOURS, `18:00-07:00`, which may run past midnight) and, with
 * NOTIFY_QUIET_WEEKENDS, all of Saturday and Sunday. Windows that meet are one: Friday night
 * runs into the weekend, and the weekend into Monday morning. Which notifications wait is
 * outbox.ts's rule; this says only when the quiet ends.
 *
 * Pure functions only: no I/O, no clock. The zone is handed in: the server's own.
 */
import { instantAfter, wallClock, weekdayOf } from './localDay';

/** A daily window, as minutes after midnight. It runs past midnight when it ends earlier than it starts. */
export interface DailyWindow {
  start: number;
  end: number;
}

export interface QuietHours {
  /** The daily window, or null for none. */
  daily: DailyWindow | null;
  /** True when Saturday and Sunday are quiet from midnight to midnight. */
  weekends: boolean;
}

const WINDOW = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/;

/** `18:00-07:00`, two 24-hour times, as a window; undefined for anything else, a window that starts and ends at once included. */
export function parseDailyWindow(raw: string): DailyWindow | undefined {
  const match = WINDOW.exec(raw);
  if (match === null) return undefined;
  const start = Number(match[1]) * 60 + Number(match[2]);
  const end = Number(match[3]) * 60 + Number(match[4]);
  return start === end ? undefined : { start, end };
}

const hhmm = (minutes: number): string => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** The window as NOTIFY_QUIET_HOURS writes it: `18:00-07:00`. */
export const dailyWindowText = ({ start, end }: DailyWindow): string => `${hhmm(start)}-${hhmm(end)}`;

/** The end of a quiet window the instant falls inside, the latest when two overlap; null when it is inside none. */
function windowEnd(at: Date, { daily, weekends }: QuietHours, timeZone: string): Date | null {
  const wall = wallClock(at, timeZone);
  const date = { year: wall.year, month: wall.month, day: wall.day };
  const ends: Date[] = [];
  const weekday = weekdayOf(date);
  if (weekends && (weekday === 6 || weekday === 0)) {
    // Monday's midnight: two days on from a Saturday, one from a Sunday.
    ends.push(instantAfter({ ...date, day: date.day + (weekday === 6 ? 2 : 1), hour: 0, minute: 0, second: 0 }, at, timeZone));
  }
  if (daily !== null) {
    const minute = wall.hour * 60 + wall.minute;
    const { start, end } = daily;
    const overnight = end < start;
    const inside = overnight ? minute >= start || minute < end : minute >= start && minute < end;
    if (inside) {
      // Before midnight in a window that runs past it, the window ends tomorrow.
      const day = date.day + (overnight && minute >= start ? 1 : 0);
      ends.push(instantAfter({ ...date, day, hour: Math.floor(end / 60), minute: end % 60, second: 0 }, at, timeZone));
    }
  }
  const later = ends.filter((end) => end.getTime() > at.getTime());
  return later.length === 0 ? null : new Date(Math.max(...later.map((end) => end.getTime())));
}

/**
 * When quiet hours end, if the instant falls inside them; null when it does not. Windows that
 * meet are followed into each other, so a Friday at 23:00 with weekends quiet is held until
 * Monday at the daily window's end, not until Saturday's midnight.
 */
export function quietUntil(at: Date, quiet: QuietHours, timeZone: string): Date | null {
  let until = at;
  // A week of windows meeting end to end at most: the weekend and the nights either side of it.
  for (let i = 0; i < 16; i++) {
    const end = windowEnd(until, quiet, timeZone);
    if (end === null) break;
    until = end;
  }
  return until.getTime() === at.getTime() ? null : until;
}
