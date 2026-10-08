/**
 * A Campus's own recipient list (docs/adr/0008), as the Campuses section takes it: comma-separated
 * bare addresses, checked by the rule the server applies to NOTIFY_TO (backend/src/config.ts),
 * which checks them again. Empty: the Campus emails the default recipients, NOTIFY_TO.
 */

/** A bare address, `name@host.tld`: no display name, no spaces, nothing a header could be split on. */
const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

/** The widest a list may be once stored as `a@x, b@y`; the server enforces the same limit. */
export const RECIPIENTS_MAX = 1000;

/** The addresses in a comma-separated list, trimmed, empty entries dropped. */
export const addressesOf = (raw: string): string[] =>
  raw
    .split(',')
    .map((address) => address.trim())
    .filter((address) => address !== '');

/** What is wrong with a typed list, or null when the server will take it. */
export function recipientsProblem(raw: string): string | null {
  const addresses = addressesOf(raw);
  const bad = addresses.filter((address) => !EMAIL.test(address));
  if (bad.length > 0) return `Not an address: ${bad.map((a) => `"${a}"`).join(', ')}. Use bare addresses like techs@district.example, comma-separated.`;
  if (addresses.join(', ').length > RECIPIENTS_MAX) return `Too long to store (${RECIPIENTS_MAX} characters at most): use a distribution list.`;
  return null;
}
