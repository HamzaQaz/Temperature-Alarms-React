/** Wire types: the API's camelCase shape is the only contract. */

export interface Campus {
  id: number;
  name: string;
  shortcode: string;
}

/** A Device as the API lists it, with the Campus it belongs to. */
export interface Device {
  id: number;
  hostname: string;
  closet: string;
  campus: Campus;
}

// The types below still describe the legacy routes and are replaced by later tickets.

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
