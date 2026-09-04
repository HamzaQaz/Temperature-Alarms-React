import type { DatabaseConfig } from './db';

/** Everything the backend reads from the environment, read once at startup. */
export interface Config {
  port: number;
  /** Browser origin allowed by CORS. Undefined means no browser origin is allowed. */
  corsOrigin: string | undefined;
  database: DatabaseConfig;
  /** Shared secret that authorises changes to Devices, Campuses, and history. */
  adminToken: string;
  /** Shared secret every Device sends with each Reading. */
  deviceToken: string;
  /** How often a healthy Device sends a Reading. */
  reportIntervalSeconds: number;
  /** How long raw Readings are kept before the retention job deletes them. */
  retentionDays: number;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const REQUIRED = ['DB_USER', 'DB_PASSWORD', 'DB_NAME', 'ADMIN_TOKEN', 'DEVICE_TOKEN'] as const;

type Env = Record<string, string | undefined>;

function present(env: Env, name: string): string | undefined {
  const value = env[name];
  return value === undefined || value.trim() === '' ? undefined : value;
}

function required(env: Env, name: string): string {
  const value = present(env, name);
  if (value === undefined) throw new ConfigError(`Missing required environment variable: ${name}`);
  return value;
}

function positiveInteger(env: Env, name: string, fallback: number): number {
  const raw = present(env, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new ConfigError(`${name} must be a positive integer, got "${raw}"`);
  }
  return value;
}

/** Build the config from an environment, throwing a ConfigError that names every problem. */
export function loadConfig(env: Env = process.env): Config {
  const missing = REQUIRED.filter((name) => present(env, name) === undefined);
  if (missing.length > 0) {
    throw new ConfigError(`Missing required environment variable${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`);
  }
  return {
    port: positiveInteger(env, 'PORT', 3001),
    corsOrigin: present(env, 'CORS_ORIGIN'),
    database: {
      host: present(env, 'DB_HOST') ?? 'localhost',
      port: positiveInteger(env, 'DB_PORT', 3306),
      user: required(env, 'DB_USER'),
      password: required(env, 'DB_PASSWORD'),
      database: required(env, 'DB_NAME'),
    },
    adminToken: required(env, 'ADMIN_TOKEN'),
    deviceToken: required(env, 'DEVICE_TOKEN'),
    reportIntervalSeconds: positiveInteger(env, 'REPORT_INTERVAL_SECONDS', 30),
    retentionDays: positiveInteger(env, 'RETENTION_DAYS', 90),
  };
}
