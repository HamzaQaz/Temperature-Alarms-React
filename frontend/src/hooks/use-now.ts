import { useEffect, useState } from 'react';
import { monotonicNow } from '@/lib/elapsed';

/** `read()`, re-rendering once a second. */
function useTicking(read: () => number): number {
  const [now, setNow] = useState(read);
  useEffect(() => {
    const timer = setInterval(() => setNow(read()), 1000);
    return () => clearInterval(timer);
  }, [read]);
  return now;
}

/** The current time in milliseconds, re-rendering once a second. For dates and times shown to people. */
export function useNow(): number {
  return useTicking(Date.now);
}

/** The monotonic clock (lib/elapsed.ts), re-rendering once a second. For ageing what the server sent. */
export function useElapsedNow(): number {
  return useTicking(monotonicNow);
}
