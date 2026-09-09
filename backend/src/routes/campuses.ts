import { Router } from 'express';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { requireAdminToken } from '../auth';
import type { AppDeps } from '../deps';
import { parseCampus } from '../campusInput';
import { isDuplicateKey, isForeignKeyInUse } from '../db';

interface CampusRow extends RowDataPacket {
  id: number;
  name: string;
  shortcode: string;
}

/** Campus routes: anyone may list; adding and deleting need the Admin token. */
export function campusesRouter({ pool, config }: AppDeps): Router {
  const router = Router();
  const adminOnly = requireAdminToken(config);

  router.get('/', async (_req, res, next) => {
    try {
      const [rows] = await pool.query<CampusRow[]>('SELECT id, name, shortcode FROM campuses ORDER BY name');
      res.json(rows.map(({ id, name, shortcode }) => ({ id, name, shortcode })));
    } catch (error) {
      next(error);
    }
  });

  router.post('/', adminOnly, async (req, res, next) => {
    const parsed = parseCampus(req.body);
    if ('error' in parsed) {
      res.status(422).json({ error: parsed.error });
      return;
    }
    const { name, shortcode } = parsed;
    try {
      const [result] = await pool.query<ResultSetHeader>('INSERT INTO campuses (name, shortcode) VALUES (?, ?)', [
        name,
        shortcode,
      ]);
      res.status(201).json({ id: result.insertId, name, shortcode });
    } catch (error) {
      if (isDuplicateKey(error)) {
        res.status(409).json({ error: `A campus with the shortcode ${shortcode} already exists` });
        return;
      }
      next(error);
    }
  });

  router.delete('/:id', adminOnly, async (req, res, next) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(404).json({ error: 'Campus not found' });
      return;
    }
    try {
      const [result] = await pool.query<ResultSetHeader>('DELETE FROM campuses WHERE id = ?', [id]);
      if (result.affectedRows === 0) {
        res.status(404).json({ error: 'Campus not found' });
        return;
      }
      res.status(204).end();
    } catch (error) {
      if (isForeignKeyInUse(error)) {
        res.status(409).json({ error: 'This campus still has devices. Delete them first.' });
        return;
      }
      next(error);
    }
  });

  return router;
}
