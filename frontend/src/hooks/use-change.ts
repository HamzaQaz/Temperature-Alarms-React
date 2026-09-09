import { useCallback, useState } from 'react';
import { describeError, UnauthorisedError } from '@/api';

/** How a change ended: done, refused for want of the Admin token, or failed with a message to show. */
export type ChangeResult = { ok: true } | { ok: false; reason: 'unauthorised' | 'failed' };

/**
 * Run a change against the API. A rejected Admin token is routed to `onUnauthorised`
 * so the page can ask for the token; every other failure becomes a message to show inline.
 */
export function useChange(onUnauthorised: () => void) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const run = useCallback(
    async (change: () => Promise<unknown>): Promise<ChangeResult> => {
      setError(null);
      setPending(true);
      try {
        await change();
        return { ok: true };
      } catch (thrown) {
        if (thrown instanceof UnauthorisedError) {
          onUnauthorised();
          return { ok: false, reason: 'unauthorised' };
        }
        setError(describeError(thrown));
        return { ok: false, reason: 'failed' };
      } finally {
        setPending(false);
      }
    },
    [onUnauthorised],
  );

  return { run, error, pending, clearError: () => setError(null) };
}
