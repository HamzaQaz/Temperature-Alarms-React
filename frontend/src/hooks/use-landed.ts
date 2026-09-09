import { useState } from 'react';

/**
 * How many times `value` has changed since the component mounted. Zero on first render, so
 * data that was already there when the page loaded does not count as something arriving;
 * each later change (a live Reading replacing the last one) counts once. State is adjusted
 * during render, the way React documents for "remember the previous value".
 */
export function useLanded(value: string | undefined): number {
  const [tracked, setTracked] = useState({ value, count: 0 });
  if (tracked.value !== value) {
    setTracked({ value, count: value === undefined ? tracked.count : tracked.count + 1 });
  }
  return tracked.count;
}
