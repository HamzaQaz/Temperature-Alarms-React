import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { firmwareSummary, holdSentence, nextCheckText, progressDetail, rolloutNote, STEP_TEXT } from './firmware.ts';
import type { DeviceProgress, FirmwareHold, FirmwareRelease, FirmwareStatus, StagedDevice } from '../types.ts';

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
  offeredTo: only === null ? 'Offered to every Device (4)' : `Offered to ${only.join(', ')}`,
  ...more,
});
const line = (hostname: string, more: Partial<DeviceProgress> = {}): DeviceProgress => ({
  hostname,
  device: { id: 1, campus: { name: 'Central', shortcode: 'CHS' }, closet: 'IDF 2' },
  firmwareVersion: 4,
  step: 'waiting',
  nextCheck: null,
  sentAt: null,
  updateResult: null,
  lastReportAt: null,
  cleanReports: 0,
  conditions: [],
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
    assert.deepEqual(firmwareSummary({ release: null, progress: null, rollout: null, devices: [device('ESP_00000A', 2), device('ESP_00000B', null, false)] }, day), {
      release: 'No firmware is published; boards keep what they run.',
      progress: null,
      neverChecked: ['ESP_00000B'],
    });
  });

  it('says who the release is offered to, as the server put it, and counts the Devices on it', () => {
    const summary = firmwareSummary(
      {
        release: release(),
        progress: { cleanReportsToWiden: 10, devices: ['ESP_00000A', 'ESP_00000B', 'ESP_00000C', 'ESP_00000D'].map((h) => line(h)) },
        rollout: null,
        devices: [device('ESP_00000A', 3), device('ESP_00000B', 4), device('ESP_00000C', 2), device('ESP_00000D', null, false)],
      },
      day,
    );
    assert.equal(summary.release, 'Version 3 is published, since 2026-10-06. Offered to every Device (4).');
    assert.equal(summary.progress, '2 of 4 Devices run it.');
    assert.deepEqual(summary.neverChecked, [], 'its own line says so');
  });

  it('counts only the named Devices for a staged release, and lists the others that never checked', () => {
    const staged = release(['ESP_00000A'], { offeredTo: 'Offered to ESP_00000A (CHS IDF 1, running 2)' });
    const summary = firmwareSummary(
      { release: staged, progress: { cleanReportsToWiden: 10, devices: [line('ESP_00000A')] }, rollout: null, devices: [device('ESP_00000A', 2), device('ESP_00000B', null, false)] },
      day,
    );
    assert.equal(summary.release, 'Version 3 is published, since 2026-10-06. Offered to ESP_00000A (CHS IDF 1, running 2).');
    assert.equal(summary.progress, '0 of 1 Device runs it.');
    assert.deepEqual(summary.neverChecked, ['ESP_00000B']);
  });

  it('says when a staged release was widened, and who had it first', () => {
    const widened = release(null, { staged: ['ESP_00000A'], widenedAt: '2026-10-07T09:00:00.000Z' });
    const summary = firmwareSummary({ release: widened, progress: null, rollout: null, devices: [device('ESP_00000A', 3), device('ESP_00000B', 2)] }, day);
    assert.equal(summary.release, 'Version 3 is published to every Device, since 2026-10-07; ESP_00000A had it first, from 2026-10-06.');
    assert.equal(summary.progress, '1 of 2 Devices run it.');
  });

  it('says a held release is offered to no one', () => {
    const held = release(['ESP_00000A', 'ESP_00000B'], { hold: hold() });
    const summary = firmwareSummary({ release: held, progress: null, rollout: null, devices: [device('ESP_00000A', 3), device('ESP_00000B', 2)] }, day);
    assert.equal(summary.release, 'Version 3 is held: it is offered to no Device. It went to ESP_00000A, ESP_00000B first, from 2026-10-06.');
    assert.equal(summary.progress, '1 of 2 Devices run it.');
  });
});

describe('where each offered Device is', () => {
  const now = new Date('2026-10-07T23:40:00.000Z').getTime();
  const timeOf = (iso: string) => iso.slice(11, 16);
  const detail = (more: Partial<DeviceProgress>) => progressDetail(line('ESP_64533B', more), 10, now, timeOf);

  it('a waiting line says when to expect the next check: at its next Reading for a board that sends them, else hourly or at a restart', () => {
    assert.equal(detail({ step: 'waiting', nextCheck: { by: 'reading', at: '2026-10-07T23:40:30.000Z' } }), 'at its next Reading, by 23:40');
    assert.equal(detail({ step: 'waiting', nextCheck: { by: 'hourly', at: '2026-10-07T23:55:00.000Z' } }), 'by 23:55, or restart the board');
    assert.equal(detail({ step: 'waiting', nextCheck: { by: 'hourly', at: '2026-10-07T23:35:00.000Z' } }), 'due by 23:35; restart the board');
    assert.equal(nextCheckText({ by: 'hourly', at: null }, now, timeOf), 'restart the board');
  });

  it('then downloading, running and counting; or stuck, saying what is known', () => {
    assert.equal(detail({ step: 'downloading', sentAt: '2026-10-07T23:39:00.000Z' }), 'the server sent the image at 23:39');
    assert.equal(detail({ step: 'running', cleanReports: 4 }), '4 of 10 clean Readings');
    assert.equal(detail({ step: 'running', cleanReports: 31 }), '10 of 10 clean Readings');
    assert.equal(detail({ step: 'refused', updateResult: 'failed, Bad signature' }), 'failed, Bad signature');
    assert.equal(
      detail({ step: 'offline', lastReportAt: '2026-10-07T22:10:00.000Z', nextCheck: { by: 'hourly', at: '2026-10-07T23:55:00.000Z' } }),
      'last report at 22:10, next check by 23:55, or restart the board',
    );
    assert.equal(detail({ step: 'offline' }), 'it has never reported');
    assert.match(detail({ step: 'never-checked' }) ?? '', /USB/);
    assert.equal(detail({ step: 'held' }), null);
    assert.equal(STEP_TEXT.waiting, 'Waiting for its next check');
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

describe('rolloutNote', () => {
  it('says what "Release to all" waits on, naming the Devices not there yet', () => {
    const waiting = { cleanReportsToWiden: 10, ready: false, devices: [staged('ESP_00000A', 10), staged('ESP_00000B', 4)] };
    assert.equal(rolloutNote(waiting, 3), 'Offered once every named Device has sent 10 clean Readings in a row on version 3. Not yet: ESP_00000B.');
    const ready = { cleanReportsToWiden: 10, ready: true, devices: [staged('ESP_00000A', 10), staged('ESP_00000B', 14)] };
    assert.equal(rolloutNote(ready, 3), 'Every named Device has sent 10 clean Readings in a row on version 3.');
  });
});
