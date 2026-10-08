/**
 * The notifications outbox (docs/adr/0008): which Incident changes are emailed, when a waiting
 * batch is ready to send, and how long a failed one waits before the next try.
 *
 * Pure functions only: no I/O, no clock. outboxStore.ts writes and reads the rows, notifier.ts
 * runs the sender, and notificationEmail.ts says what the email reads.
 */
import { LEVELS_WORST_FIRST, type ConditionLevel } from './conditions';
import type { IncidentChange } from './incidents';

/**
 * Why a notification was queued: the Incident opened, its level rose to a new worst, it closed, or
 * it is still open and unacknowledged another reminder period on.
 */
export type NotificationKind = 'opened' | 'worse' | 'closed' | 'reminder';

/** The Campus a Device is registered under between flashing and installation, expected to be Offline (CONTEXT.md). */
export const BENCH_SHORTCODE = 'BENCH';

/** True for the Bench Campus's shortcode, in any case, as shortcodes match everywhere else. */
export const isBench = (shortcode: string): boolean => shortcode.trim().toUpperCase() === BENCH_SHORTCODE;

/** What enqueuing knows about one changed incident, read under the Device's row lock after the change was saved. */
export interface ChangeFacts {
  change: IncidentChange;
  /** True when this change also wrote the incident: an Offline stretch ingest records already closed opened here too. */
  created: boolean;
  /** The incident's level now: the worst any segment reached. */
  level: ConditionLevel;
  /** Each segment's level, oldest first. */
  segmentLevels: ConditionLevel[];
  /** The Device's Campus shortcode. */
  campusShortcode: string;
}

/**
 * The notifications one incident change queues, in order. Opening and closing always notify.
 * A level change notifies only when it takes the incident to a level it has not reached before
 * (warning to critical once, not each time a closet swinging at the line steps back up); a fall
 * is quiet and shows in the closing email. An Offline stretch recorded already closed queues its
 * opening and its close, so it is emailed once as "opened and resolved". A Device on the Bench
 * queues nothing.
 */
export function notificationKinds({ change, created, level, segmentLevels, campusShortcode }: ChangeFacts): NotificationKind[] {
  if (isBench(campusShortcode)) return [];
  if (change === 'opened') return ['opened'];
  if (change === 'closed') return created ? ['opened', 'closed'] : ['closed'];
  // The newest segment is the first to reach the incident's worst level: this step raised it.
  return segmentLevels.length > 1 && segmentLevels.indexOf(level) === segmentLevels.length - 1 ? ['worse'] : [];
}

/**
 * When an open, unacknowledged Incident is reminded about: every `periodMs` counted from its start,
 * not from the process, so a restart neither repeats one nor starts the count again. Returns the
 * point on that schedule a reminder is now due for, to be stored as the incident's last reminder,
 * or null when none is due. After a gap (the server down, reminders just turned on) one reminder
 * covers every period missed, not one each.
 */
export function reminderDue(start: Date, lastRemindedAt: Date | null, now: Date, periodMs: number): Date | null {
  if (periodMs <= 0) return null;
  const from = lastRemindedAt ?? start;
  if (now.getTime() - from.getTime() < periodMs) return null;
  const periods = Math.floor((now.getTime() - start.getTime()) / periodMs);
  return new Date(start.getTime() + periods * periodMs);
}

/** Retry timing for a batch the relay did not take. */
export interface RetryPolicy {
  /** The wait after the first failure; each later one doubles it. */
  firstMs: number;
  /** The longest wait between tries. */
  maxMs: number;
  /** How long after it was queued a notification is given up on and marked failed. */
  giveUpMs: number;
}

/** 30 s, 1 min, 2 min, ... up to 15 min between tries, for a day (docs/adr/0008). */
export const DEFAULT_RETRY: RetryPolicy = { firstMs: 30_000, maxMs: 15 * 60_000, giveUpMs: 24 * 60 * 60_000 };

/** How long to wait after the `attempts`th failed try (1 for the first). */
export function retryDelayMs(attempts: number, { firstMs, maxMs }: RetryPolicy): number {
  // 2 ** 30 is far past any cap; the exponent stops there so the number stays finite.
  return Math.min(firstMs * 2 ** Math.min(Math.max(attempts - 1, 0), 30), maxMs);
}

/** True when a notification queued at `createdAt` that just failed again should be given up on. */
export const givesUp = (createdAt: Date, now: Date, { giveUpMs }: RetryPolicy): boolean => now.getTime() - createdAt.getTime() >= giveUpMs;

/** A due notification, as the sender decides whether to send its batch. */
export interface DueNotification {
  createdAt: Date;
  /** Tries already made; more than zero means its batch waited its window before. */
  attempts: number;
}

/**
 * True when the due notifications should go now, as one email: once the oldest has waited the
 * coalescing window, so a campus losing power is one email, or at once when any is a retry,
 * whose batch already waited. Everything due goes together, so a burst that keeps arriving still
 * sends within one window of its first row, and a row that missed it within the next.
 */
export function readyToSend(due: DueNotification[], now: Date, windowMs: number): boolean {
  if (due.length === 0) return false;
  if (due.some((n) => n.attempts > 0)) return true;
  const oldest = Math.min(...due.map((n) => n.createdAt.getTime()));
  return now.getTime() - oldest >= windowMs;
}

const rank = (level: ConditionLevel): number => LEVELS_WORST_FIRST.indexOf(level);

/** Compare two levels worst first, for sorting. */
export const worstFirst = (a: ConditionLevel, b: ConditionLevel): number => rank(a) - rank(b);
