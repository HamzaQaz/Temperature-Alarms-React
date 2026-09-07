import type { RunningServer } from './server';
import { TEST_ADMIN_TOKEN, TEST_DEVICE_TOKEN } from './server';

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

export interface Reading {
  tempF: number;
  humidity: number | null;
  recordedAt: string;
}

export interface RecordedReading {
  device: string;
  reading: Reading;
}

export interface Condition {
  name: 'Hot' | 'Cold' | 'Dry' | 'Mold risk' | 'Offline';
  level: 'critical' | 'high' | 'warning' | 'moderate';
}

export interface DashboardDevice {
  id: number;
  hostname: string;
  campus: Campus;
  closet: string;
  closetType: 'IDF' | 'MDF' | null;
  latestReading: Reading | null;
  online: boolean;
  secondsSinceReading: number | null;
  /** Every Condition the Device is in, worst first. */
  conditions: Condition[];
}

export interface DaySummary {
  min: number;
  max: number;
  /** To one decimal place. */
  avg: number;
}

/** One local day of a Device's Readings, oldest first, with the day's numbers. */
export interface History {
  device: {
    id: number;
    hostname: string;
    closet: string;
    closetType: 'IDF' | 'MDF' | null;
    campus: Campus;
  };
  /** The day asked for, YYYY-MM-DD. */
  date: string;
  /** The IANA zone the day was cut in. */
  timeZone: string;
  /** The day's bounds as UTC instants: from inclusive, to exclusive. */
  from: string;
  to: string;
  readings: Reading[];
  summary: {
    tempF: DaySummary | null;
    humidity: DaySummary | null;
  };
}

export interface Dashboard {
  reportIntervalSeconds: number;
  /** Three Report intervals: how long without a Reading before a Device is Offline. */
  offlineAfterSeconds: number;
  devices: DashboardDevice[];
}

/** A JSON request carrying a bearer token, with any header overridable. */
const asBearer =
  (token: string) =>
  (init: RequestInit = {}): RequestInit => ({
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...init.headers },
  });

/** A JSON request as the admin (Settings page) would send it. */
export const asAdmin = asBearer(TEST_ADMIN_TOKEN);

/** A JSON request as a Device would send it. */
export const asDevice = asBearer(TEST_DEVICE_TOKEN);

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
      /** Adds a device that is expected to succeed and returns it. */
      create: async (campusId: number, hostname = 'ESP_A1B2C3', closet = 'IDF 2') =>
        json<Device>(await post('/api/devices', { hostname, campusId, closet })),
      /** One day of a Device's history. `query` is appended verbatim, e.g. `?date=2026-09-05&tz=America/Chicago`. */
      history: (id: number, query = '') => fetch(`${server.url}/api/devices/${id}/history${query}`),
      /** Deletes every Reading the Device has, as the admin unless init says otherwise. */
      resetHistory: (id: number, init: RequestInit = asAdmin()) =>
        fetch(`${server.url}/api/devices/${id}/history`, { ...init, method: 'DELETE' }),
    },
    readings: {
      url: (path = '') => `${server.url}/api/readings${path}`,
      /** Posts a reading as a Device would: with the Device token unless init says otherwise. */
      add: (body: unknown, init: RequestInit = asDevice()) => post('/api/readings', body, init),
    },
    dashboard: {
      url: (query = '') => `${server.url}/api/dashboard${query}`,
      /** The dashboard, optionally filtered by campus shortcode. */
      get: async (campus?: string) => {
        const query = campus === undefined ? '' : `?campus=${encodeURIComponent(campus)}`;
        return json<Dashboard>(await fetch(`${server.url}/api/dashboard${query}`));
      },
    },
  };
}
