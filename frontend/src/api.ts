import type { Device, Campus, TemperatureData, Dashboard } from './types';
import { getAdminToken } from './lib/adminToken';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:3001';

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
  method?: 'GET' | 'POST' | 'DELETE';
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

// ==================== DEVICES ====================

export const getDevices = (): Promise<Device[]> => request('/api/devices');

export const addDevice = (hostname: string, campusId: number, closet: string): Promise<Device> =>
  request('/api/devices', { method: 'POST', body: { hostname, campusId, closet } });

export const deleteDevice = (id: number): Promise<void> => request(`/api/devices/${id}`, { method: 'DELETE' });

// ==================== DASHBOARD ====================

/** Every Device with its latest Reading, optionally only those at one Campus. */
export const getDashboard = (campus?: string): Promise<Dashboard> =>
  request(`/api/dashboard${campus ? `?campus=${encodeURIComponent(campus)}` : ''}`);

// ==================== HISTORY (legacy shape until ticket 10) ====================

export const getTemperatureHistory = (deviceName: string, date?: string): Promise<TemperatureData[]> =>
  request(
    `/api/temperature/${encodeURIComponent(deviceName)}/history${date ? `?date=${encodeURIComponent(date)}` : ''}`,
  );

export const resetTemperatureHistory = (deviceName: string): Promise<void> =>
  request(`/api/temperature/${encodeURIComponent(deviceName)}/history`, { method: 'DELETE' });
