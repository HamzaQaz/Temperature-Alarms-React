import cors from 'cors';
import type { RequestHandler } from 'express';
import type { Config } from './config';

/**
 * The one CORS policy for every route, SSE included. Requests without an Origin
 * (curl, firmware, monitors) pass; browsers pass only from the configured origin.
 */
export function corsMiddleware(config: Config): RequestHandler {
  return cors({
    origin: (origin, callback) => {
      if (!origin || origin === config.corsOrigin) {
        callback(null, true);
      } else {
        callback(new CorsError(origin));
      }
    },
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
}

export class CorsError extends Error {
  constructor(origin: string) {
    super(`Origin ${origin} is not allowed`);
    this.name = 'CorsError';
  }
}
