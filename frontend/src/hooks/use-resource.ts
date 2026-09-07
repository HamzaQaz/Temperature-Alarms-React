import { useCallback, useEffect, useRef, useState } from 'react';
import { describeError } from '@/api';

export type ResourceState<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; message: string };

/**
 * Load one resource and expose loading, ready, and error states plus a reload.
 * A reload keeps the current data on screen instead of flashing a skeleton;
 * an update changes it in place without a request. An update that lands while a
 * load is in flight is replayed on top of what the load returns, so a live change
 * is never lost to a slower request that started before it.
 * `load` must be a stable function (a module-level API call, not an inline closure).
 */
export function useResource<T>(load: () => Promise<T>): {
  state: ResourceState<T>;
  reload: () => Promise<void>;
  /** Change the loaded data in place (a live update). Applied now if ready, and again on top of any load in flight. */
  update: (change: (data: T) => T) => void;
} {
  const [state, setState] = useState<ResourceState<T>>({ status: 'loading' });
  /** Changes made since the current load began; null when no load is in flight. */
  const inFlight = useRef<Array<(data: T) => T> | null>(null);

  const update = useCallback((change: (data: T) => T) => {
    inFlight.current?.push(change);
    setState((current) => (current.status === 'ready' ? { status: 'ready', data: change(current.data) } : current));
  }, []);

  const reload = useCallback(async () => {
    const changes: Array<(data: T) => T> = [];
    inFlight.current = changes;
    setState((current) => (current.status === 'ready' ? current : { status: 'loading' }));
    try {
      const loaded = await load();
      setState({ status: 'ready', data: changes.reduce<T>((data, change) => change(data), loaded) });
    } catch (error) {
      setState({ status: 'error', message: describeError(error) });
    } finally {
      if (inFlight.current === changes) inFlight.current = null;
    }
  }, [load]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { state, reload, update };
}
