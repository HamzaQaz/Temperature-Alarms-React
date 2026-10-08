/**
 * A fault report on the dashboard (docs/adr/0009): the board was heard from, but its sensor did
 * not answer, so no Reading came with it. The card takes the server's new state (Online, the
 * Conditions, the last report, whether the board is on its fallback network) and keeps its last good Reading, still ageing from when it was
 * recorded. Nothing is judged here: Sensor fault and Online are the server's.
 */
import type { DashboardDevice, FaultEvent } from '../types.ts';

/** What the dashboard holds of a Device: its ages were true at `asOf`, on the monotonic clock (lib/elapsed.ts). */
export interface AgedDevice
  extends Pick<DashboardDevice, 'hostname' | 'online' | 'conditions' | 'lastReportAt' | 'secondsSinceReading' | 'secondsSinceReport' | 'onFallbackNetwork'> {
  asOf: number;
}

/**
 * The Devices with the fault report applied to its card, aged from `now`, or the same list when
 * no card is that Device's or the card already knows a later report (a reload that raced the
 * stream), so replaying an event is always safe. The Reading's age moves to the new anchor by
 * whole seconds only, the remainder kept in the anchor, so a long run of fault reports never
 * wears it down.
 */
export function applyFault<T extends AgedDevice>(devices: T[], event: FaultEvent, now: number): T[] {
  const index = devices.findIndex((d) => d.hostname === event.device);
  if (index === -1) return devices;
  const device = devices[index];
  if (device.lastReportAt !== null && device.lastReportAt > event.lastReportAt) return devices;
  const elapsed = Math.max(0, Math.floor((now - device.asOf) / 1000));
  const next = devices.slice();
  next[index] = {
    ...device,
    online: event.online,
    conditions: event.conditions,
    lastReportAt: event.lastReportAt,
    onFallbackNetwork: event.onFallbackNetwork,
    secondsSinceReport: 0,
    secondsSinceReading: device.secondsSinceReading === null ? null : device.secondsSinceReading + elapsed,
    asOf: device.asOf + elapsed * 1000,
  };
  return next;
}

/** True when the server says the Device is in Sensor fault: its Reading is the last good one, not the closet now. */
export const hasSensorFault = (conditions: readonly { name: string }[]): boolean => conditions.some((c) => c.name === 'Sensor fault');

/** "under 1 min ago", "14 min ago", "2 h 5 min ago", "3 d ago": how old a Reading kept on screen after it stopped being current is. */
export function formatStaleAge(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return 'under 1 min ago';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 === 0 ? `${hours} h ago` : `${hours} h ${minutes % 60} min ago`;
  return `${Math.floor(hours / 24)} d ago`;
}
