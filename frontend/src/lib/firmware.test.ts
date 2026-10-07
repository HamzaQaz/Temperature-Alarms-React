import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { firmwareSummary } from './firmware.ts';
import type { FirmwareStatus } from '../types.ts';

const device = (hostname: string, firmwareVersion: number | null, checked = true): FirmwareStatus['devices'][number] => ({
  id: 1,
  hostname,
  closet: 'IDF 1',
  campus: { id: 1, name: 'Central', shortcode: 'CHS' },
  firmwareVersion,
  checkedAt: checked ? '2026-10-06T12:00:00.000Z' : null,
  info: null,
});
const day = (iso: string) => iso.slice(0, 10);
const release = (only: string[] | null = null) => ({ version: 3, size: 431956, md5: 'x', publishedAt: '2026-10-06T12:00:00.000Z', only });

describe('firmwareSummary', () => {
  it('says when nothing is published, and still lists Devices that never checked', () => {
    assert.deepEqual(firmwareSummary({ release: null, devices: [device('ESP_00000A', 2), device('ESP_00000B', null, false)] }, day), {
      release: 'No firmware is published; boards keep what they run.',
      progress: null,
      behind: [],
      neverChecked: ['ESP_00000B'],
    });
  });

  it('counts the Devices on the release, and names those behind', () => {
    const summary = firmwareSummary(
      { release: release(), devices: [device('ESP_00000A', 3), device('ESP_00000B', 4), device('ESP_00000C', 2), device('ESP_00000D', null, false)] },
      day,
    );
    assert.equal(summary.release, 'Version 3 is published to every Device, since 2026-10-06.');
    assert.equal(summary.progress, '2 of 4 Devices run it.');
    assert.deepEqual(summary.behind, ['ESP_00000C']);
    assert.deepEqual(summary.neverChecked, ['ESP_00000D']);
  });

  it('counts only the named Devices for a staged release', () => {
    const summary = firmwareSummary({ release: release(['ESP_00000A']), devices: [device('ESP_00000A', 2), device('ESP_00000B', 2)] }, day);
    assert.equal(summary.release, 'Version 3 is published to ESP_00000A, since 2026-10-06.');
    assert.equal(summary.progress, '0 of 1 Device runs it.');
    assert.deepEqual(summary.behind, ['ESP_00000A']);
  });
});
