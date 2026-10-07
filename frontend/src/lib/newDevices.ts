import type { PendingDevice } from '../types.ts';

/** A board as the pop-up remembers it: the same hostname forgotten and back again pops up anew. */
export const promptKey = (board: PendingDevice): string => `${board.hostname}@${board.firstSeen}`;

/** The waiting boards the pop-up should announce: not ignored in Settings, and not already waved off here. */
export function boardsToAnnounce(pending: PendingDevice[], dismissed: ReadonlySet<string>): PendingDevice[] {
  return pending.filter((board) => !board.ignored && !dismissed.has(promptKey(board)));
}
