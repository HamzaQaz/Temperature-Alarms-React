import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bucketReadings, bucketWidth, extremes } from './chartBuckets.ts';

const DAY = 24 * 3_600_000;
const MIDNIGHT = Date.parse('2026-10-04T05:00:00Z');
const at = (minutes: number, seconds = 0) => new Date(MIDNIGHT + minutes * 60_000 + seconds * 1000).toISOString();

describe('bucketWidth', () => {
  it('uses five-minute buckets for a whole day and narrower ones for a short span', () => {
    assert.equal(bucketWidth(DAY), 5 * 60_000);
    assert.equal(bucketWidth(3_600_000), 60_000);
    assert.equal(bucketWidth(10 * DAY), 3_600_000);
  });
});

describe('bucketReadings', () => {
  it('draws the whole-degree flicker as its mean, at the middle of each bucket', () => {
    const readings = [0, 30, 60, 90, 120, 150].map((s, i) => ({ tempF: i % 2 ? 72 : 71, humidity: 40, recordedAt: at(0, s) }));
    const points = bucketReadings(readings, MIDNIGHT, DAY);
    assert.equal(points.length, 1);
    assert.deepEqual(points[0], { at: MIDNIGHT + 150_000, from: MIDNIGHT, to: MIDNIGHT + 300_000, tempF: 71.5, humidity: 40, count: 6 });
  });

  it('leaves empty buckets out and averages humidity only over Readings that carry it', () => {
    const points = bucketReadings(
      [
        { tempF: 70, humidity: null, recordedAt: at(1) },
        { tempF: 70, humidity: 50, recordedAt: at(2) },
        { tempF: 80, humidity: null, recordedAt: at(61) },
      ],
      MIDNIGHT,
      DAY,
    );
    assert.deepEqual(
      points.map((p) => [p.from - MIDNIGHT, p.tempF, p.humidity, p.count]),
      [
        [0, 70, 50, 2],
        [60 * 60_000, 80, null, 1],
      ],
    );
  });
});

describe('extremes', () => {
  it('keeps a spike the mean would hide', () => {
    const readings = [70, 70, 95, 70].map((tempF, i) => ({ tempF, humidity: null, recordedAt: at(0, i * 30) }));
    assert.equal(bucketReadings(readings, MIDNIGHT, DAY)[0].tempF, 76.3);
    assert.deepEqual(extremes(readings, (r) => r.tempF), { low: { at: MIDNIGHT, value: 70 }, high: { at: MIDNIGHT + 60_000, value: 95 } });
    assert.equal(extremes(readings, (r) => r.humidity), null);
  });
});
