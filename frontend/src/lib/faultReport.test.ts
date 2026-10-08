import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyFault, formatStaleAge, hasSensorFault, type AgedDevice } from './faultReport.ts';
import type { FaultEvent } from '../types.ts';

const device = (hostname: string, overrides: Partial<AgedDevice> = {}): AgedDevice => ({
  hostname,
  online: true,
  conditions: [],
  lastReportAt: '2026-10-06T14:00:00.000Z',
  secondsSinceReading: 10,
  secondsSinceReport: 10,
  onFallbackNetwork: false,
  asOf: 1_000,
  ...overrides,
});

const fault = (overrides: Partial<FaultEvent> = {}): FaultEvent => ({
  type: 'fault',
  device: 'ESP_A1B2C3',
  fault: 'sensor',
  online: true,
  conditions: [{ name: 'Sensor fault', level: 'critical' }],
  lastReportAt: '2026-10-06T14:01:00.000Z',
  onFallbackNetwork: false,
  ...overrides,
});

describe('applyFault', () => {
  it('takes the server state and the last report, and keeps the last good Reading ageing', () => {
    const [card, other] = applyFault([device('ESP_A1B2C3'), device('ESP_D4E5F6')], fault(), 61_500);
    assert.deepEqual(card.conditions, [{ name: 'Sensor fault', level: 'critical' }]);
    assert.equal(card.online, true);
    assert.equal(card.lastReportAt, '2026-10-06T14:01:00.000Z');
    assert.equal(card.secondsSinceReport, 0);
    // 60.5 s on: the Reading is 70 s old, and the half second stays in the anchor.
    assert.equal(card.secondsSinceReading, 70);
    assert.equal(card.asOf, 61_000);
    assert.deepEqual(other, device('ESP_D4E5F6'));
  });

  it('takes the network the board reported from, so the card notes its fallback network at once, and drops the note when it is back', () => {
    const [onFallback] = applyFault([device('ESP_A1B2C3')], fault({ onFallbackNetwork: true }), 5_000);
    assert.equal(onFallback.onFallbackNetwork, true);
    const [back] = applyFault([onFallback], fault({ lastReportAt: '2026-10-06T14:02:00.000Z' }), 35_000);
    assert.equal(back.onFallbackNetwork, false);
  });

  it('does not wear the Reading age down over a run of fault reports', () => {
    let devices: AgedDevice[] = [device('ESP_A1B2C3')];
    for (let n = 1; n <= 30; n++) {
      devices = applyFault(devices, fault({ lastReportAt: `2026-10-06T14:${String(n).padStart(2, '0')}:00.000Z` }), 1_000 + n * 30_900);
    }
    // 30 reports 30.9 s apart: 927 s on, never 30 fractions short.
    assert.equal(devices[0].secondsSinceReading, 10 + 927);
  });

  it('leaves a card that knows a later report, a Device with no card, and one that never sent a Reading', () => {
    const later = [device('ESP_A1B2C3', { lastReportAt: '2026-10-06T14:05:00.000Z' })];
    assert.equal(applyFault(later, fault(), 5_000), later);
    const unknown = [device('ESP_D4E5F6')];
    assert.equal(applyFault(unknown, fault(), 5_000), unknown);
    const [fresh] = applyFault([device('ESP_A1B2C3', { lastReportAt: null, secondsSinceReading: null, secondsSinceReport: null })], fault(), 5_000);
    assert.equal(fresh.secondsSinceReading, null);
    assert.equal(fresh.secondsSinceReport, 0);
  });
});

describe('hasSensorFault', () => {
  it('is the server naming Sensor fault, at whatever level', () => {
    assert.equal(hasSensorFault([{ name: 'Sensor fault' }]), true);
    assert.equal(hasSensorFault([{ name: 'Offline' }, { name: 'Sensor fault' }]), true);
    assert.equal(hasSensorFault([{ name: 'Hot' }]), false);
    assert.equal(hasSensorFault([]), false);
  });
});

describe('formatStaleAge', () => {
  it('says how old the kept Reading is in minutes, then hours and minutes, then days', () => {
    assert.equal(formatStaleAge(45), 'under 1 min ago');
    assert.equal(formatStaleAge(14 * 60 + 59), '14 min ago');
    assert.equal(formatStaleAge(3600), '1 h ago');
    assert.equal(formatStaleAge(2 * 3600 + 5 * 60), '2 h 5 min ago');
    assert.equal(formatStaleAge(3 * 86400 + 600), '3 d ago');
  });
});
