import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { acknowledgedAgo, acknowledgerError, applyIncident, replaceIncident } from './acknowledgement.ts';
import type { Incident, OpenIncident } from '../types.ts';

const campus = { id: 1, name: 'Central High School', shortcode: 'CHS' };

const incident = (overrides: Partial<Incident> = {}): Incident => ({
  id: 7,
  device: { id: 12, hostname: 'ESP_A1B2C3', closet: 'IDF 2', campus },
  condition: 'Hot',
  level: 'warning',
  start: '2026-10-07T02:00:00.000Z',
  end: null,
  peak: { value: 85, tempF: 85, humidity: 40, recordedAt: '2026-10-07T02:00:00.000Z' },
  segments: [{ level: 'warning', start: '2026-10-07T02:00:00.000Z', end: null }],
  acknowledgement: null,
  ...overrides,
});

const open = (overrides: Partial<OpenIncident> = {}): OpenIncident => ({
  id: 7,
  condition: 'Hot',
  level: 'warning',
  start: '2026-10-07T02:00:00.000Z',
  acknowledgement: null,
  ...overrides,
});

const card = (id: number, openIncidents: OpenIncident[] = []) => ({ id, hostname: `ESP_${id}`, openIncidents });

describe('applyIncident', () => {
  it('puts an acknowledgement on the card it belongs to and leaves the others alone', () => {
    const acknowledgement = { by: 'Sam', at: '2026-10-07T02:10:00.000Z' };
    const devices = [card(12, [open()]), card(13)];
    const next = applyIncident(devices, incident({ acknowledgement }));
    assert.deepEqual(next[0].openIncidents, [open({ acknowledgement })]);
    assert.equal(next[1], devices[1]);
    assert.equal(next[0].hostname, 'ESP_12', 'the rest of the card is kept');
  });

  it('adds a new open incident, oldest first, and takes a new level in place', () => {
    const older = open({ id: 3, condition: 'Dry', start: '2026-10-07T01:00:00.000Z' });
    const opened = applyIncident([card(12, [older])], incident());
    assert.deepEqual(opened[0].openIncidents.map((i) => i.id), [3, 7]);
    const worse = applyIncident(opened, incident({ level: 'critical' }));
    assert.deepEqual(worse[0].openIncidents.map((i) => [i.id, i.level]), [[3, 'warning'], [7, 'critical']]);
  });

  it('drops a closed incident, and a close it no longer holds changes nothing', () => {
    const devices = [card(12, [open()])];
    const closed = applyIncident(devices, incident({ end: '2026-10-07T03:00:00.000Z' }));
    assert.deepEqual(closed[0].openIncidents, []);
    assert.equal(applyIncident(closed, incident({ end: '2026-10-07T03:00:00.000Z' })), closed, 'replaying is safe');
  });

  it('returns the same list for a Device with no card', () => {
    const devices = [card(13)];
    assert.equal(applyIncident(devices, incident()), devices);
  });

  it('never brings back a closed incident from an acknowledgement read just before the close', () => {
    const acknowledgement = { by: 'Sam', at: '2026-10-07T02:10:00.000Z' };
    const closed = applyIncident([card(12, [open()])], incident({ end: '2026-10-07T03:00:00.000Z' }));
    const late = incident({ acknowledgement });
    assert.equal(applyIncident(closed, late, { opens: false }), closed, 'the card no longer holds it, so nothing changes');
    const held = applyIncident([card(12, [open()])], late, { opens: false });
    assert.deepEqual(held[0].openIncidents, [open({ acknowledgement })], 'one it holds still takes the acknowledgement');
  });
});

describe('replaceIncident', () => {
  it('replaces the row, but keeps one that has ended against a payload still open', () => {
    const ended = incident({ end: '2026-10-07T03:00:00.000Z', acknowledgement: { by: 'Sam', at: '2026-10-07T02:10:00.000Z' } });
    const other = incident({ id: 8 });
    assert.deepEqual(replaceIncident([incident(), other], ended), [ended, other]);
    const stale = incident({ acknowledgement: ended.acknowledgement });
    assert.deepEqual(replaceIncident([ended, other], stale), [ended, other], 'an incident never reopens');
    assert.deepEqual(replaceIncident([incident(), other], stale), [stale, other]);
  });
});

describe('acknowledgedAgo', () => {
  it('says how long ago, never in the future', () => {
    const acknowledgement = { by: 'Sam', at: '2026-10-07T02:00:00.000Z' };
    const at = Date.parse(acknowledgement.at);
    assert.equal(acknowledgedAgo(acknowledgement, at + 10 * 60_000), '10 min ago');
    assert.equal(acknowledgedAgo(acknowledgement, at + 20_000), 'under 1 min ago');
    assert.equal(acknowledgedAgo(acknowledgement, at - 5_000), 'under 1 min ago', 'a browser clock behind the server');
  });
});

describe('acknowledgerError', () => {
  it('takes 1 to 60 characters, trimmed, with no control characters, as the server does', () => {
    assert.equal(acknowledgerError(' Sam, on the way '), null);
    assert.equal(acknowledgerError('é'.repeat(60)), null);
    assert.match(acknowledgerError('   ') ?? '', /Give your name/);
    assert.match(acknowledgerError('x'.repeat(61)) ?? '', /60 characters/);
    assert.match(acknowledgerError('Sam\nBcc') ?? '', /control characters/);
    assert.match(acknowledgerError('Sam\u202Ex') ?? '', /control characters/);
    assert.match(acknowledgerError('Sam\u2028x') ?? '', /control characters/);
    assert.match(acknowledgerError('Sam\u2029x') ?? '', /control characters/);
  });
});
