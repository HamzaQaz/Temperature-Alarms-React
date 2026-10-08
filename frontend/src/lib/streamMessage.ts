import type { FaultEvent, FirmwareEvent, IncidentEvent, ReadingEvent, StreamEvent } from '../types.ts';

/** What a page does with each kind of stream message; a page passes only those it shows. */
export interface StreamHandlers {
  onReading?: (event: ReadingEvent) => void;
  /** A Device posted a fault report: heard from, with no Reading (docs/adr/0009). */
  onFault?: (event: FaultEvent) => void;
  /** An incident opened, changed level, closed, or was acknowledged. */
  onIncident?: (event: IncidentEvent) => void;
  /** Firmware status can have changed: the Firmware tab reads it again. */
  onFirmware?: (event: FirmwareEvent) => void;
}

/**
 * Hand one stream message (its `data`) to the handler for its `type`. A message no handler is
 * passed for (a `firmware` event on the Dashboard), of a type this browser does not know (one a
 * newer server sends), or that is not a JSON object, is dropped without an error.
 */
export function routeStreamMessage(data: string, { onReading, onFault, onIncident, onFirmware }: StreamHandlers): void {
  let event: StreamEvent;
  try {
    event = JSON.parse(data) as StreamEvent;
  } catch {
    return;
  }
  if (typeof event !== 'object' || event === null) return;
  if (event.type === 'reading') onReading?.(event);
  else if (event.type === 'fault') onFault?.(event);
  else if (event.type === 'incident') onIncident?.(event);
  else if (event.type === 'firmware') onFirmware?.(event);
}
