/**
 * What a screen reader is told as the live stream changes the page, and how often. A Reading
 * that leaves a card at the same level says nothing: with a district of Devices reporting every
 * Report interval, a live region that spoke every Reading would never stop. Only a change in a
 * card's worst Condition (or Online) is worth a word, and words that arrive together are spoken
 * together, at most once per gap. The server decides every Condition; this only compares them.
 */
import type { Condition } from '@/types';

/** One thing to say, keyed by what it is about, so a later word on the same closet replaces an earlier one. */
export interface Announcement {
  key: string;
  text: string;
}

/** What the dashboard knows about a Device that matters for an announcement. */
export interface AnnouncedDevice {
  id: number;
  closet: string;
  campus: { name: string };
  online: boolean;
  conditions: readonly Condition[];
}

const worstOf = (device: AnnouncedDevice): string => {
  const worst = device.conditions[0];
  return worst === undefined ? '' : `${worst.name} ${worst.level}`;
};

/**
 * The cards whose worst Condition, or Online, changed between two loads of the dashboard. A card
 * that joined or left (a Campus filter, the first load) is not a change, so it says nothing.
 */
export function deviceChanges(before: readonly AnnouncedDevice[], after: readonly AnnouncedDevice[]): Announcement[] {
  const previous = new Map(before.map((device) => [device.id, device]));
  const changes: Announcement[] = [];
  for (const device of after) {
    const was = previous.get(device.id);
    if (was === undefined) continue;
    const worst = worstOf(device);
    if (worst === worstOf(was) && device.online === was.online) continue;
    const backOnline = device.online && !was.online;
    const state = !device.online ? 'Offline' : backOnline ? (worst === '' ? 'back online' : `back online, ${worst}`) : worst === '' ? 'back in range' : worst;
    changes.push({ key: String(device.id), text: `${device.closet}, ${device.campus.name}: ${state}` });
  }
  return changes;
}

/** How many announcements one message names before it counts the rest. */
const NAMED = 3;

/** Everything waiting, as one message: the latest word on each thing, up to three named and the rest counted. */
export function combineAnnouncements(waiting: readonly Announcement[]): string {
  const latest = new Map<string, string>();
  for (const { key, text } of waiting) {
    latest.delete(key);
    latest.set(key, text);
  }
  const texts = [...latest.values()];
  const named = texts.slice(0, NAMED).map((text) => `${text}.`);
  const more = texts.length - NAMED;
  return more > 0 ? `${named.join(' ')} And ${more} more changed.` : named.join(' ');
}

interface AnnouncerOptions {
  /** The least time between two messages. */
  gapMs: number;
  say: (text: string) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

export interface Announcer {
  push: (announcement: Announcement) => void;
  dispose: () => void;
}

/**
 * Speaks the first announcement after a quiet spell at once, and holds anything after it until the
 * gap is up, then speaks all of it as one message. The same throttle as the Campuses reload.
 */
export function createAnnouncer({
  gapMs,
  say,
  now = Date.now,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
}: AnnouncerOptions): Announcer {
  let last = -Infinity;
  let waiting: Announcement[] = [];
  let timer: unknown = undefined;

  const flush = () => {
    timer = undefined;
    if (waiting.length === 0) return;
    last = now();
    say(combineAnnouncements(waiting));
    waiting = [];
  };

  return {
    push(announcement) {
      waiting.push(announcement);
      if (timer !== undefined) return;
      const wait = last + gapMs - now();
      if (wait <= 0) flush();
      else timer = setTimer(flush, wait);
    },
    dispose() {
      if (timer !== undefined) clearTimer(timer);
      timer = undefined;
      waiting = [];
    },
  };
}
