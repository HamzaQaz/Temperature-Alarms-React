/**
 * The Admin token, remembered in this browser so Settings asks for it once.
 * Reads never send it; the API client attaches it to every mutating call.
 */
const STORAGE_KEY = 'temperature-alarms.admin-token';
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

export function getAdminToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setAdminToken(token: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Private mode or blocked storage: the token lives for this page load only.
  }
  notify();
}

export function clearAdminToken(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing stored to remove.
  }
  notify();
}

/** Subscribe to token changes; returns the unsubscribe function. */
export function subscribeAdminToken(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
