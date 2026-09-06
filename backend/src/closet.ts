/** The two kinds of Closet, read off the front of its name (docs: CONTEXT.md, IDF / MDF). */
export type ClosetType = 'IDF' | 'MDF';

/** `IDF 2` → IDF, `mdf` → MDF; anything else is untagged. */
export function closetType(closet: string): ClosetType | null {
  const upper = closet.trim().toUpperCase();
  if (upper.startsWith('IDF')) return 'IDF';
  if (upper.startsWith('MDF')) return 'MDF';
  return null;
}
