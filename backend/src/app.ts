import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import type { AppDeps, RouteDeps } from './deps';
import { createBroadcaster } from './sse';
import { corsMiddleware, CorsError } from './cors';
import { healthRouter } from './routes/health';
import { campusesRouter } from './routes/campuses';
import { campusOverviewRouter } from './routes/campusOverview';
import { devicesRouter } from './routes/devices';
import { readingsRouter, dashboardRouter, historyRouter } from './routes/readings';
import { incidentsRouter } from './routes/incidents';

/** The Express app, without a listening socket, so tests can drive it directly. */
export function createApp(appDeps: AppDeps): Express {
  const deps: RouteDeps = { ...appDeps, sse: appDeps.sse ?? createBroadcaster() };
  const app = express();
  // Naming the framework only helps someone matching it to an advisory.
  app.disable('x-powered-by');
  // One hop: nginx (the stack's web service, or the manual install's). nginx appends the address it
  // saw to whatever X-Forwarded-For the client sent, so only that last entry can be believed.
  app.set('trust proxy', 1);
  app.use(corsMiddleware(deps.config));
  app.use(express.json());

  app.use(
    '/api/',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 500,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many requests from this IP, please try again later.' },
      validate: false,
      // Readings have their own limit per Device (routes/readings.ts). Sixteen boards behind one
      // campus address would exhaust a per-address allowance at one Reading each per 30 seconds.
      skip: (req) => req.method === 'POST' && req.path === '/readings',
    }),
  );

  app.use('/api/health', healthRouter(deps.pool));
  app.use('/api/campuses/overview', campusOverviewRouter(deps));
  app.use('/api/campuses', campusesRouter(deps));
  app.use('/api/devices/:id/history', historyRouter(deps));
  app.use('/api/devices', devicesRouter(deps));
  app.use('/api/readings', readingsRouter(deps));
  app.use('/api/dashboard', dashboardRouter(deps));
  app.use('/api/incidents', incidentsRouter(deps));

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof CorsError) {
      res.status(403).json({ error: err.message });
      return;
    }
    if (err instanceof SyntaxError && 'status' in err && err.status === 400) {
      res.status(400).json({ error: 'Malformed JSON body' });
      return;
    }
    if (isClientHttpError(err)) {
      // The body parser's own refusals (413 too large, 415 unsupported charset, ...) keep their status.
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

/** An http-errors 4xx, as the body parser throws them, whose message is meant for the client. */
function isClientHttpError(err: unknown): err is { status: number; message: string } {
  if (typeof err !== 'object' || err === null) return false;
  const { status, expose } = err as { status?: unknown; expose?: unknown };
  return expose === true && typeof status === 'number' && status >= 400 && status < 500;
}
