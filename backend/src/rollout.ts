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

/** True once a named Device runs `version` (or later) and has sent CLEAN_REPORTS_TO_WIDEN clean Readings on it. */
export const readyFor = (version: number, { firmwareVersion, cleanReports }: { firmwareVersion: number | null; cleanReports: number }): boolean =>
  firmwareVersion !== null && firmwareVersion >= version && cleanReports >= CLEAN_REPORTS_TO_WIDEN;

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
