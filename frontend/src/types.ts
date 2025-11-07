export interface Device {
  ID: number;
  Name: string;
  Campus: string;
  Location: string;
}

export interface Location {
  ID: number;
  NAME: string;
  SHORTCODE: string;
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
}

export interface DashboardData {
  id: number;
  name: string;
  campus: string;
  location: string;
  temperature: number | null;
  date: string | null;
  time: string | null;
}
