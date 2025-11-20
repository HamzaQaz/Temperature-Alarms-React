import type { Device, Location, Alarm, TemperatureData, DashboardData } from './types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:3001';

// ==================== DEVICE API ====================

export const getDevices = async (): Promise<Device[]> => {
  const response = await fetch(`${API_BASE_URL}/api/devices`);
  if (!response.ok) throw new Error('Failed to fetch devices');
  return response.json();
};

export const addDevice = async (name: string, campus: string, location: string): Promise<Device> => {
  const response = await fetch(`${API_BASE_URL}/api/devices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, campus, location })
  });
  if (!response.ok) throw new Error('Failed to add device');
  return response.json();
};

export const deleteDevice = async (id: number, name: string): Promise<void> => {
  const response = await fetch(`${API_BASE_URL}/api/devices/${id}?name=${name}`, {
    method: 'DELETE'
  });
  if (!response.ok) throw new Error('Failed to delete device');
};

// ==================== LOCATION API ====================

export const getLocations = async (): Promise<Location[]> => {
  const response = await fetch(`${API_BASE_URL}/api/locations`);
  if (!response.ok) throw new Error('Failed to fetch locations');
  return response.json();
};

export const addLocation = async (name: string, shortcode: string): Promise<Location> => {
  const response = await fetch(`${API_BASE_URL}/api/locations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, shortcode })
  });
  if (!response.ok) throw new Error('Failed to add location');
  return response.json();
};

export const deleteLocation = async (id: number): Promise<void> => {
  const response = await fetch(`${API_BASE_URL}/api/locations/${id}`, {
    method: 'DELETE'
  });
  if (!response.ok) throw new Error('Failed to delete location');
};

// ==================== ALARM API ====================

export const getAlarms = async (): Promise<Alarm[]> => {
  const response = await fetch(`${API_BASE_URL}/api/alarms`);
  if (!response.ok) throw new Error('Failed to fetch alarms');
  return response.json();
};

export const addAlarm = async (email: string, temp: number): Promise<Alarm> => {
  const response = await fetch(`${API_BASE_URL}/api/alarms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, temp })
  });
  if (!response.ok) throw new Error('Failed to add alarm');
  return response.json();
};

export const deleteAlarm = async (id: number): Promise<void> => {
  const response = await fetch(`${API_BASE_URL}/api/alarms/${id}`, {
    method: 'DELETE'
  });
  if (!response.ok) throw new Error('Failed to delete alarm');
};

// ==================== TEMPERATURE DATA API ====================

export const getTemperature = async (deviceName: string): Promise<TemperatureData> => {
  const response = await fetch(`${API_BASE_URL}/api/temperature/${deviceName}`);
  if (!response.ok) throw new Error('Failed to fetch temperature');
  return response.json();
};

export const getTemperatureHistory = async (deviceName: string, date?: string): Promise<TemperatureData[]> => {
  const url = date 
    ? `${API_BASE_URL}/api/temperature/${deviceName}/history?date=${date}`
    : `${API_BASE_URL}/api/temperature/${deviceName}/history`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Failed to fetch temperature history');
  return response.json();
};

export const resetTemperatureHistory = async (deviceName: string): Promise<void> => {
  const response = await fetch(`${API_BASE_URL}/api/temperature/${deviceName}/history`, {
    method: 'DELETE'
  });
  if (!response.ok) throw new Error('Failed to reset temperature history');
};

export const getDashboardData = async (filter?: string): Promise<DashboardData[]> => {
  const url = filter 
    ? `${API_BASE_URL}/api/dashboard?filter=${filter}`
    : `${API_BASE_URL}/api/dashboard`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Failed to fetch dashboard data');
  return response.json();
};
