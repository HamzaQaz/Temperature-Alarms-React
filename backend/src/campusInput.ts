/** What a Campus needs before it can be inserted: the rules the API and the legacy migration share. */

const NAME_MAX = 100;
const SHORTCODE_MAX = 20;

/** Normalised campus input, or the message explaining why the body is not one. */
export function parseCampus(body: unknown): { name: string; shortcode: string } | { error: string } {
  const { name, shortcode } = (body ?? {}) as Record<string, unknown>;
  if (typeof name !== 'string' || name.trim() === '') return { error: 'A campus needs a name' };
  if (typeof shortcode !== 'string' || shortcode.trim() === '') return { error: 'A campus needs a shortcode' };
  if (name.trim().length > NAME_MAX) return { error: `The name must be at most ${NAME_MAX} characters` };
  if (shortcode.trim().length > SHORTCODE_MAX) {
    return { error: `The shortcode must be at most ${SHORTCODE_MAX} characters` };
  }
  return { name: name.trim(), shortcode: shortcode.trim().toUpperCase() };
}
