import { Router } from 'express';
import type { RouteDeps } from '../deps';

/**
 * GET /api/health — 200 when a query reaches the database and Readings are being stored; 503 when
 * the database cannot be reached, or when it answers but the latest Reading could not be written
 * (a full disk, ingestHealth.ts).
 */
export function healthRouter({ pool, ingest }: Pick<RouteDeps, 'pool' | 'ingest'>): Router {
  const router = Router();
  router.get('/', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
    } catch (error) {
      console.error('Health check failed:', error);
      res.status(503).json({ status: 'error', database: 'disconnected' });
      return;
    }
    if (ingest.failing()) {
      res.status(503).json({ status: 'error', database: 'connected', ingest: 'failing' });
      return;
    }
    res.json({ status: 'ok', database: 'connected' });
  });
  return router;
}
