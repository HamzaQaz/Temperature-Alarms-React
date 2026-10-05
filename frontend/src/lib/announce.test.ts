import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createAnnouncer, combineAnnouncements, deviceChanges, type AnnouncedDevice } from './announce.ts';

const device = (id: number, conditions: AnnouncedDevice['conditions'], online = true): AnnouncedDevice => ({
  id,
  closet: `IDF ${id}`,
  campus: { name: 'Central High School' },
  online,
  conditions,
});
const hot = (level: 'warning' | 'critical') => ({ name: 'Hot', level }) as const;

describe('what a screen reader hears from the dashboard', () => {
  it('says nothing about a Reading that leaves every card at the same level', () => {
    const before = [device(1, []), device(2, [hot('warning')])];
    const after = [device(1, []), device(2, [hot('warning')])];
    assert.deepEqual(deviceChanges(before, after), []);
  });

  it('names the closet, the Campus and the new worst Condition when a card rises or falls', () => {
    const changes = deviceChanges([device(1, [hot('warning')])], [device(1, [hot('critical'), { name: 'Dry', level: 'warning' }])]);
    assert.deepEqual(changes, [{ key: '1', text: 'IDF 1, Central High School: Hot critical' }]);
    assert.equal(deviceChanges([device(1, [hot('critical')])], [device(1, [hot('warning')])])[0].text, 'IDF 1, Central High School: Hot warning');
  });

  it('says when a closet is back in range, goes Offline, and comes back', () => {
    assert.equal(deviceChanges([device(1, [hot('warning')])], [device(1, [])])[0].text, 'IDF 1, Central High School: back in range');
    assert.equal(
      deviceChanges([device(1, [])], [device(1, [{ name: 'Offline', level: 'warning' }], false)])[0].text,
      'IDF 1, Central High School: Offline',
    );
    assert.equal(deviceChanges([device(1, [{ name: 'Offline', level: 'warning' }], false)], [device(1, [])])[0].text, 'IDF 1, Central High School: back online');
  });

  it('ignores cards that joined or left (a Campus filter, a first load)', () => {
    assert.deepEqual(deviceChanges([], [device(1, [hot('critical')])]), []);
    assert.deepEqual(deviceChanges([device(1, [hot('critical')])], [device(2, [])]), []);
  });
});

describe('combining what is waiting into one announcement', () => {
  it('keeps only the latest word on each closet', () => {
    assert.equal(
      combineAnnouncements([
        { key: '1', text: 'IDF 1: Hot warning' },
        { key: '1', text: 'IDF 1: Hot critical' },
      ]),
      'IDF 1: Hot critical.',
    );
  });

  it('names up to three and counts the rest', () => {
    const five = [1, 2, 3, 4, 5].map((n) => ({ key: String(n), text: `IDF ${n}: Hot warning` }));
    assert.equal(combineAnnouncements(five.slice(0, 2)), 'IDF 1: Hot warning. IDF 2: Hot warning.');
    assert.equal(combineAnnouncements(five), 'IDF 1: Hot warning. IDF 2: Hot warning. IDF 3: Hot warning. And 2 more changed.');
    assert.equal(combineAnnouncements(five.slice(0, 4)), 'IDF 1: Hot warning. IDF 2: Hot warning. IDF 3: Hot warning. And 1 more changed.');
  });
});

describe('the announcer', () => {
  function harness(gapMs = 10_000) {
    let clock = 0;
    const said: string[] = [];
    let pending: { at: number; fn: () => void } | null = null;
    const announcer = createAnnouncer({
      gapMs,
      now: () => clock,
      say: (text) => said.push(text),
      setTimer: (fn, ms) => {
        pending = { at: clock + ms, fn };
        return 1;
      },
      clearTimer: () => {
        pending = null;
      },
    });
    const advance = (ms: number) => {
      clock += ms;
      if (pending && pending.at <= clock) {
        const { fn } = pending;
        pending = null;
        fn();
      }
    };
    return { announcer, said, advance };
  }

  it('speaks the first change after a quiet spell at once', () => {
    const { announcer, said } = harness();
    announcer.push({ key: '1', text: 'IDF 1: Hot warning' });
    assert.deepEqual(said, ['IDF 1: Hot warning.']);
  });

  it('holds a burst after it and speaks it once, together, when the gap is up', () => {
    const { announcer, said, advance } = harness();
    announcer.push({ key: '1', text: 'IDF 1: Hot warning' });
    advance(2_000);
    announcer.push({ key: '2', text: 'IDF 2: Dry warning' });
    advance(1_000);
    announcer.push({ key: '3', text: 'IDF 3: Cold warning' });
    assert.equal(said.length, 1);
    advance(7_000);
    assert.deepEqual(said, ['IDF 1: Hot warning.', 'IDF 2: Dry warning. IDF 3: Cold warning.']);
  });

  it('never speaks more often than the gap, however busy the stream', () => {
    const { announcer, said, advance } = harness();
    for (let s = 0; s < 120; s++) {
      announcer.push({ key: String(s % 24), text: `IDF ${s % 24}: Hot warning` });
      advance(1_000);
    }
    assert.ok(said.length <= 13, `spoke ${said.length} times in two minutes`);
  });

  it('stops when disposed', () => {
    const { announcer, said, advance } = harness();
    announcer.push({ key: '1', text: 'a' });
    announcer.push({ key: '2', text: 'b' });
    announcer.dispose();
    advance(20_000);
    assert.equal(said.length, 1);
  });
});
