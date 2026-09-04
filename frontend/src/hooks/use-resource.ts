import { useCallback, useEffect, useState } from 'react';
import { describeError } from '@/api';

export type ResourceState<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; message: string };

/**
 * Load one resource and expose loading, ready, and error states plus a reload.
 * A reload keeps the current data on screen instead of flashing a skeleton.
 * `load` must be a stable function (a module-level API call, not an inline closure).
 */
export function useResource<T>(load: () => Promise<T>): { state: ResourceState<T>; reload: () => Promise<void> } {
  const [state, setState] = useState<ResourceState<T>>({ status: 'loading' });

  const reload = useCallback(async () => {
    setState((current) => (current.status === 'ready' ? current : { status: 'loading' }));
    try {
      const data = await load();
      setState({ status: 'ready', data });
    } catch (error) {
      setState({ status: 'error', message: describeError(error) });
    }
  }, [load]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { state, reload };
}
