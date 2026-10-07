import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import type { Config } from './config';

function bearerToken(header: string | undefined): string | undefined {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? '');
  return match?.[1]?.trim();
}

/**
 * The Device token from either form a board sends: `Bearer <token>` with Readings, or Basic
 * credentials `device:<token>` with the firmware check, whose library can only send Basic.
 */
function deviceCredential(header: string | undefined): string | undefined {
  const bearer = bearerToken(header);
  if (bearer !== undefined) return bearer;
  const basic = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(header?.trim() ?? '');
  if (basic === null) return undefined;
  const decoded = Buffer.from(basic[1], 'base64').toString('utf8');
  return decoded.startsWith('device:') ? decoded.slice('device:'.length) : undefined;
}

/** Every token is compared as a SHA-256 digest: the same length whatever was sent, so not even its length leaks. */
const digest = (token: string): Buffer => createHash('sha256').update(token).digest();

/** Stands in for an unset token, so a check does the same work either way. Nothing can match it. */
const NO_TOKEN = randomBytes(32);

const tokensMatch = (presented: Buffer, expected: Buffer): boolean => timingSafeEqual(presented, expected);

/** The only place a shared token is checked (docs/adr/0003). */
function requireBearerToken(expected: string): RequestHandler {
  const want = digest(expected);
  return (req, res, next) => {
    const presented = bearerToken(req.header('authorization'));
    if (presented !== undefined && tokensMatch(digest(presented), want)) {
      next();
      return;
    }
    res.status(401).json({ error: 'Not authorised' });
  };
}

/** Which Device token a request carries: the current one, the one a rotation is retiring, or neither. */
export type DeviceTokenMatch = 'current' | 'previous' | undefined;

/**
 * Checks a request against both Device tokens. Both comparisons always run, in constant time, and
 * their results are combined without a branch, so the time taken never says which one matched.
 */
export function deviceTokenMatcher(config: Config): (req: Request) => DeviceTokenMatch {
  const current = digest(config.deviceToken);
  const previous = config.deviceTokenPrevious === undefined ? NO_TOKEN : digest(config.deviceTokenPrevious);
  return (req) => {
    const token = deviceCredential(req.header('authorization'));
    if (token === undefined) return undefined;
    const presented = digest(token);
    const which = Number(tokensMatch(presented, current)) | (Number(tokensMatch(presented, previous)) << 1);
    return which === 0 ? undefined : which === 1 ? 'current' : 'previous';
  };
}

/** Guards every route that changes Campuses, Devices, or history. */
export const requireAdminToken = (config: Config): RequestHandler => requireBearerToken(config.adminToken);

/** What the Device token check found, for the route behind it (requireDeviceToken). */
export const deviceTokenOf = (res: Response): Exclude<DeviceTokenMatch, undefined> => res.locals.deviceToken as 'current' | 'previous';

/** Guards the Reading ingest route: the Device token, or during a rotation the previous one too. */
export const requireDeviceToken = (config: Config): RequestHandler => {
  const match = deviceTokenMatcher(config);
  return (req, res, next) => {
    const which = match(req);
    if (which === undefined) {
      res.status(401).json({ error: 'Not authorised' });
      return;
    }
    res.locals.deviceToken = which;
    next();
  };
};

/** Whether a request carries a Device token (either, during a rotation), for the ingest route's refusal limit. */
export const hasDeviceToken = (config: Config): ((req: Request) => boolean) => {
  const match = deviceTokenMatcher(config);
  return (req) => match(req) !== undefined;
};
