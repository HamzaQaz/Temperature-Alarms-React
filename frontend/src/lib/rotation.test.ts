import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rotationSummary } from './rotation.ts';
import type { Device, DeviceRotation } from '../types.ts';

const device = (hostname: string): Device => ({ id: 1, hostname, closet: 'IDF 1', campus: { id: 1, name: 'Central', shortcode: 'CHS' } });
const at = (iso: string) => `at ${iso.slice(11, 16)}`;
const rotation = (previous: string[], unheard: string[], active = true): DeviceRotation => ({
  active,
  since: '2026-10-06T12:00:00.000Z',
  previous: previous.map(device),
  unheard: unheard.map(device),
});

describe('rotationSummary', () => {
  it('says nothing when no rotation is under way', () => {
    assert.equal(rotationSummary(rotation([], [], false), at), null);
  });

  it('names every Device still on the previous token, and those not heard since the server started', () => {
    assert.deepEqual(rotationSummary(rotation(['ESP_00000A', 'ESP_00000B'], ['ESP_00000C']), at), {
      previous: '2 Devices still report with the previous Device token: ESP_00000A, ESP_00000B.',
      unheard: '1 not heard since at 12:00, so not known to have the new token: ESP_00000C.',
      done: false,
    });
    assert.equal(rotationSummary(rotation(['ESP_00000A'], []), at)?.previous, '1 Device still reports with the previous Device token: ESP_00000A.');
  });

  it('is done once both lists are empty', () => {
    assert.deepEqual(rotationSummary(rotation([], []), at), { previous: 'No Device reports with the previous Device token.', unheard: null, done: true });
    assert.equal(rotationSummary(rotation([], ['ESP_00000C']), at)?.done, false);
  });
});
