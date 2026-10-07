/** Who acknowledged an incident, as POST /api/incidents/:id/acknowledge takes it (CONTEXT.md, Acknowledgement). */

/** The column's width, in characters. */
export const ACKNOWLEDGED_BY_MAX = 60;

/**
 * Control characters, C0 and C1 and DEL, the Unicode line and paragraph separators (U+2028,
 * U+2029), and the marks that reorder text (bidi embeddings, overrides, and isolates). The name
 * goes into emails and every open Dashboard, where a line break could start a header-looking
 * line and a reordering mark could disguise what it says.
 */
const REFUSED = /[\p{Cc}\p{Zl}\p{Zp}\u202A-\u202E\u2066-\u2069]/u;

/**
 * The trimmed name or short note, or the message explaining why it is not one. Free text, since
 * there are no user accounts: a name ("Sam"), or a note ("Sam, on the way"), 1 to 60 characters.
 */
export function parseAcknowledgement(body: unknown): { by: string } | { error: string } {
  const { by } = (body ?? {}) as Record<string, unknown>;
  if (typeof by !== 'string' || by.trim() === '') return { error: 'Give a name, or a short note, to acknowledge the incident with' };
  const name = by.trim();
  // Characters as MySQL counts them, so an accented name is not cut short by its bytes.
  if ([...name].length > ACKNOWLEDGED_BY_MAX) return { error: `The name must be at most ${ACKNOWLEDGED_BY_MAX} characters` };
  if (REFUSED.test(name)) return { error: 'The name cannot hold control characters or line breaks' };
  return { by: name };
}
