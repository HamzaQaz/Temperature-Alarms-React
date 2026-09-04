/**
 * A Device hostname: `ESP_` plus the last six hex digits of its MAC address.
 * Mirrors the server's rule; the server stays the authority.
 */
export const HOSTNAME_PATTERN = /^ESP_[0-9A-F]{6}$/;

export const HOSTNAME_EXAMPLE = 'ESP_A1B2C3';

/** Why a hostname is not acceptable, or null when it is. */
export const hostnameProblem = (hostname: string): string | null =>
  HOSTNAME_PATTERN.test(hostname) ? null : `Hostnames look like ${HOSTNAME_EXAMPLE}: ESP_ followed by six hex digits.`;
