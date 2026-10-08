import type { DeviceProgress, FirmwareHold, FirmwareStatus, ProgressStep } from '../types.ts';

/** What the Firmware tab says about a release and the fleet. */
export interface FirmwareSummary {
  /** The release on offer, and who it is offered to, in a sentence, or that there is none. */
  release: string;
  /** How many Devices it is offered to run it (or later), of how many. */
  progress: string | null;
  /**
   * Hostnames that have never checked for an update (flashed before over-the-air, or never online),
   * among the Devices it is not offered to: those it is offered to say so on their own line.
   */
  neverChecked: string[];
}

/** The release in a sentence: who it is offered to and since when. Only a staged release is ever held or widened. */
function releaseSentence({ version, staged, publishedAt, widenedAt, hold, offeredTo }: NonNullable<FirmwareStatus['release']>, dateOf: (iso: string) => string): string {
  const first = (staged ?? []).join(', ');
  if (hold !== null) return `Version ${version} is held: it is offered to no Device. It went to ${first} first, from ${dateOf(publishedAt)}.`;
  if (widenedAt !== null) return `Version ${version} is published to every Device, since ${dateOf(widenedAt)}; ${first} had it first, from ${dateOf(publishedAt)}.`;
  return `Version ${version} is published, since ${dateOf(publishedAt)}. ${offeredTo}.`;
}

export function firmwareSummary({ release, progress, devices }: FirmwareStatus, dateOf: (iso: string) => string): FirmwareSummary {
  const lined = new Set((progress?.devices ?? []).map((d) => d.hostname));
  const neverChecked = devices.filter((d) => d.checkedAt === null && !lined.has(d.hostname)).map((d) => d.hostname);
  if (release === null) {
    return { release: 'No firmware is published; boards keep what they run.', progress: null, neverChecked };
  }
  const offered = devices.filter((d) => release.only === null || release.only.includes(d.hostname));
  const current = offered.filter((d) => d.firmwareVersion !== null && d.firmwareVersion >= release.version);
  return {
    release: releaseSentence(release, dateOf),
    progress: `${current.length} of ${offered.length} ${offered.length === 1 ? 'Device runs' : 'Devices run'} it.`,
    neverChecked,
  };
}

/** A step in words, as the server's command line (`deploy.sh firmware-status`) says it too. */
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

/**
 * When the next check is due, in words: "at its next Reading, by 11:55 PM" for a board that sends
 * Readings (the server's answer nudges it), "by 11:55 PM, or restart the board" for a silent one,
 * which checks hourly and 30 s after it starts, and "due by 11:55 PM; restart the board" once past.
 */
export function nextCheckText({ by, at }: NonNullable<DeviceProgress['nextCheck']>, now: number, timeOf: (iso: string) => string): string {
  if (by === 'reading') return at === null ? 'at its next Reading' : `at its next Reading, by ${timeOf(at)}`;
  if (at === null) return 'restart the board';
  return new Date(at).getTime() < now ? `due by ${timeOf(at)}; restart the board` : `by ${timeOf(at)}, or restart the board`;
}

/** What follows a Device's step: when to expect the next one, or what is known about where it stopped. Null when there is nothing to add. */
export function progressDetail(device: DeviceProgress, cleanReportsToWiden: number, now: number, timeOf: (iso: string) => string): string | null {
  switch (device.step) {
    case 'waiting':
      return device.nextCheck === null ? null : nextCheckText(device.nextCheck, now, timeOf);
    case 'downloading':
      return device.sentAt === null ? null : `the server sent the image at ${timeOf(device.sentAt)}`;
    case 'running':
      return `${Math.min(device.cleanReports, cleanReportsToWiden)} of ${cleanReportsToWiden} clean Readings`;
    case 'refused':
      return device.updateResult;
    case 'offline': {
      const last = device.lastReportAt === null ? 'it has never reported' : `last report at ${timeOf(device.lastReportAt)}`;
      return device.nextCheck === null ? last : `${last}, next check ${nextCheckText(device.nextCheck, now, timeOf)}`;
    }
    case 'never-checked':
      return 'flashed before over-the-air updates or built without public.key; it needs a USB flash';
    default:
      return null;
  }
}

/** What the named Device did, as the server's hold says it: "ESP_A1B2C3 went Offline after taking it". */
const holdWhat = ({ hostname, reason, detail }: FirmwareHold): string =>
  reason === 'update failed'
    ? `${hostname} failed to install it${detail === null ? '' : ` (${detail})`}`
    : `${hostname} went ${reason === 'Offline' ? 'Offline' : 'into Sensor fault'} after taking it`;

/** Why a staged release stopped by itself, and when: "Held on Oct 7, 2:05 PM: ESP_A1B2C3 went Offline after taking it." */
export const holdSentence = (hold: FirmwareHold, dateOf: (iso: string) => string): string => `Held on ${dateOf(hold.at)}: ${holdWhat(hold)}.`;

/** What "Release to all" waits on, said beside it: every named Device's clean Readings on the new version. */
export function rolloutNote({ cleanReportsToWiden, devices, ready }: NonNullable<FirmwareStatus['rollout']>, version: number): string {
  if (ready) return `Every named Device has sent ${cleanReportsToWiden} clean Readings in a row on version ${version}.`;
  const waiting = devices.filter((d) => !d.ready).map((d) => d.hostname);
  return `Offered once every named Device has sent ${cleanReportsToWiden} clean Readings in a row on version ${version}. Not yet: ${waiting.join(', ')}.`;
}
