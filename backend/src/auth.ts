import { timingSafeEqual } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import type { Config } from './config';

function bearerToken(header: string | undefined): string | undefined {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? '');
  return match?.[1]?.trim();
}

function tokensMatch(presented: string | undefined, expected: string): boolean {
  if (presented === undefined) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The only place a shared token is checked (docs/adr/0003). */
function requireBearerToken(expected: string): RequestHandler {
  return (req, res, next) => {
    if (tokensMatch(bearerToken(req.header('authorization')), expected)) {
      next();
      return;
    }
    res.status(401).json({ error: 'Not authorised' });
  };
}

/** Guards every route that changes Campuses, Devices, or history. */
export const requireAdminToken = (config: Config): RequestHandler => requireBearerToken(config.adminToken);

/** Guards the Reading ingest route. */
export const requireDeviceToken = (config: Config): RequestHandler => requireBearerToken(config.deviceToken);

/** Whether a request carries the Device token, for the ingest route's refusal limit. */
export const hasDeviceToken =
  (config: Config) =>
  (req: Request): boolean =>
    tokensMatch(bearerToken(req.header('authorization')), config.deviceToken);
