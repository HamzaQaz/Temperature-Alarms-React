import type { ComponentType } from 'react';

/**
 * History's code, loaded once. The dashboard fetches it while idle; once it is here, the lazy
 * route below resolves in the same render instead of suspending, so a card's History opens
 * without a fallback frame and the move from the card has a header to land on.
 */
type HistoryModule = { default: ComponentType };

let loaded: HistoryModule | undefined;

export function loadHistory(): Promise<HistoryModule> {
  return import('./History').then((module) => (loaded = module));
}

/**
 * For React.lazy: when the module is already here, a thenable that calls back synchronously
 * (React reads it as resolved and renders at once); otherwise the import itself. React only
 * ever calls `then` on what lazy returns, so the narrower object is typed as the Promise it stands for.
 */
export function historyModule(): Promise<HistoryModule> {
  const ready = loaded;
  if (ready === undefined) return loadHistory();
  const settled: PromiseLike<HistoryModule> = {
    then: (onFulfilled) => Promise.resolve(onFulfilled ? onFulfilled(ready) : ready) as never,
  };
  return settled as Promise<HistoryModule>;
}
