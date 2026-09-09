import { Router } from 'express';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { requireAdminToken } from '../auth';
import type { AppDeps } from '../deps';
import { isDuplicateKey, isMissingForeignRow } from '../db';
import { parseDevice } from '../deviceInput';

export interface DeviceRow extends RowDataPacket {
  id: number;
  hostname: string;
  closet: string;
  campusId: number;
  campusName: string;
  campusShortcode: string;
}

/** A Device with its Campus, as every route lists it. Append a WHERE or ORDER BY. */
export const SELECT_DEVICES = `
  SELECT d.id, d.hostname, d.closet,
         c.id AS campusId, c.name AS campusName, c.shortcode AS campusShortcode
  FROM devices d
  JOIN campuses c ON c.id = d.campus_id`;

export function toDevice({ id, hostname, closet, campusId, campusName, campusShortcode }: DeviceRow) {
  return { id, hostname, closet, campus: { id: campusId, name: campusName, shortcode: campusShortcode } };
}

/** Device routes: anyone may list; adding and deleting need the Admin token. */
export function devicesRouter({ pool, config }: AppDeps): Router {
  const router = Router();
  const adminOnly = requireAdminToken(config);

  router.get('/', async (_req, res, next) => {
    try {
      const [rows] = await pool.query<DeviceRow[]>(`${SELECT_DEVICES} ORDER BY c.name, d.closet, d.hostname`);
      res.json(rows.map(toDevice));
    } catch (error) {
      next(error);
    }
  });

  router.post('/', adminOnly, async (req, res, next) => {
    const parsed = parseDevice(req.body);
    if ('error' in parsed) {
      res.status(422).json({ error: parsed.error });
      return;
    }
    const { hostname, campusId, closet } = parsed;
    try {
      const [result] = await pool.query<ResultSetHeader>(
        'INSERT INTO devices (hostname, campus_id, closet) VALUES (?, ?, ?)',
        [hostname, campusId, closet],
      );
      const [rows] = await pool.query<DeviceRow[]>(`${SELECT_DEVICES} WHERE d.id = ?`, [result.insertId]);
      res.status(201).json(toDevice(rows[0]));
    } catch (error) {
      if (isDuplicateKey(error)) {
        res.status(409).json({ error: `A device with the hostname ${hostname} already exists` });
        return;
      }
      if (isMissingForeignRow(error)) {
        res.status(422).json({ error: 'That campus does not exist' });
        return;
      }
      next(error);
    }
  });

  router.delete('/:id', adminOnly, async (req, res, next) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }
    try {
      // Readings go with the device: fk_readings_device is ON DELETE CASCADE.
      const [result] = await pool.query<ResultSetHeader>('DELETE FROM devices WHERE id = ?', [id]);
      if (result.affectedRows === 0) {
        res.status(404).json({ error: 'Device not found' });
        return;
      }
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
