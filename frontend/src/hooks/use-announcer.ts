import { useCallback, useEffect, useRef, useState } from 'react';
import { createAnnouncer, type Announcement, type Announcer } from '@/lib/announce';

/** At most one message per this long: a district's stream must not keep a screen reader talking. */
const GAP_MS = 10_000;

/**
 * The text of a page's polite live region, and a way to add to it. Render the text in an element
 * with `aria-live="polite"` that is on the page from the start (see LiveAnnouncement).
 */
export function useAnnouncer(): { message: string; announce: (announcement: Announcement) => void } {
  const [message, setMessage] = useState('');
  const announcer = useRef<Announcer | null>(null);
  useEffect(() => {
    const created = createAnnouncer({ gapMs: GAP_MS, say: setMessage });
    announcer.current = created;
    return () => {
      created.dispose();
      announcer.current = null;
    };
  }, []);
  const announce = useCallback((announcement: Announcement) => announcer.current?.push(announcement), []);
  return { message, announce };
}
