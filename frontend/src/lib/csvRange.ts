/**
 * The days History's CSV download covers: YYYY-MM-DD in this browser's zone, both ends included,
 * at most the Retention window. The server refuses a longer range; this only keeps the links from
 * asking for one.
 */
import { addDays, isDateString } from './localDate.ts';

const DAY_MS = 86_400_000;

/** Days from the first to the last, both counted: 1 for a single day. */
export const daysSpanned = (from: string, to: string): number => (Date.parse(to) - Date.parse(from)) / DAY_MS + 1;

/** The first day a range ending today can start on: Readings before it have been deleted. */
export const earliestDay = (today: string, retentionDays: number): string => addDays(today, -(retentionDays - 1));

/** Why the range cannot be downloaded, in a sentence, or null when it can. */
export function rangeProblem(from: string, to: string, retentionDays: number): string | null {
  if (!isDateString(from) || !isDateString(to)) return 'Pick a first and a last day.';
  if (from > to) return 'The first day must be on or before the last.';
  if (daysSpanned(from, to) > retentionDays) return `At most ${retentionDays} days at a time: Readings are kept that long.`;
  return null;
}

/** A local midnight, as a Date. */
function midnight(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** The instants the range covers, for the incidents download: the first day's midnight, inclusive, to the one after the last, exclusive. */
export const rangeBounds = (from: string, to: string): { from: Date; to: Date } => ({ from: midnight(from), to: midnight(addDays(to, 1)) });
