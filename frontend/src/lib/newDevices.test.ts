import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { boardsToAnnounce, promptKey } from './newDevices.ts';
import type { PendingDevice } from '../types.ts';

const board = (hostname: string, ignored = false, firstSeen = '2026-10-06T22:00:00.000Z'): PendingDevice => ({
  hostname,
  firstSeen,
  lastSeen: '2026-10-06T22:05:00.000Z',
  reports: 3,
  lastReading: { tempF: 84, humidity: 44 },
  address: '192.168.1.143',
  ignored,
});

describe('boardsToAnnounce', () => {
  it('announces new boards, but not ignored ones or ones already waved off', () => {
    const waiting = [board('ESP_00000A'), board('ESP_00000B', true), board('ESP_00000C')];
    assert.deepEqual(boardsToAnnounce(waiting, new Set([promptKey(waiting[2])])).map((b) => b.hostname), ['ESP_00000A']);
  });

  it('announces a board again once it was forgotten and came back', () => {
    const before = board('ESP_00000A');
    const back = board('ESP_00000A', false, '2026-10-07T08:00:00.000Z');
    assert.deepEqual(boardsToAnnounce([back], new Set([promptKey(before)])).map((b) => b.hostname), ['ESP_00000A']);
  });
});
