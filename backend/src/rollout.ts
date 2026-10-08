/**
 * Staged rollout (docs/adr/0007): a release goes to named Devices first, and to every Device once
 * those have run it cleanly for a while; one of them failing it holds the release by itself. These
 * are the rules: when a named Device is ready, and when a report shows it failed to install the
 * build. firmwareStore.ts keeps the release and its hold; ingest and the Offline sweep ask it.
 *
 * Pure functions only: no I/O, no clock.
 */

/** Good Readings in a row each named Device sends on the new version before "Release to all" is offered (owner, 2026-10-07). */
export const CLEAN_REPORTS_TO_WIDEN = 10;

/** Why a staged release was held: one of its named Devices went Offline or into Sensor fault after taking it, or failed to install it. */
export type HoldReason = 'Offline' | 'Sensor fault' | 'update failed';

/** What the Device's row says about the reports before this one. */
export interface CleanCount {
  /** The firmware version it last said it runs; null when it never has. */
  version: number | null;
  /** Good Readings in a row it has sent on that version. */
  cleanReports: number;
  /** When it last reported, a Reading or a fault report. */
  lastReportAt: Date | null;
}

/**
 * Good Readings in a row a Device has sent on its firmware version, once this report is counted. A
 * Reading on the same version as the report before it, within two Report intervals of it, adds one;
 * a Reading on another version, or after a missed interval, starts again at one. A fault report, or
 * a Reading that does not say its version (firmware before 3), is not clean.
 */
export function cleanReportsAfter(previous: CleanCount, report: { version: number | null; reading: boolean; at: Date }, reportIntervalSeconds: number): number {
  if (!report.reading || report.version === null) return 0;
  const onTime = previous.lastReportAt !== null && report.at.getTime() - previous.lastReportAt.getTime() <= 2 * reportIntervalSeconds * 1000;
  return onTime && previous.version === report.version ? previous.cleanReports + 1 : 1;
}

/** What the Firmware tab shows of a Device that a report can change, before and after it. */
export interface RolloutFacts {
  version: number | null;
  updateResult: string | null;
  cleanReports: number;
}

/**
 * Whether a report changes what the Firmware tab shows, so an open one is told to read it again
 * (sse.ts, firmwareChanged): the version the board runs, or its last update check's result; or, for
 * a Device the release is offered to, its clean Readings, up to the CLEAN_REPORTS_TO_WIDEN the tab
 * counts to. The rest, the signal and uptime every Reading brings, waits for the tab's own re-read.
 */
export function reportMovesRollout(before: RolloutFacts, after: RolloutFacts, offered: boolean): boolean {
  if (before.version !== after.version || before.updateResult !== after.updateResult) return true;
  return offered && Math.min(before.cleanReports, CLEAN_REPORTS_TO_WIDEN) !== Math.min(after.cleanReports, CLEAN_REPORTS_TO_WIDEN);
}

/** True once a named Device runs `version` (or later) and has sent CLEAN_REPORTS_TO_WIDEN clean Readings on it. */
export const readyFor = (version: number, { firmwareVersion, cleanReports }: { firmwareVersion: number | null; cleanReports: number }): boolean =>
  firmwareVersion !== null && firmwareVersion >= version && cleanReports >= CLEAN_REPORTS_TO_WIDEN;

/** From this version a board says its version with each Reading, and checks at once when the answer says a newer build waits (X-Firmware-Available). */
export const NUDGED_FROM_VERSION = 3;

/** How often a board checks for a build on its own; it also checks 30 s after it starts (arduino/TemperatureAlarms/updater.cpp). */
export const HOURLY_CHECK_MS = 60 * 60 * 1000;

/**
 * Where an offered Device is on its way to the release: waiting for its next check, downloading
 * (the server sent it the image), then running the new version; or stuck: Offline, refused the
 * image, never checked in at all, no longer registered, or not offered because the release is held.
 */
export type ProgressStep = 'waiting' | 'downloading' | 'running' | 'refused' | 'offline' | 'never-checked' | 'held' | 'unregistered';

/** When a Device still to take the release checks next: at its next Reading, nudged, or on its own hourly check. */
export interface NextCheck {
  by: 'reading' | 'hourly';
  /** Null when there is nothing to count from. */
  at: Date | null;
}

/** What the Device's row says, for progressOf. */
export interface ProgressFacts {
  firmwareVersion: number | null;
  /** Its last update check; null when it never made one. */
  checkedAt: Date | null;
  /** When the server last sent it an image. */
  sentAt: Date | null;
  /** Its last update check's result, as its latest Reading said it, and when. */
  updateResult: string | null;
  infoAt: Date | null;
  lastReportAt: Date | null;
  /** The server judges it Offline now. */
  offline: boolean;
}

/**
 * Where a Device is with `release` (null facts: no Device has the hostname now). Offline comes
 * first, as it stops everything else; a Device still to take it says when it checks next: a board
 * that reports its version with its Readings checks at the next one, nudged; a silent one (Offline,
 * or firmware before 3) on its hourly check, or 30 s after a restart.
 */
export function progressOf(
  release: { version: number; publishedAt: Date; held: boolean },
  device: ProgressFacts | null,
  reportIntervalSeconds: number,
): { step: ProgressStep; nextCheck: NextCheck | null } {
  if (device === null) return { step: 'unregistered', nextCheck: null };
  const running = device.firmwareVersion !== null && device.firmwareVersion >= release.version;
  const sent = device.sentAt !== null && device.sentAt.getTime() >= release.publishedAt.getTime();
  const nextCheck = running || sent || release.held || device.checkedAt === null ? null : nextCheckOf(device, reportIntervalSeconds);
  if (device.offline) return { step: 'offline', nextCheck };
  if (running) return { step: 'running', nextCheck: null };
  if (device.infoAt !== null && failedToInstall(release, { sentAt: device.sentAt, version: device.firmwareVersion }, device.updateResult, device.infoAt)) {
    return { step: 'refused', nextCheck: null };
  }
  if (sent) return { step: 'downloading', nextCheck: null };
  if (device.checkedAt === null) return { step: 'never-checked', nextCheck: null };
  if (release.held) return { step: 'held', nextCheck: null };
  return { step: 'waiting', nextCheck };
}

function nextCheckOf({ offline, firmwareVersion, lastReportAt, checkedAt }: ProgressFacts, reportIntervalSeconds: number): NextCheck {
  if (!offline && lastReportAt !== null && (firmwareVersion ?? 0) >= NUDGED_FROM_VERSION) {
    return { by: 'reading', at: new Date(lastReportAt.getTime() + reportIntervalSeconds * 1000) };
  }
  return { by: 'hourly', at: checkedAt === null ? null : new Date(checkedAt.getTime() + HOURLY_CHECK_MS) };
}

/** A step in words, as the Firmware tab and `deploy.sh firmware-status` both say it. */
export const STEP_TEXT: Record<ProgressStep, string> = {
  waiting: 'Waiting for its next check',
  downloading: 'Downloading',
  running: 'Running the new version',
  refused: 'Refused the image',
  offline: 'Offline',
  'never-checked': 'Never checked in',
  held: 'Not offered while held',
  unregistered: 'Not registered',
};

/** When the next check is due, in words: "at its next Reading, by 23:55", "by 23:55, or restart the board", or "due by 23:55; restart the board" once past. */
export function nextCheckText({ by, at }: NextCheck, now: Date, timeOf: (at: Date) => string): string {
  if (by === 'reading') return at === null ? 'at its next Reading' : `at its next Reading, by ${timeOf(at)}`;
  if (at === null) return 'restart the board';
  return at.getTime() < now.getTime() ? `due by ${timeOf(at)}; restart the board` : `by ${timeOf(at)}, or restart the board`;
}

/** One Device's progress, for progressDetail. */
export interface ProgressLine {
  step: ProgressStep;
  nextCheck: NextCheck | null;
  sentAt: Date | null;
  updateResult: string | null;
  lastReportAt: Date | null;
  cleanReports: number;
}

/** What follows a step: when to expect the next one, or what is known about where it stopped. Null when there is nothing to add. */
export function progressDetail(line: ProgressLine, now: Date, timeOf: (at: Date) => string): string | null {
  switch (line.step) {
    case 'waiting':
      return line.nextCheck === null ? null : nextCheckText(line.nextCheck, now, timeOf);
    case 'downloading':
      return line.sentAt === null ? null : `the server sent the image at ${timeOf(line.sentAt)}`;
    case 'running':
      return `${Math.min(line.cleanReports, CLEAN_REPORTS_TO_WIDEN)} of ${CLEAN_REPORTS_TO_WIDEN} clean Readings`;
    case 'refused':
      return line.updateResult;
    case 'offline': {
      const last = line.lastReportAt === null ? 'it has never reported' : `last report at ${timeOf(line.lastReportAt)}`;
      return line.nextCheck === null ? last : `${last}, next check ${nextCheckText(line.nextCheck, now, timeOf)}`;
    }
    case 'never-checked':
      return 'flashed before over-the-air updates or built without public.key; it needs a USB flash';
    default:
      return null;
  }
}

/** How the firmware reports an update attempt that went wrong: `failed, <why>` (arduino/TemperatureAlarms/updater.cpp). */
const FAILED_UPDATE = /^failed\b/i;

/**
 * True when a report saying `updateResult` shows a Device failing to install the release published at
 * `release.publishedAt`: the update failed, the server had sent the Device this release before the
 * report arrived, and the Device still runs an older version. A failure it reported before the
 * release was sent to it was about something else, and the board keeps its last result until it
 * checks again.
 */
export function failedToInstall(
  release: { version: number; publishedAt: Date },
  device: { sentAt: Date | null; version: number | null },
  updateResult: string | null,
  reportedAt: Date,
): boolean {
  if (updateResult === null || !FAILED_UPDATE.test(updateResult) || device.sentAt === null) return false;
  const sentThisRelease = device.sentAt.getTime() >= release.publishedAt.getTime();
  return sentThisRelease && device.sentAt.getTime() < reportedAt.getTime() && (device.version ?? 0) < release.version;
}
