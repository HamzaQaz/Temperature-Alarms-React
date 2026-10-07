/** How long a refused token keeps a Device flagged when no further attempt comes. */
export const TOKEN_MISMATCH_WINDOW_MS = 15 * 60 * 1000;
/** More hostnames than a district has boards; past it the oldest entry goes, so memory stays bounded. */
const MAX_TRACKED = 1000;

/**
 * Token mismatch: which hostnames were last claimed with a Device token the server refused, so the
 * dashboard can say "Token mismatch" instead of a board just going quiet. In memory, like the rate
 * limits (one api, docs/adr/0001); a restart forgets it, and a board still on the wrong token is
 * flagged again at its next attempt. Anyone can claim any hostname with a wrong token, so this is a
 * hint for technicians, never a decision: it is shown only for registered Devices, and the
 * wrong-token limit (deviceAuth.ts) caps how often an address can set it.
 */
export interface DeviceSightings {
  /** A request claiming `hostname` was refused for its token. */
  mismatch(hostname: string): void;
  /** A Reading from `hostname` was accepted: whatever its token was before, it is right now. */
  accepted(hostname: string): void;
  /** When `hostname` was last refused, if within the window and not since accepted; else null. */
  mismatchedAt(hostname: string): Date | null;
}

export function createDeviceSightings({ now = () => new Date() }: { now?: () => Date } = {}): DeviceSightings {
  const refused = new Map<string, number>();
  return {
    mismatch(hostname) {
      refused.delete(hostname); // re-inserted last, so the oldest entry is first to go
      refused.set(hostname, now().getTime());
      if (refused.size > MAX_TRACKED) refused.delete(refused.keys().next().value as string);
    },
    accepted(hostname) {
      refused.delete(hostname);
    },
    mismatchedAt(hostname) {
      const at = refused.get(hostname);
      if (at === undefined || now().getTime() - at >= TOKEN_MISMATCH_WINDOW_MS) return null;
      return new Date(at);
    },
  };
}
