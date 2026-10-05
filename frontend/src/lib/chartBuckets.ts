/**
 * The History chart's line, drawn from per-bucket means rather than every Reading. The DHT11
 * reports whole degrees and whole percent, so a closet sitting at 71.5 °F flickers between 71
 * and 72 on every Reading; drawn raw, a full day of that is a solid block, and a dashed line
 * through it breaks into hatching. The table and the day's tiles stay on the raw Readings; this
 * is only how the line is drawn. The day's extremes are kept separately (`extremes`), so a mean
 * never hides a spike that crossed a threshold.
 */

export interface ChartReading {
  tempF: number;
  humidity: number | null;
  recordedAt: string;
}

export interface ChartPoint {
  /** The middle of the bucket, in epoch ms. */
  at: number;
  /** The bucket's edges, in epoch ms, for the tooltip. */
  from: number;
  to: number;
  tempF: number;
  humidity: number | null;
  /** How many Readings the point stands for. */
  count: number;
}

export interface Extreme {
  at: number;
  value: number;
}

const MINUTE = 60_000;
/** Bucket widths a reader can say out loud: 1, 2, 5, 10, 15 or 30 minutes, or an hour. */
const STEPS = [1, 2, 5, 10, 15, 30, 60].map((m) => m * MINUTE);
/** About one point per 5 minutes across a whole day: smooth at chart width, still shows an hour's change. */
const TARGET_POINTS = 288;

/** The narrowest step that keeps `spanMs` to about TARGET_POINTS buckets. */
export function bucketWidth(spanMs: number): number {
  return STEPS.find((step) => spanMs / step <= TARGET_POINTS) ?? STEPS[STEPS.length - 1];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Readings grouped into buckets of a width chosen from `spanMs` (the span the Readings cover), aligned to
 * `originMs` (its midnight), each drawn at its middle with the mean to one decimal. Empty buckets
 * are left out, as raw Readings were. Humidity is averaged over the Readings that carry it.
 */
export function bucketReadings(readings: ChartReading[], originMs: number, spanMs: number): ChartPoint[] {
  const width = bucketWidth(spanMs);
  const points: ChartPoint[] = [];
  let current = null as { index: number; temp: number; hum: number; humCount: number; count: number } | null;
  const flush = () => {
    if (!current) return;
    const from = originMs + current.index * width;
    points.push({
      at: from + width / 2,
      from,
      to: from + width,
      tempF: round1(current.temp / current.count),
      humidity: current.humCount === 0 ? null : round1(current.hum / current.humCount),
      count: current.count,
    });
  };
  for (const reading of readings) {
    const index = Math.floor((Date.parse(reading.recordedAt) - originMs) / width);
    if (current?.index !== index) {
      flush();
      current = { index, temp: 0, hum: 0, humCount: 0, count: 0 };
    }
    current.temp += reading.tempF;
    current.count += 1;
    if (reading.humidity !== null) {
      current.hum += reading.humidity;
      current.humCount += 1;
    }
  }
  flush();
  return points;
}

/** The day's lowest and highest raw value, at the first time each was reached; null with no values. */
export function extremes(readings: ChartReading[], pick: (r: ChartReading) => number | null): { low: Extreme; high: Extreme } | null {
  let low: Extreme | null = null;
  let high: Extreme | null = null;
  for (const reading of readings) {
    const value = pick(reading);
    if (value === null) continue;
    const at = Date.parse(reading.recordedAt);
    if (low === null || value < low.value) low = { at, value };
    if (high === null || value > high.value) high = { at, value };
  }
  return low && high ? { low, high } : null;
}
