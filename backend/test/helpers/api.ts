import type { RunningServer } from './server';
import { TEST_ADMIN_TOKEN } from './server';

export interface Campus {
  id: number;
  name: string;
  shortcode: string;
}

export interface Device {
  id: number;
  hostname: string;
  closet: string;
  campus: Campus;
}

/** A JSON request carrying the Admin token, with any header overridable. */
export const asAdmin = (init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TEST_ADMIN_TOKEN}`, ...init.headers },
});

export const json = async <T>(response: Response): Promise<T> => (await response.json()) as T;

export const errorOf = async (response: Response): Promise<string> => (await json<{ error: string }>(response)).error;

/** The API as the tests drive it: every call goes over HTTP against the running server. */
export function api(server: RunningServer) {
  const post = (path: string, body: unknown, init: RequestInit = asAdmin()) =>
    fetch(`${server.url}${path}`, { ...init, method: 'POST', body: JSON.stringify(body) });
  return {
    campuses: {
      url: (path = '') => `${server.url}/api/campuses${path}`,
      list: async () => json<Campus[]>(await fetch(`${server.url}/api/campuses`)),
      add: (body: unknown, init?: RequestInit) => post('/api/campuses', body, init),
      /** Adds a campus that is expected to succeed and returns it. */
      create: async (name = 'Central High School', shortcode = 'CHS') =>
        json<Campus>(await post('/api/campuses', { name, shortcode })),
    },
    devices: {
      url: (path = '') => `${server.url}/api/devices${path}`,
      list: async () => json<Device[]>(await fetch(`${server.url}/api/devices`)),
      add: (body: unknown, init?: RequestInit) => post('/api/devices', body, init),
    },
  };
}
