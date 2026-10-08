import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanProgress, firmwareSummary, holdSentence, rolloutNote } from './firmware.ts';
import type { FirmwareHold, FirmwareRelease, FirmwareStatus, StagedDevice } from '../types.ts';

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
const release = (only: string[] | null = null, more: Partial<FirmwareRelease> = {}): FirmwareRelease => ({
  version: 3,
  size: 431956,
  md5: 'x',
  publishedAt: '2026-10-06T12:00:00.000Z',
  only,
  staged: only,
  stage: only === null ? 'all' : 'named',
  widenedAt: null,
  hold: null,
  ...more,
});
const hold = (more: Partial<FirmwareHold> = {}): FirmwareHold => ({ at: '2026-10-07T14:05:00.000Z', hostname: 'ESP_00000A', reason: 'Offline', detail: null, ...more });
const staged = (hostname: string, cleanReports: number, ready = cleanReports >= 10): StagedDevice => ({
  hostname,
  id: 1,
  firmwareVersion: 3,
  lastReportAt: '2026-10-07T14:00:00.000Z',
  conditions: [],
  cleanReports,
  ready,
});

describe('firmwareSummary', () => {
  it('says when nothing is published, and still lists Devices that never checked', () => {
    assert.deepEqual(firmwareSummary({ release: null, rollout: null, devices: [device('ESP_00000A', 2), device('ESP_00000B', null, false)] }, day), {
      release: 'No firmware is published; boards keep what they run.',
      progress: null,
      behind: [],
      neverChecked: ['ESP_00000B'],
    });
  });

  it('counts the Devices on the release, and names those behind', () => {
    const summary = firmwareSummary(
      { release: release(), rollout: null, devices: [device('ESP_00000A', 3), device('ESP_00000B', 4), device('ESP_00000C', 2), device('ESP_00000D', null, false)] },
      day,
    );
    assert.equal(summary.release, 'Version 3 is published to every Device, since 2026-10-06.');
    assert.equal(summary.progress, '2 of 4 Devices run it.');
    assert.deepEqual(summary.behind, ['ESP_00000C']);
    assert.deepEqual(summary.neverChecked, ['ESP_00000D']);
  });

  it('counts only the named Devices for a staged release', () => {
    const summary = firmwareSummary({ release: release(['ESP_00000A']), rollout: null, devices: [device('ESP_00000A', 2), device('ESP_00000B', 2)] }, day);
    assert.equal(summary.release, 'Version 3 is published to ESP_00000A, since 2026-10-06.');
    assert.equal(summary.progress, '0 of 1 Device runs it.');
    assert.deepEqual(summary.behind, ['ESP_00000A']);
  });

  it('says when a staged release was widened, and who had it first', () => {
    const widened = release(null, { staged: ['ESP_00000A'], widenedAt: '2026-10-07T09:00:00.000Z' });
    const summary = firmwareSummary({ release: widened, rollout: null, devices: [device('ESP_00000A', 3), device('ESP_00000B', 2)] }, day);
    assert.equal(summary.release, 'Version 3 is published to every Device, since 2026-10-07; ESP_00000A had it first, from 2026-10-06.');
    assert.equal(summary.progress, '1 of 2 Devices run it.');
  });

  it('says a held release is offered to no one', () => {
    const held = release(['ESP_00000A', 'ESP_00000B'], { hold: hold() });
    const summary = firmwareSummary({ release: held, rollout: null, devices: [device('ESP_00000A', 3), device('ESP_00000B', 2)] }, day);
    assert.equal(summary.release, 'Version 3 is held: it is offered to no Device. It went to ESP_00000A, ESP_00000B first, from 2026-10-06.');
    assert.equal(summary.progress, '1 of 2 Devices run it.');
    assert.deepEqual(summary.behind, ['ESP_00000B']);
  });
});

describe('holdSentence', () => {
  it('names the Device and what it did, with when', () => {
    assert.equal(holdSentence(hold(), day), 'Held on 2026-10-07: ESP_00000A went Offline after taking it.');
    assert.equal(holdSentence(hold({ reason: 'Sensor fault' }), day), 'Held on 2026-10-07: ESP_00000A went into Sensor fault after taking it.');
    assert.equal(
      holdSentence(hold({ reason: 'update failed', detail: 'failed, Bad signature' }), day),
      'Held on 2026-10-07: ESP_00000A failed to install it (failed, Bad signature).',
    );
  });
});

describe('rolloutNote and cleanProgress', () => {
  it('says what "Release to all" waits on, naming the Devices not there yet', () => {
    const waiting = { cleanReportsToWiden: 10, ready: false, devices: [staged('ESP_00000A', 10), staged('ESP_00000B', 4)] };
    assert.equal(rolloutNote(waiting, 3), 'Offered once every named Device has sent 10 clean Readings in a row on version 3. Not yet: ESP_00000B.');
    const ready = { cleanReportsToWiden: 10, ready: true, devices: [staged('ESP_00000A', 10), staged('ESP_00000B', 14)] };
    assert.equal(rolloutNote(ready, 3), 'Every named Device has sent 10 clean Readings in a row on version 3.');
  });

  it('counts clean Readings up to the number needed', () => {
    assert.equal(cleanProgress(staged('ESP_00000A', 4), 10), '4 of 10');
    assert.equal(cleanProgress(staged('ESP_00000A', 37), 10), '10 of 10');
  });
});
