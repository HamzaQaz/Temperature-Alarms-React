import type { DeviceRotation } from '../types.ts';

/** What the Settings page says about a Device token rotation, or null when none is under way. */
export interface RotationSummary {
  /** The Devices to reflash: their latest Reading still came with the previous token. */
  previous: string;
  /** The Devices the server has not heard since it started, so it cannot say which token they hold. */
  unheard: string | null;
  /** True once every Device reports with the new token, and the previous one can be cleared. */
  done: boolean;
}

const hostnames = (devices: DeviceRotation['previous']): string => devices.map((d) => d.hostname).join(', ');

export function rotationSummary(rotation: DeviceRotation, timeOf: (iso: string) => string): RotationSummary | null {
  if (!rotation.active) return null;
  const { previous, unheard, since } = rotation;
  return {
    previous:
      previous.length === 0
        ? 'No Device reports with the previous Device token.'
        : `${previous.length} ${previous.length === 1 ? 'Device still reports' : 'Devices still report'} with the previous Device token: ${hostnames(previous)}.`,
    unheard:
      unheard.length === 0
        ? null
        : `${unheard.length} not heard since ${timeOf(since)}, so not known to have the new token: ${hostnames(unheard)}.`,
    done: previous.length === 0 && unheard.length === 0,
  };
}
