import express, { Router } from 'express';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { requireAdminToken } from '../auth';
import type { RouteDeps } from '../deps';
import { currentRelease, FirmwareImageError, MAX_IMAGE_BYTES, offers, publishFirmware, releaseImage, withdrawFirmware, type FirmwareRelease } from '../firmwareStore';

/** `5C:CF:7F:A1:B2:C3`, as the ESP8266 update library sends its station MAC. */
const MAC = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i;

/** The Device's hostname from its MAC: `ESP_` and the last six hex digits, as the firmware names itself. */
const hostnameOf = (mac: string): string => `ESP_${mac.replace(/:/g, '').slice(-6).toUpperCase()}`;

interface StatusRow extends RowDataPacket {
  id: number;
  hostname: string;
  closet: string;
  campusId: number;
  campusName: string;
  campusShortcode: string;
  firmwareVersion: number | null;
  checkedAt: Date | null;
}

/**
 * Over-the-air firmware (docs/adr/0007). GET /api/firmware is the boards' hourly check, behind the
 * Device token (as Basic `device:<token>`, all the ESP8266 update library can send): 304 when there is
 * nothing newer for that board, else the signed image, which the board verifies before booting it.
 * GET /api/firmware/status is the Admin's view of the release and every Device's version.
 * POST /api/firmware publishes a signed build from the Settings page (`?only=ESP_A,ESP_B` for named
 * Devices first) and DELETE withdraws it, both with the Admin token.
 */
export function firmwareRouter({ pool, config, deviceAuth }: RouteDeps): Router {
  const router = Router();

  router.get('/', ...deviceAuth, async (req, res, next) => {
    const mac = req.header('x-esp8266-sta-mac') ?? '';
    if (!MAC.test(mac)) {
      res.status(400).json({ error: 'A firmware check needs the x-ESP8266-STA-MAC header' });
      return;
    }
    const hostname = hostnameOf(mac);
    const reported = Number(req.header('x-esp8266-version'));
    const version = Number.isInteger(reported) && reported >= 0 ? reported : 0;
    try {
      const [result] = await pool.query<ResultSetHeader>(
        'UPDATE devices SET firmware_version = ?, firmware_checked_at = UTC_TIMESTAMP() WHERE hostname = ?',
        [version, hostname],
      );
      if (result.affectedRows === 0) {
        res.status(404).json({ error: `No device is registered with the hostname ${hostname}` });
        return;
      }
      const release = await currentRelease(pool);
      if (!offers(release, hostname, version)) {
        res.status(304).end();
        return;
      }
      const image = await releaseImage(pool);
      if (image === null || release === null) {
        res.status(304).end();
        return;
      }
      res.set({ 'Content-Type': 'application/octet-stream', 'x-MD5': release.md5, 'Content-Length': String(image.length) });
      res.status(200).end(image);
    } catch (error) {
      next(error);
    }
  });

  const adminOnly = requireAdminToken(config);
  const toJson = (release: FirmwareRelease) => ({ ...release, publishedAt: release.publishedAt.toISOString() });

  router.post('/', adminOnly, express.raw({ type: 'application/octet-stream', limit: MAX_IMAGE_BYTES }), async (req, res, next) => {
    const image = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const only = typeof req.query.only === 'string' && req.query.only.trim() !== '' ? req.query.only.split(',') : undefined;
    try {
      res.status(201).json(toJson(await publishFirmware(pool, image, only)));
    } catch (error) {
      if (error instanceof FirmwareImageError) {
        res.status(422).json({ error: error.message });
        return;
      }
      next(error);
    }
  });

  router.delete('/', adminOnly, async (_req, res, next) => {
    try {
      await withdrawFirmware(pool);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.get('/status', adminOnly, async (_req, res, next) => {
    try {
      const release = await currentRelease(pool);
      const [rows] = await pool.query<StatusRow[]>(`
        SELECT d.id, d.hostname, d.closet, d.firmware_version AS firmwareVersion, d.firmware_checked_at AS checkedAt,
               c.id AS campusId, c.name AS campusName, c.shortcode AS campusShortcode
        FROM devices d JOIN campuses c ON c.id = d.campus_id
        ORDER BY c.name, d.closet, d.hostname`);
      res.json({
        release: release === null ? null : toJson(release),
        devices: rows.map(({ id, hostname, closet, campusId, campusName, campusShortcode, firmwareVersion, checkedAt }) => ({
          id,
          hostname,
          closet,
          campus: { id: campusId, name: campusName, shortcode: campusShortcode },
          firmwareVersion,
          checkedAt: checkedAt === null ? null : checkedAt.toISOString(),
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
