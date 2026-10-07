import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatHeap, formatSignal, formatUptime } from './deviceInfo.ts';

describe('device info', () => {
  it('names the signal strength', () => {
    assert.equal(formatSignal(-55), '-55 dBm, strong');
    assert.equal(formatSignal(-65), '-65 dBm, good');
    assert.equal(formatSignal(-72), '-72 dBm, fair');
    assert.equal(formatSignal(-82), '-82 dBm, weak');
    assert.equal(formatSignal(null), '—');
  });
  it('shows uptime in its two largest units', () => {
    assert.equal(formatUptime(45), '45 s');
    assert.equal(formatUptime(300), '5 min');
    assert.equal(formatUptime(7500), '2 h 5 min');
    assert.equal(formatUptime(3 * 86400 + 4 * 3600 + 59), '3 d 4 h');
    assert.equal(formatUptime(null), '—');
  });
  it('shows free memory in KB', () => {
    assert.equal(formatHeap(21450), '20.9 KB');
    assert.equal(formatHeap(null), '—');
  });
});
