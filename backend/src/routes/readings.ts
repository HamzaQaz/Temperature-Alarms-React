import { Router } from 'express';
import type { AppDeps } from '../deps';

/** Reading ingest (POST /api/readings). Filled in by ticket 06. */
export function readingsRouter(_deps: AppDeps): Router {
  return Router();
}

/** Dashboard and its SSE stream (GET /api/dashboard, /api/dashboard/stream). Filled in by tickets 07 and 09. */
export function dashboardRouter(_deps: AppDeps): Router {
  return Router();
}
