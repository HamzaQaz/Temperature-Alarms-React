/** How often the log repeats that one Device still uses the previous Device token. */
export const PREVIOUS_TOKEN_LOG_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Which Devices have reported with which Device token since the api started, so a technician can
 * see who still needs reflashing during a rotation (docs/adr/0003). In memory, like the rate
 * limits: one api (docs/adr/0001), and after a restart every board reports again within a Report
 * interval. Keyed by registered hostnames only, so it never grows past the Devices table.
 */
export interface TokenRotation {
  /** When this api started listening for Readings; a Device silent since then is "unheard". */
  since: Date;
  /** A registered Device's Reading was recorded with the given token. */
  heard(hostname: string, token: 'current' | 'previous'): void;
  /** The Devices whose latest Reading since `since` came with the previous token. */
  onPrevious(): Set<string>;
  /** The Devices heard at all since `since`. */
  heardSince(): Set<string>;
}

interface Options {
  now?: () => Date;
  /** Where the hourly reminder goes. It names the hostname, never a token. */
  log?: (line: string) => void;
}

export function createTokenRotation({ now = () => new Date(), log = (line) => console.log(line) }: Options = {}): TokenRotation {
  const since = now();
  const latest = new Map<string, 'current' | 'previous'>();
  const lastLogged = new Map<string, number>();
  return {
    since,
    heard(hostname, token) {
      latest.set(hostname, token);
      if (token === 'current') {
        lastLogged.delete(hostname);
        return;
      }
      const at = now().getTime();
      const logged = lastLogged.get(hostname);
      if (logged !== undefined && at - logged < PREVIOUS_TOKEN_LOG_INTERVAL_MS) return;
      lastLogged.set(hostname, at);
      log(`Device ${hostname} is still using the previous Device token; reflash it with the current one (Settings lists every such Device)`);
    },
    onPrevious: () => new Set([...latest].filter(([, token]) => token === 'previous').map(([hostname]) => hostname)),
    heardSince: () => new Set(latest.keys()),
  };
}
