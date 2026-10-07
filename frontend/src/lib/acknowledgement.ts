/**
 * Acknowledgement (CONTEXT.md): a technician saying they are on an open incident, by a name or a
 * short note, since there are no user accounts. The server records it and sends it on the
 * stream; the browser only places it on the card and the log row, and words it.
 */
import { formatStaleAge } from './faultReport.ts';
import type { Acknowledgement, Incident, OpenIncident } from '../types.ts';

/** The longest name or note the server takes, in characters. */
export const ACKNOWLEDGED_BY_MAX = 60;

/** Control characters, the line and paragraph separators, and the marks that reorder text, which the server refuses in a name. */
const REFUSED = /[\p{Cc}\p{Zl}\p{Zp}\u202A-\u202E\u2066-\u2069]/u;

/** Why a name cannot be sent, as the server would say it, or null when it can (trimmed first, as the server trims). */
export function acknowledgerError(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === '') return 'Give your name, or a short note.';
  if ([...trimmed].length > ACKNOWLEDGED_BY_MAX) return `At most ${ACKNOWLEDGED_BY_MAX} characters.`;
  if (REFUSED.test(trimmed)) return 'No line breaks or control characters.';
  return null;
}

/** What a card holds of a Device: which one, and its open incidents. */
interface WithOpenIncidents {
  id: number;
  openIncidents: OpenIncident[];
}

const openIncidentOf = (incident: Incident): OpenIncident => ({
  id: incident.id,
  condition: incident.condition,
  level: incident.level,
  start: incident.start,
  acknowledgement: incident.acknowledgement,
});

/**
 * The Devices with an incident from the stream (or an acknowledge answer) applied to its card:
 * an open one takes its place among the card's open incidents, oldest first, and a closed one
 * leaves. The same list when no card is that Device's, so replaying an event is always safe.
 *
 * `opens: false` is for an acknowledgement, from the stream or the server's answer: it only
 * updates an incident the card already holds. An acknowledgement never opens an incident, and
 * one read just before a close can land after the close, which must not bring it back.
 */
export function applyIncident<T extends WithOpenIncidents>(devices: T[], incident: Incident, { opens = true }: { opens?: boolean } = {}): T[] {
  const index = devices.findIndex((d) => d.id === incident.device.id);
  if (index === -1) return devices;
  const device = devices[index];
  const others = device.openIncidents.filter((i) => i.id !== incident.id);
  const held = others.length < device.openIncidents.length;
  if (!held && (incident.end !== null || !opens)) return devices;
  const openIncidents =
    incident.end !== null
      ? others
      : [...others, openIncidentOf(incident)].sort((a, b) => (a.start === b.start ? a.id - b.id : a.start < b.start ? -1 : 1));
  const next = devices.slice();
  next[index] = { ...device, openIncidents };
  return next;
}

/**
 * The log's rows with `incident` in its row's place, unless the row holds an end and the payload
 * does not: an incident never reopens, so that is an older read (an acknowledgement answered just
 * before the close) landing after the close, and the row is kept.
 */
export function replaceIncident(rows: Incident[], incident: Incident): Incident[] {
  return rows.map((row) => (row.id !== incident.id || (row.end !== null && incident.end === null) ? row : incident));
}

/** "10 min ago": how long ago it was given by this browser's clock, never in the future. */
export function acknowledgedAgo({ at }: Acknowledgement, now: number): string {
  return formatStaleAge(Math.max(0, Math.floor((now - new Date(at).getTime()) / 1000)));
}

const NAME_KEY = 'temperature-alarms.acknowledged-by';

/** The name this browser last acknowledged with, to offer again; '' when none (or storage is blocked). */
export function rememberedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function rememberName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Private mode or blocked storage: the name is asked for again next time.
  }
}
