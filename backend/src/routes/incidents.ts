import { Router, type Request } from 'express';
import type { RouteDeps } from '../deps';
import { incidentsOverlapping } from '../incidentStore';

/** The longest window one request may ask for: a week, and a day to spare for the edges. */
export const MAX_WINDOW_DAYS = 8;
const DAY_MS = 86_400_000;

interface Window {
  from: Date;
  to: Date;
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function instant(query: Request['query'], name: string): Date | { error: string } {
  const raw = query[name];
  if (typeof raw !== 'string' || raw.trim() === '') return { error: `${name} is required, an ISO instant like 2026-10-05T06:00:00Z` };
  const value = raw.trim();
  const date = new Date(value);
  if (!ISO_INSTANT.test(value) || Number.isNaN(date.getTime())) return { error: `${name} must be an ISO instant with a zone, like 2026-10-05T06:00:00Z; got ${value}` };
  return date;
}

/** The window asked for by `?from=` and `?to=`, or the message explaining why there is none. */
function parseWindow(query: Request['query']): Window | { error: string } {
  const from = instant(query, 'from');
  if ('error' in from) return from;
  const to = instant(query, 'to');
  if ('error' in to) return to;
  if (from.getTime() >= to.getTime()) return { error: 'from must be before to' };
  if (to.getTime() - from.getTime() > MAX_WINDOW_DAYS * DAY_MS) return { error: `The window can be at most ${MAX_WINDOW_DAYS} days` };
  return { from, to };
}

/**
 * Incident log (GET /api/incidents?from=&to=): every incident that overlaps the window, the
 * ongoing ones included, oldest first. Public, like the dashboard.
 */
export function incidentsRouter({ pool }: RouteDeps): Router {
  const router = Router();

  router.get('/', async (req, res, next) => {
    const window = parseWindow(req.query);
    if ('error' in window) {
      res.status(422).json({ error: window.error });
      return;
    }
    try {
      const incidents = await incidentsOverlapping(pool, window.from, window.to);
      res.json({ from: window.from.toISOString(), to: window.to.toISOString(), incidents });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
