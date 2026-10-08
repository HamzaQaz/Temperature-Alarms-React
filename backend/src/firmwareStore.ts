import { createHash } from 'node:crypto';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { failedToInstall, type HoldReason } from './rollout';

/**
 * The firmware release on offer to Devices (docs/adr/0007): one at a time, published from the build
 * laptop's signed binary with deploy.sh publish-firmware. Boards check for it every hour and take it
 * only when its version is above their own. A release can go to named Devices first and then to
 * every Device; while it is staged, one of the named Devices failing it holds it (rollout.ts).
 */

/** A pool or one of its connections: anything that runs a statement. */
type Db = Pool | PoolConnection;

/** Larger than any build fits: the NodeMCU's sketch area is 1 MB, of which an update needs room twice. */
export const MAX_IMAGE_BYTES = 1024 * 1024;
/** The firmware's version marker (arduino/TemperatureAlarms/version.h), found in the binary itself. */
const VERSION_MARKER = /TA-FIRMWARE-VERSION=(\d{1,9})\0/;
/** An ESP8266 application image starts with this byte. */
const ESP_IMAGE_MAGIC = 0xe9;
/** Signature lengths the build's RSA keys give (2048, 3072, 4096 bits). */
const SIGNATURE_LENGTHS = [256, 384, 512];

export class FirmwareImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FirmwareImageError';
  }
}

export interface FirmwareImage {
  version: number;
  md5: string;
  size: number;
}

/**
 * What a binary is, refusing anything a board should not be offered: not an ESP8266 image, no version
 * marker, or unsigned (the build appends the signature and its length; boards built with public.key
 * refuse an image without one, so offering it would only make every board fail its update).
 */
export function parseFirmwareImage(image: Buffer): FirmwareImage {
  if (image.length === 0 || image.length > MAX_IMAGE_BYTES) {
    throw new FirmwareImageError(`the image is ${image.length} bytes; a firmware image is between 1 byte and ${MAX_IMAGE_BYTES}`);
  }
  if (image[0] !== ESP_IMAGE_MAGIC) throw new FirmwareImageError('this is not an ESP8266 firmware image');
  const signatureLength = image.length >= 4 ? image.readUInt32LE(image.length - 4) : 0;
  if (!SIGNATURE_LENGTHS.includes(signatureLength) || image.length <= signatureLength + 4) {
    throw new FirmwareImageError('the image is not signed: publish the .bin.signed the build writes when private.key is in the sketch folder');
  }
  const marker = VERSION_MARKER.exec(image.toString('latin1'));
  if (marker === null) throw new FirmwareImageError('no FIRMWARE_VERSION marker in the image: is it this project\'s firmware, built after version.h existed?');
  return { version: Number(marker[1]), md5: createHash('md5').update(image).digest('hex'), size: image.length };
}

interface ReleaseRow extends RowDataPacket {
  version: number;
  md5: string;
  size: number;
  onlyHostnames: string | null;
  publishedAt: Date;
  widenedAt: Date | null;
  heldAt: Date | null;
  heldHostname: string | null;
  heldReason: HoldReason | null;
  heldDetail: string | null;
}

/** A staged release stopped by itself: when, which named Device failed it, and why (rollout.ts). */
export interface FirmwareHold {
  at: Date;
  hostname: string;
  reason: HoldReason;
  /** What the board said, for a failed update; null otherwise. */
  detail: string | null;
}

export interface FirmwareRelease {
  version: number;
  md5: string;
  size: number;
  /** The Devices it is offered to, or null for every Device. */
  only: string[] | null;
  /** The named Devices it went to first, kept once it is widened; null when it went to every Device at once. */
  staged: string[] | null;
  /** Offered to named Devices only, or to every Device. */
  stage: 'named' | 'all';
  publishedAt: Date;
  /** When a staged release was opened to every Device; null until then, and for one that went to all at once. */
  widenedAt: Date | null;
  /** Set when one of the named Devices failed it: held, it is offered to no one until withdrawn or replaced by a higher version. */
  hold: FirmwareHold | null;
}

const toRelease = (row: ReleaseRow): FirmwareRelease => {
  const staged = row.onlyHostnames === null ? null : row.onlyHostnames.split(',');
  return {
    version: row.version,
    md5: row.md5,
    size: row.size,
    only: row.widenedAt === null ? staged : null,
    staged,
    stage: staged === null || row.widenedAt !== null ? 'all' : 'named',
    publishedAt: row.publishedAt,
    widenedAt: row.widenedAt,
    hold:
      row.heldAt === null || row.heldHostname === null || row.heldReason === null
        ? null
        : { at: row.heldAt, hostname: row.heldHostname, reason: row.heldReason, detail: row.heldDetail },
  };
};

const RELEASE_COLUMNS = `version, md5, size, only_hostnames AS onlyHostnames, published_at AS publishedAt, widened_at AS widenedAt,
  held_at AS heldAt, held_hostname AS heldHostname, held_reason AS heldReason, held_detail AS heldDetail`;

/** Whole seconds, as the release's DATETIME columns keep them: MySQL would round a fraction up. */
const whole = (at: Date): Date => new Date(Math.floor(at.getTime() / 1000) * 1000);

/**
 * The release on offer, as `currentRelease`, read at most every 30 s: every Reading asks it (to tell
 * a board a newer build is waiting), and 100 boards every 30 s need not each query the database.
 * Publishing and withdrawing in this process clear it at once.
 */
let cached: { at: number; release: FirmwareRelease | null } | null = null;
const CACHE_MS = 30_000;
export async function cachedRelease(pool: Pool): Promise<FirmwareRelease | null> {
  if (cached === null || Date.now() - cached.at >= CACHE_MS) cached = { at: Date.now(), release: await currentRelease(pool) };
  return cached.release;
}

/** The release on offer, without its image; null when none is. */
export async function currentRelease(db: Db): Promise<FirmwareRelease | null> {
  const [rows] = await db.query<ReleaseRow[]>(`SELECT ${RELEASE_COLUMNS} FROM firmware_release WHERE id = 1`);
  return rows.length === 0 ? null : toRelease(rows[0]);
}

export async function releaseImage(pool: Pool): Promise<Buffer | null> {
  const [rows] = await pool.query<RowDataPacket[]>('SELECT image FROM firmware_release WHERE id = 1');
  return rows.length === 0 ? null : (rows[0].image as Buffer);
}

const HOSTNAME = /^ESP_[0-9A-F]{6}$/;

/** "ESP_A1B2C3 went Offline after taking it": a hold in words, for refusals, the email, and the command line. */
export const holdText = ({ hostname, reason, detail }: Omit<FirmwareHold, 'at'>): string =>
  reason === 'update failed'
    ? `${hostname} failed to install it${detail === null ? '' : ` (${detail})`}`
    : `${hostname} went ${reason === 'Offline' ? 'Offline' : 'into Sensor fault'} after taking it`;

const heldError = (version: number, hold: FirmwareHold): FirmwareImageError =>
  new FirmwareImageError(`version ${version} is held: ${holdText(hold)}; withdraw it, or publish a fixed build with a higher version`);

/**
 * Offers `image` to every Device, or only to `only`. A higher version is a new release, unheld. The
 * same build again changes only who it is offered to: every Device widens a staged one (as
 * widenRelease does, keeping when it was published), named Devices stage it again; a held one is
 * refused. An older version is refused, since boards never go back.
 */
export async function publishFirmware(pool: Pool, image: Buffer, only?: string[], at = new Date()): Promise<FirmwareRelease> {
  const parsed = parseFirmwareImage(image);
  const hostnames = only?.map((h) => h.trim().toUpperCase().replace(/-/g, '_')).filter((h) => h !== '');
  for (const hostname of hostnames ?? []) {
    if (!HOSTNAME.test(hostname)) throw new FirmwareImageError(`${hostname} is not a Device hostname (ESP_ and six hex digits)`);
  }
  const named = hostnames && hostnames.length > 0 ? hostnames.join(',') : null;
  const current = await currentRelease(pool);
  if (current !== null && parsed.version < current.version) {
    throw new FirmwareImageError(`version ${parsed.version} is older than the published ${current.version}; boards only ever take a higher version (raise FIRMWARE_VERSION)`);
  }
  if (current !== null && parsed.version === current.version && parsed.md5 !== current.md5) {
    throw new FirmwareImageError(`version ${parsed.version} is already published with different contents; raise FIRMWARE_VERSION in version.h and export again`);
  }
  if (current !== null && parsed.version === current.version) {
    if (current.hold !== null) throw heldError(current.version, current.hold);
    // Guarded on the hold, so one landing meanwhile still stands.
    if (named === null) await widenRelease(pool, at);
    else await pool.query('UPDATE firmware_release SET only_hostnames = ?, widened_at = NULL WHERE id = 1 AND held_at IS NULL', [named]);
    cached = null;
    const restaged = (await currentRelease(pool)) as FirmwareRelease;
    if (restaged.hold !== null) throw heldError(restaged.version, restaged.hold);
    return restaged;
  }
  cached = null;
  await pool.query(
    `REPLACE INTO firmware_release (id, version, md5, size, image, only_hostnames, published_at)
     VALUES (1, ?, ?, ?, ?, ?, ?)`,
    [parsed.version, parsed.md5, parsed.size, image, named, whole(at)],
  );
  return (await currentRelease(pool)) as FirmwareRelease;
}

/**
 * Offers a staged release to every Device ("Release to all"), keeping the Devices it went to first
 * and recording when. One already offered to every Device is left as it is, and so is a held one,
 * which changes only by being withdrawn or replaced by a higher version. Returns the release as it
 * now stands, or null when none is published; the caller tells a held one by its hold.
 */
export async function widenRelease(pool: Pool, at = new Date()): Promise<FirmwareRelease | null> {
  await pool.query('UPDATE firmware_release SET widened_at = ? WHERE id = 1 AND only_hostnames IS NOT NULL AND widened_at IS NULL AND held_at IS NULL', [
    whole(at),
  ]);
  cached = null;
  return currentRelease(pool);
}

/** Stops offering any release; boards keep what they run. */
export async function withdrawFirmware(pool: Pool): Promise<void> {
  cached = null;
  await pool.query('DELETE FROM firmware_release');
}

/** Whether a Device on `reportedVersion` should be sent the release. A held one is sent to no one. */
export const offers = (release: FirmwareRelease | null, hostname: string, reportedVersion: number): boolean =>
  release !== null && release.hold === null && release.version > reportedVersion && (release.only === null || release.only.includes(hostname));

/** True while `release` is offered to named Devices only, unheld: the stretch in which they can hold it. */
const watched = (release: FirmwareRelease | null): release is FirmwareRelease & { staged: string[] } =>
  release !== null && release.stage === 'named' && release.hold === null && release.staged !== null;

/**
 * Holds release `version` for `cause`, if it is still that release, staged, unheld, and offered to
 * the Device named: from then on it is offered to no one. With `notify`, a `hold` row goes into the
 * outbox in the same transaction (docs/adr/0008), with no Incident. Returns the hold, or null when
 * nothing changed.
 */
export async function holdRelease(pool: Pool, version: number, cause: Omit<FirmwareHold, 'at'>, at: Date, notify: boolean): Promise<FirmwareHold | null> {
  const heldAt = whole(at);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query<ResultSetHeader>(
      `UPDATE firmware_release SET held_at = ?, held_hostname = ?, held_reason = ?, held_detail = ?
       WHERE id = 1 AND version = ? AND held_at IS NULL AND widened_at IS NULL AND FIND_IN_SET(?, only_hostnames) > 0`,
      [heldAt, cause.hostname, cause.reason, cause.detail, version, cause.hostname],
    );
    if (result.affectedRows > 0 && notify) {
      await conn.query(
        `INSERT INTO notifications (incident_id, device_id, kind, level, created_at, next_attempt_at)
         SELECT NULL, id, 'hold', 'warning', ?, ? FROM devices WHERE hostname = ?`,
        [at, at, cause.hostname],
      );
    }
    await conn.commit();
    if (result.affectedRows === 0) return null;
    cached = null;
    return { at: heldAt, ...cause };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

interface FailingRow extends RowDataPacket {
  hostname: string;
  reason: 'Offline' | 'Sensor fault';
}

/**
 * The first named Device, by when it began, that went Offline or into Sensor fault after it took
 * `release`: the server sent it the image since it was published, or it says it runs the version.
 * Read from its incidents, so the rules that open them (the sweep's "heard since" among them) decide.
 * A download counts to its whole second, as an incident starts on one.
 */
async function failingIncident(db: Db, release: FirmwareRelease & { staged: string[] }): Promise<Omit<FirmwareHold, 'at'> | null> {
  const [rows] = await db.query<FailingRow[]>(
    `SELECT d.hostname, i.condition_name AS reason
     FROM incidents i JOIN devices d ON d.id = i.device_id
     WHERE d.hostname IN (?) AND i.condition_name IN ('Offline', 'Sensor fault')
       AND (d.firmware_sent_at >= ? OR d.firmware_version >= ?)
       AND i.started_at >= GREATEST(?, COALESCE(d.firmware_sent_at - INTERVAL MICROSECOND(d.firmware_sent_at) MICROSECOND, ?))
     ORDER BY i.started_at, i.id LIMIT 1`,
    [release.staged, release.publishedAt, release.version, release.publishedAt, release.publishedAt],
  );
  return rows.length === 0 ? null : { hostname: rows[0].hostname, reason: rows[0].reason, detail: null };
}

/**
 * The Offline sweep's check, after its pass: hold the staged release if a named Device that took it
 * has since gone Offline or into Sensor fault. A board that cannot join WiFi with the new build is
 * never heard from again, so taking it counts from the download.
 */
export async function holdOnIncidents(pool: Pool, at: Date, notify: boolean): Promise<FirmwareHold | null> {
  const release = await currentRelease(pool);
  if (!watched(release)) return null;
  const cause = await failingIncident(pool, release);
  return cause === null ? null : holdRelease(pool, release.version, cause, at, notify);
}

/** What ingest knows about a report, for holdOnReport. */
export interface ReportFacts {
  hostname: string;
  /** When the server last sent the Device the image, as its row held it. */
  sentAt: Date | null;
  /** The version it runs: what this report says, else what it said last. */
  version: number | null;
  /** Its last update check's result, as this report gives it. */
  updateResult: string | null;
  /** When the report arrived, to the millisecond, to tell it from a download just after. */
  arrivedAt: Date;
  /** True when the report changed one of the Device's incidents: a Sensor fault may have opened. */
  incidentsChanged: boolean;
}

/**
 * Ingest's check, once a report has committed: hold the staged release if the report is from one of
 * its named Devices and says it failed to install the build (rollout.ts), or if that Device went into
 * Sensor fault after taking it. `release` is the cached one, so a report from any other Device costs nothing.
 */
export async function holdOnReport(pool: Pool, release: FirmwareRelease | null, report: ReportFacts, at: Date, notify: boolean): Promise<FirmwareHold | null> {
  if (!watched(release) || !release.staged.includes(report.hostname)) return null;
  const cause = failedToInstall(release, report, report.updateResult, report.arrivedAt)
    ? { hostname: report.hostname, reason: 'update failed' as const, detail: report.updateResult }
    : report.incidentsChanged
      ? await failingIncident(pool, release)
      : null;
  return cause === null ? null : holdRelease(pool, release.version, cause, at, notify);
}

/** The hold a `hold` notification reports, as it stands when the email is built. */
export interface QueuedHold {
  version: number;
  hold: FirmwareHold;
  /** The Device that failed it; null if it has been deleted since. */
  device: { hostname: string; closet: string; campus: { name: string; shortcode: string } } | null;
}

interface QueuedHoldRow extends ReleaseRow {
  closet: string | null;
  campusName: string | null;
  campusShortcode: string | null;
}

/** The release's hold, with its Device, for the sender; null once the release is withdrawn or replaced. */
export async function queuedHold(db: Db): Promise<QueuedHold | null> {
  const [rows] = await db.query<QueuedHoldRow[]>(
    `SELECT ${RELEASE_COLUMNS}, d.closet, c.name AS campusName, c.shortcode AS campusShortcode
     FROM firmware_release r LEFT JOIN devices d ON d.hostname = r.held_hostname LEFT JOIN campuses c ON c.id = d.campus_id
     WHERE r.id = 1`,
  );
  const row = rows[0];
  const hold = row === undefined ? null : toRelease(row).hold;
  if (row === undefined || hold === null) return null;
  const device =
    row.closet === null || row.campusName === null || row.campusShortcode === null
      ? null
      : { hostname: hold.hostname, closet: row.closet, campus: { name: row.campusName, shortcode: row.campusShortcode } };
  return { version: row.version, hold, device };
}

/**
 * Drop the `hold` notifications among `ids` (claimed by the sender) once no release is held: it was
 * withdrawn or replaced, so the Admin has acted already. Returns the ids dropped.
 */
export async function dropStaleHolds(db: Db, ids: number[]): Promise<number[]> {
  if (ids.length === 0) return [];
  const [stale] = await db.query<(RowDataPacket & { id: number })[]>(
    "SELECT id FROM notifications WHERE id IN (?) AND kind = 'hold' AND NOT EXISTS (SELECT 1 FROM firmware_release WHERE held_at IS NOT NULL)",
    [ids],
  );
  const dropped = stale.map((r) => r.id);
  if (dropped.length > 0) await db.query('DELETE FROM notifications WHERE id IN (?)', [dropped]);
  return dropped;
}
