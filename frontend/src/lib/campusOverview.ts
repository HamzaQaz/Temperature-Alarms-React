/**
 * The Campuses page's arithmetic: where each day's column sits on the small 7-day chart, what
 * the chart says to a screen reader, and how "since last incident" reads. Every number comes
 * from the overview the server sent; nothing here decides a Condition, a level, or a threshold.
 */
import { formatDayShort, formatTime, toDateString } from './localDate.ts';
import type { CampusOverview, OverviewDay } from '../types.ts';

/** The chart's plot: seven columns 18px wide, 8px apart, 44px tall, with room under them for the day letters. */
export const CHART = { column: 18, gap: 8, plot: 44, labels: 18 } as const;
export const CHART_WIDTH = 7 * CHART.column + 6 * CHART.gap;

/** A Reading's number as recorded: whole numbers stay whole, anything else to one decimal. */
export const figure = (value: number): string => (Number.isInteger(value) ? String(value) : value.toFixed(1));

export interface ChartColumn {
  day: OverviewDay;
  x: number;
  /** Top of the column; null on a day with no Readings, which draws no column. */
  y: number | null;
  height: number;
}

export interface ChartLayout {
  columns: ChartColumn[];
  /** Where the threshold line crosses the plot. */
  lineY: number;
}

/**
 * The columns and the threshold line on one scale. The scale runs from a little under the
 * lowest of the highs (or the line) to a little over the highest, so a few degrees either side
 * of the line still reads as a difference; every Campus has its own scale, and its own label.
 */
export function chartLayout(days: OverviewDay[], thresholdF: number): ChartLayout {
  const values = days.flatMap((d) => (d.maxTempF === null ? [] : [d.maxTempF]));
  const low = Math.floor(Math.min(thresholdF, ...values)) - 8;
  const high = Math.ceil(Math.max(thresholdF, ...values)) + 2;
  const y = (value: number): number => CHART.plot - ((value - low) / (high - low)) * CHART.plot;
  return {
    columns: days.map((day, i) => {
      const top = day.maxTempF === null ? null : y(day.maxTempF);
      return { day, x: i * (CHART.column + CHART.gap), y: top, height: top === null ? 0 : CHART.plot - top };
    }),
    lineY: y(thresholdF),
  };
}

const narrowDay = new Intl.DateTimeFormat(undefined, { weekday: 'narrow' });
const shortWeekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const atNoon = (date: string): Date => {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
};

/** "M", the letter under a column. */
export const dayLetter = (date: string): string => narrowDay.format(atNoon(date));

/** "Mon", or "Today" for the day still going. */
export const dayName = (day: OverviewDay): string => (day.partial ? 'Today' : shortWeekday.format(atNoon(day.date)));

/** The chart in words: every day's high, the line, and the days an incident touched. */
export function chartLabel(days: OverviewDay[], thresholdF: number): string {
  const highs = days.map((d) => `${dayName(d)} ${d.maxTempF === null ? 'no Readings' : `${figure(d.maxTempF)}°F${d.partial ? ' so far' : ''}`}`);
  const flagged = days.filter((d) => d.incident).map(dayName);
  const incidents = flagged.length === 0 ? 'No incident in the 7 days.' : `An incident on ${flagged.join(', ')}.`;
  return `Daily high: ${highs.join(', ')}. Hot warning line at ${figure(thresholdF)}°F. ${incidents}`;
}

/** The week's highest column, and the last day it was reached; null with no Readings all week. */
export function weekPeak(days: OverviewDay[]): { value: number; day: OverviewDay } | null {
  let peak: { value: number; day: OverviewDay } | null = null;
  for (const day of days) {
    if (day.maxTempF !== null && (peak === null || day.maxTempF >= peak.value)) peak = { value: day.maxTempF, day };
  }
  return peak;
}

const DAY_MS = 86_400_000;

/** A calm gap in whole units: "35 min", "5 h", "12 days". */
export function formatGap(milliseconds: number): string {
  const minutes = Math.max(0, Math.floor(milliseconds / 60_000));
  if (minutes < 1) return 'Under 1 min';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(milliseconds / DAY_MS);
  return days === 1 ? '1 day' : `${days} days`;
}

/** "2:05 PM" today, "Thu, Oct 1, 2:05 PM" before. */
export function formatWhen(iso: string, now: number): string {
  const day = toDateString(new Date(iso));
  return day === toDateString(new Date(now)) ? formatTime(iso) : `${formatDayShort(day)}, ${formatTime(iso)}`;
}

export interface SinceLast {
  /** The figure, large: "Ongoing", "3 days", "None in 90 days". */
  value: string;
  /** The line under it. */
  note: string;
  ongoing: boolean;
  /** The local day the Incidents page should open on: the end, or today while one is open. Null with none to show. */
  date: string | null;
}

/** How long a Campus has gone without an incident, as the server reported its last one. */
export function sinceLast(last: CampusOverview['lastIncident'], now: number, retentionDays: number): SinceLast {
  if (last === null) return { value: `None in ${retentionDays} days`, note: 'As far back as Readings go', ongoing: false, date: null };
  if (last.ongoing) return { value: 'Ongoing', note: `Since ${formatWhen(last.start, now)}`, ongoing: true, date: toDateString(new Date(now)) };
  return { value: formatGap(now - new Date(last.end).getTime()), note: `Ended ${formatWhen(last.end, now)}`, ongoing: false, date: toDateString(new Date(last.end)) };
}

/** Everything a row shows that can change while the page is open; a change in it takes the Reading-landed wash. */
export const rowSignature = (campus: CampusOverview): string =>
  JSON.stringify([campus.now, campus.worst?.id, campus.worst?.latestReading, campus.worst?.level, campus.days.map((d) => [d.maxTempF, d.incident]), campus.lastIncident]);

/** "Oak Hollow", "Oak Hollow and Harbor View", "A, B, and C". */
export function listNames(names: string[]): string {
  if (names.length <= 2) return names.join(' and ');
  return `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`;
}
