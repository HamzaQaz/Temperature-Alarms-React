/** Wire types: the API's camelCase shape is the only contract. */

export interface Campus {
  id: number;
  name: string;
  shortcode: string;
}

// The types below still describe the legacy routes and are replaced by later tickets.

export interface Device {
  ID: number;
  Name: string;
  Campus: string;
  Location: string;
}

export interface Alarm {
  ID: number;
  EMAIL: string;
  TEMP: number;
}

export interface TemperatureData {
  ID: number;
  CAMPUS: string;
  LOCATION: string;
  DATE: string;
  TIME: string;
  TEMP: number;
  HUMIDITY: number | null;
}

export interface DashboardData {
  id: number;
  name: string;
  campus: string;
  location: string;
  temperature: number | null;
  humidity: number | null;
  date: string | null;
  time: string | null;
}
