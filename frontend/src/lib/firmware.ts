import type { FirmwareHold, FirmwareStatus, StagedDevice } from '../types.ts';

/** What the Firmware tab says about a release and the fleet. */
export interface FirmwareSummary {
  /** The release on offer, in a sentence, or that there is none. */
  release: string;
  /** How many Devices it is offered to run it (or later), of how many. */
  progress: string | null;
  /** Hostnames it is offered to that still run an older version. */
  behind: string[];
  /** Hostnames that have never checked for an update (flashed before over-the-air, or never online). */
  neverChecked: string[];
}

const hostnames = (devices: FirmwareStatus['devices']): string[] => devices.map((d) => d.hostname);

/** The release in a sentence: who it is offered to and since when. Only a staged release is ever held or widened. */
function releaseSentence({ version, only, staged, publishedAt, widenedAt, hold }: NonNullable<FirmwareStatus['release']>, dateOf: (iso: string) => string): string {
  const first = (staged ?? []).join(', ');
  if (hold !== null) return `Version ${version} is held: it is offered to no Device. It went to ${first} first, from ${dateOf(publishedAt)}.`;
  if (widenedAt !== null) return `Version ${version} is published to every Device, since ${dateOf(widenedAt)}; ${first} had it first, from ${dateOf(publishedAt)}.`;
  return `Version ${version} is published to ${only === null ? 'every Device' : only.join(', ')}, since ${dateOf(publishedAt)}.`;
}

export function firmwareSummary({ release, devices }: FirmwareStatus, dateOf: (iso: string) => string): FirmwareSummary {
  const neverChecked = hostnames(devices.filter((d) => d.checkedAt === null));
  if (release === null) {
    return { release: 'No firmware is published; boards keep what they run.', progress: null, behind: [], neverChecked };
  }
  const offered = devices.filter((d) => release.only === null || release.only.includes(d.hostname));
  const current = offered.filter((d) => d.firmwareVersion !== null && d.firmwareVersion >= release.version);
  const behind = hostnames(offered.filter((d) => d.checkedAt !== null && (d.firmwareVersion ?? 0) < release.version));
  return {
    release: releaseSentence(release, dateOf),
    progress: `${current.length} of ${offered.length} ${offered.length === 1 ? 'Device runs' : 'Devices run'} it.`,
    behind,
    neverChecked,
  };
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

/** "4 of 10": a named Device's clean Readings toward "Release to all", stopping at the number needed. */
export const cleanProgress = ({ cleanReports }: StagedDevice, needed: number): string => `${Math.min(cleanReports, needed)} of ${needed}`;
