/**
 * A polite live region, hidden from sight, that a screen reader reads when its text changes.
 * It is rendered from the start, empty, because a region that appears with its text is not announced.
 */
export function LiveAnnouncement({ message }: { message: string }) {
  return (
    <p className="sr-only" aria-live="polite" aria-atomic="true">
      {message}
    </p>
  );
}
