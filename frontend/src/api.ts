import type { Device, Campus, Dashboard, DashboardOrder, History, Incidents, Overview } from './types';
import { getAdminToken } from './lib/adminToken';
import { apiBaseUrl } from './lib/apiBase';

const API_BASE_URL = apiBaseUrl(import.meta.env.VITE_API_URL);

/** A request the server answered with an error, or one that never reached it (status 0). */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** The server rejected the Admin token (or none was sent). */
export class UnauthorisedError extends ApiError {
  constructor() {
    super(401, 'The Admin token was not accepted');
    this.name = 'UnauthorisedError';
  }
}

/** A message a person can act on, whatever was thrown. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Something went wrong';
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === 'string' && body.error !== '') return body.error;
  } catch {
    // Not JSON; fall through to the status line.
  }
  return `The server answered ${response.status} ${response.statusText}`.trim();
}

/**
 * The one place requests are made. Reads carry no token; anything else carries
 * the stored Admin token and turns a 401 into an UnauthorisedError.
 */
async function request<T>(path: string, { method = 'GET', body }: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') {
    const token = getAdminToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new ApiError(0, 'Could not reach the server', { cause: error });
  }

  if (response.status === 401) throw new UnauthorisedError();
  if (!response.ok) throw new ApiError(response.status, await errorMessage(response));
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// ==================== CAMPUSES ====================

export const getCampuses = (): Promise<Campus[]> => request('/api/campuses');

export const addCampus = (name: string, shortcode: string): Promise<Campus> =>
  request('/api/campuses', { method: 'POST', body: { name, shortcode } });

export const deleteCampus = (id: number): Promise<void> =>
  request(`/api/campuses/${id}`, { method: 'DELETE' });

/** Every Campus worst first, with its last seven days cut in this browser's zone. */
export const getCampusOverview = (): Promise<Overview> =>
  request(`/api/campuses/overview?${new URLSearchParams({ tz: browserTimeZone() })}`);

// ==================== DEVICES ====================

export const getDevices = (): Promise<Device[]> => request('/api/devices');

export const addDevice = (hostname: string, campusId: number, closet: string): Promise<Device> =>
  request('/api/devices', { method: 'POST', body: { hostname, campusId, closet } });

/** What an edit may change. The hostname is not editable: a replaced board is a new Device. */
export interface DeviceEdit {
  closet?: string;
  campusId?: number;
}

/** Correct a Device's Closet or move it to another Campus; its Readings stay. Needs the Admin token. */
export const editDevice = (id: number, changes: DeviceEdit): Promise<Device> =>
  request(`/api/devices/${id}`, { method: 'PATCH', body: changes });

export const deleteDevice = (id: number): Promise<void> => request(`/api/devices/${id}`, { method: 'DELETE' });

// ==================== DASHBOARD ====================

/**
 * Every Device with its latest Reading, optionally only those at one Campus, in the server's
 * order: worst first unless `order` is 'campus' (by Campus name, then closet).
 */
export const getDashboard = (campus?: string, order: DashboardOrder = 'worst'): Promise<Dashboard> => {
  const query = new URLSearchParams();
  if (campus) query.set('campus', campus);
  if (order !== 'worst') query.set('order', order);
  const search = query.toString();
  return request(`/api/dashboard${search ? `?${search}` : ''}`);
};

/**
 * The live stream of Readings (Server-Sent Events). The browser reconnects on its own after
 * a drop; callers watch `readyState` and reload their data once it is open again.
 */
export const openDashboardStream = (): EventSource => new EventSource(`${API_BASE_URL}/api/dashboard/stream`);

// ==================== HISTORY ====================

/** The zone this browser is in, so the server cuts the day where the technician's midnight falls. */
const browserTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** One local day of a Device's Readings with the day's numbers. Today when `date` is omitted. */
export const getHistory = (deviceId: number, date?: string): Promise<History> => {
  const query = new URLSearchParams({ tz: browserTimeZone() });
  if (date) query.set('date', date);
  return request(`/api/devices/${deviceId}/history?${query}`);
};

/** Delete every Reading the Device has. Needs the Admin token. */
export const resetHistory = (deviceId: number): Promise<void> =>
  request(`/api/devices/${deviceId}/history`, { method: 'DELETE' });

// ==================== INCIDENTS ====================

/** Every incident that overlaps the window, ongoing ones included, oldest first. At most eight days. */
export const getIncidents = (from: Date, to: Date): Promise<Incidents> => {
  const query = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
  return request(`/api/incidents?${query}`);
};
