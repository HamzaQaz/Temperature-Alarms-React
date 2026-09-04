import { useCallback, useState } from 'react';
import { describeError, UnauthorisedError } from '@/api';

/**
 * Run a change against the API. A rejected Admin token is routed to `onUnauthorised`
 * so the page can ask for the token; every other failure becomes a message to show inline.
 */
export function useChange(onUnauthorised: () => void) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const run = useCallback(
    async (change: () => Promise<unknown>): Promise<boolean> => {
      setError(null);
      setPending(true);
      try {
        await change();
        return true;
      } catch (thrown) {
        if (thrown instanceof UnauthorisedError) {
          onUnauthorised();
        } else {
          setError(describeError(thrown));
        }
        return false;
      } finally {
        setPending(false);
      }
    },
    [onUnauthorised],
  );

  return { run, error, pending, clearError: () => setError(null) };
}
