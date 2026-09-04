import { Router } from 'express';
import type { Pool } from 'mysql2/promise';

/** GET /api/health — 200 when a query reaches the database, 503 otherwise. */
export function healthRouter(pool: Pool): Router {
  const router = Router();
  router.get('/', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', database: 'connected' });
    } catch (error) {
      console.error('Health check failed:', error);
      res.status(503).json({ status: 'error', database: 'disconnected' });
    }
  });
  return router;
}
