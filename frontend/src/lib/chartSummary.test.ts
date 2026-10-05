import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describeDay } from './chartSummary.ts';
import { formatTime } from './localDate.ts';

const MIDNIGHT = Date.parse('2026-10-04T05:00:00Z');
const at = (minutes: number) => new Date(MIDNIGHT + minutes * 60_000).toISOString();

describe("the History chart's text equivalent", () => {
  it('gives each series its low and high with when they happened, and the span the line covers', () => {
    const readings = [
      { tempF: 72, humidity: 41, recordedAt: at(0) },
      { tempF: 68, humidity: 47, recordedAt: at(240) },
      { tempF: 91, humidity: 30, recordedAt: at(870) },
      { tempF: 80, humidity: 35, recordedAt: at(1000) },
    ];
    assert.equal(
      describeDay(readings),
      `Temperature from a low of 68°F at ${formatTime(at(240))} to a high of 91°F at ${formatTime(at(870))}. ` +
        `Humidity from a low of 30% at ${formatTime(at(870))} to a high of 47% at ${formatTime(at(240))}. ` +
        `4 Readings, ${formatTime(at(0))} to ${formatTime(at(1000))}, drawn as 5-minute means.`,
    );
  });

  it('says a series held steady, and leaves out humidity a Device never sent', () => {
    const readings = [
      { tempF: 70, humidity: null, recordedAt: at(0) },
      { tempF: 70, humidity: null, recordedAt: at(1) },
    ];
    assert.equal(describeDay(readings), `Temperature steady at 70°F. No humidity in these Readings. 2 Readings, ${formatTime(at(0))} to ${formatTime(at(1))}, drawn as 1-minute means.`);
  });

  it('has nothing to describe on an empty day', () => {
    assert.equal(describeDay([]), 'No Readings.');
  });
});
