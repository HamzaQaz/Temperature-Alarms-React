import type { Request, RequestHandler } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { deviceTokenMatcher, hasDeviceToken } from './auth';
import type { Config } from './config';
import type { DeviceSightings } from './deviceSightings';
import { MonotonicStore } from './monotonicStore';
import { HOSTNAME } from './pendingDevices';

/**
 * How many requests with a missing or wrong Device token one address may make in 15 minutes. A board
 * with a wrong token retries every Report interval, 30 a quarter hour, so a few such boards behind one
 * campus address stay under it; a guesser gets 400 an hour, against a 256-bit token from deploy.sh.
 */
export const DEVICE_AUTH_FAILURE_LIMIT = 100;

/**
 * The hostname a refused request claims: a Reading's `device`, or the firmware check's MAC. Only for
 * flagging the token mismatch on a registered Device (deviceSightings.ts); nothing is trusted from it.
 */
function claimedHostname(req: Request): string | undefined {
  const device = (req.body as Record<string, unknown> | undefined)?.device;
  if (typeof device === 'string') {
    const hostname = device.trim().replace(/-/g, '_').toUpperCase();
    return HOSTNAME.test(hostname) ? hostname : undefined;
  }
  const mac = req.header('x-esp8266-sta-mac') ?? '';
  return /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i.test(mac) ? `ESP_${mac.replace(/:/g, '').slice(-6).toUpperCase()}` : undefined;
}

/**
 * What every route a Device calls runs first (Readings, the firmware check): the wrong-token limit,
 * one per address across all of them, then the Device token. Made once per app, so a guesser cannot
 * get a fresh allowance by switching route.
 */
export function createDeviceAuth(config: Config, sightings: DeviceSightings): RequestHandler[] {
  // The general /api/ limit skips the Readings route, so refusals get their own: per address, since a guesser
  // can claim any hostname. Only a request with a missing or wrong token is counted, and it is
  // answered at once with a 401. A request with the right token is never counted: not a campus of
  // boards behind one address, and not the Readings boards gave up on while the database stalled
  // (express-rate-limit counts on arrival and takes back on finish, so a hundred stalled right-token
  // POSTs in flight at once would otherwise lock their own address out; resilience.md B1).
  const isDevice = hasDeviceToken(config);
  const addressKey = (req: Request): string => ipKeyGenerator(req.ip ?? '');
  const authFailureMessage = { error: 'Too many requests with a wrong Device token from this address, please try again later.' };
  const authFailureLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: DEVICE_AUTH_FAILURE_LIMIT,
    store: new MonotonicStore(),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: addressKey,
    skip: isDevice,
    message: authFailureMessage,
    validate: false,
  });
  // Past the limit even the right token is refused from that address, or the 429 would tell a
  // guesser which guess was right.
  const refuseLockedOutAddress: RequestHandler = async (req, res, next) => {
    try {
      const counted = isDevice(req) ? await authFailureLimiter.getKey(addressKey(req)) : undefined;
      if (counted !== undefined && counted.totalHits >= DEVICE_AUTH_FAILURE_LIMIT) {
        if (counted.resetTime !== undefined) {
          res.set('Retry-After', String(Math.max(0, Math.ceil((counted.resetTime.getTime() - Date.now()) / 1000))));
        }
        res.status(429).json(authFailureMessage);
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };

  // The Device token, or during a rotation the previous one; a refusal flags the hostname it claimed.
  const match = deviceTokenMatcher(config);
  const requireToken: RequestHandler = (req, res, next) => {
    const which = match(req);
    if (which === undefined) {
      const claimed = claimedHostname(req);
      if (claimed !== undefined) sightings.mismatch(claimed);
      res.status(401).json({ error: 'Not authorised' });
      return;
    }
    res.locals.deviceToken = which;
    next();
  };

  return [refuseLockedOutAddress, authFailureLimiter, requireToken];
}
