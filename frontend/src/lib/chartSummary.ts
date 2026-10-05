/**
 * The History chart in words, for anyone who cannot see it: each series' low and high with when
 * they happened (the dots the chart marks), and the span and bucket the lines are drawn from.
 * The Readings table under the chart holds every value; this is the shape of the day at a glance.
 */
import { bucketWidth, extremes, type ChartReading } from './chartBuckets.ts';
import { formatTime } from './localDate.ts';

function series(name: string, readings: ChartReading[], pick: (r: ChartReading) => number | null, unit: string): string | null {
  const range = extremes(readings, pick);
  if (range === null) return null;
  const { low, high } = range;
  if (low.value === high.value) return `${name} steady at ${low.value}${unit}.`;
  return `${name} from a low of ${low.value}${unit} at ${formatTime(low.at)} to a high of ${high.value}${unit} at ${formatTime(high.at)}.`;
}

export function describeDay(readings: ChartReading[]): string {
  if (readings.length === 0) return 'No Readings.';
  const first = readings[0].recordedAt;
  const last = readings[readings.length - 1].recordedAt;
  const minutes = bucketWidth(Date.parse(last) - Date.parse(first)) / 60_000;
  const bucket = minutes >= 60 ? `${minutes / 60}-hour` : `${minutes}-minute`;
  const count = readings.length === 1 ? '1 Reading' : `${readings.length.toLocaleString()} Readings`;
  return [
    series('Temperature', readings, (r) => r.tempF, '°F'),
    series('Humidity', readings, (r) => r.humidity, '%') ?? 'No humidity in these Readings.',
    `${count}, ${formatTime(first)} to ${formatTime(last)}, drawn as ${bucket} means.`,
  ].join(' ');
}
