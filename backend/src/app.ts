import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import type { AppDeps, RouteDeps } from './deps';
import { createBroadcaster } from './sse';
import { corsMiddleware, CorsError } from './cors';
import { healthRouter } from './routes/health';
import { campusesRouter } from './routes/campuses';
import { devicesRouter } from './routes/devices';
import { readingsRouter, dashboardRouter, historyRouter } from './routes/readings';

/** The Express app, without a listening socket, so tests can drive it directly. */
export function createApp(appDeps: AppDeps): Express {
  const deps: RouteDeps = { ...appDeps, sse: appDeps.sse ?? createBroadcaster() };
  const app = express();
  app.set('trust proxy', true);
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
    }),
  );

  app.use('/api/health', healthRouter(deps.pool));
  app.use('/api/campuses', campusesRouter(deps));
  app.use('/api/devices/:id/history', historyRouter(deps));
  app.use('/api/devices', devicesRouter(deps));
  app.use('/api/readings', readingsRouter(deps));
  app.use('/api/dashboard', dashboardRouter(deps));

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
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
