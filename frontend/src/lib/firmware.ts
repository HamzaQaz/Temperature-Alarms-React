import type { FirmwareStatus } from '../types.ts';

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

export function firmwareSummary({ release, devices }: FirmwareStatus, dateOf: (iso: string) => string): FirmwareSummary {
  const neverChecked = hostnames(devices.filter((d) => d.checkedAt === null));
  if (release === null) {
    return { release: 'No firmware is published; boards keep what they run.', progress: null, behind: [], neverChecked };
  }
  const offered = devices.filter((d) => release.only === null || release.only.includes(d.hostname));
  const current = offered.filter((d) => d.firmwareVersion !== null && d.firmwareVersion >= release.version);
  const behind = hostnames(offered.filter((d) => d.checkedAt !== null && (d.firmwareVersion ?? 0) < release.version));
  const to = release.only === null ? 'every Device' : release.only.join(', ');
  return {
    release: `Version ${release.version} is published to ${to}, since ${dateOf(release.publishedAt)}.`,
    progress: `${current.length} of ${offered.length} ${offered.length === 1 ? 'Device runs' : 'Devices run'} it.`,
    behind,
    neverChecked,
  };
}
