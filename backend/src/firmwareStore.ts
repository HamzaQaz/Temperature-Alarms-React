import { createHash } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';

/**
 * The firmware release on offer to Devices (docs/adr/0007): one at a time, published from the build
 * laptop's signed binary with deploy.sh publish-firmware. Boards check for it every hour and take it
 * only when its version is above their own.
 */

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
}

export interface FirmwareRelease {
  version: number;
  md5: string;
  size: number;
  /** The Devices it is offered to, or null for every Device. */
  only: string[] | null;
  publishedAt: Date;
}

const toRelease = ({ version, md5, size, onlyHostnames, publishedAt }: ReleaseRow): FirmwareRelease => ({
  version,
  md5,
  size,
  only: onlyHostnames === null ? null : onlyHostnames.split(','),
  publishedAt,
});

/** The release on offer, without its image; null when none is. */
export async function currentRelease(pool: Pool): Promise<FirmwareRelease | null> {
  const [rows] = await pool.query<ReleaseRow[]>(
    'SELECT version, md5, size, only_hostnames AS onlyHostnames, published_at AS publishedAt FROM firmware_release WHERE id = 1',
  );
  return rows.length === 0 ? null : toRelease(rows[0]);
}

export async function releaseImage(pool: Pool): Promise<Buffer | null> {
  const [rows] = await pool.query<RowDataPacket[]>('SELECT image FROM firmware_release WHERE id = 1');
  return rows.length === 0 ? null : (rows[0].image as Buffer);
}

const HOSTNAME = /^ESP_[0-9A-F]{6}$/;

/**
 * Offers `image` to every Device, or only to `only`. The same version again changes who it is offered
 * to (a bench board first, then everyone); an older one is refused, since boards never go back.
 */
export async function publishFirmware(pool: Pool, image: Buffer, only?: string[]): Promise<FirmwareRelease> {
  const parsed = parseFirmwareImage(image);
  const hostnames = only?.map((h) => h.trim().toUpperCase().replace(/-/g, '_')).filter((h) => h !== '');
  for (const hostname of hostnames ?? []) {
    if (!HOSTNAME.test(hostname)) throw new FirmwareImageError(`${hostname} is not a Device hostname (ESP_ and six hex digits)`);
  }
  const current = await currentRelease(pool);
  if (current !== null && parsed.version < current.version) {
    throw new FirmwareImageError(`version ${parsed.version} is older than the published ${current.version}; boards only ever take a higher version (raise FIRMWARE_VERSION)`);
  }
  if (current !== null && parsed.version === current.version && parsed.md5 !== current.md5) {
    throw new FirmwareImageError(`version ${parsed.version} is already published with different contents; raise FIRMWARE_VERSION in version.h and export again`);
  }
  await pool.query(
    `REPLACE INTO firmware_release (id, version, md5, size, image, only_hostnames, published_at)
     VALUES (1, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
    [parsed.version, parsed.md5, parsed.size, image, hostnames && hostnames.length > 0 ? hostnames.join(',') : null],
  );
  return (await currentRelease(pool)) as FirmwareRelease;
}

/** Stops offering any release; boards keep what they run. */
export async function withdrawFirmware(pool: Pool): Promise<void> {
  await pool.query('DELETE FROM firmware_release');
}

/** Whether a Device on `reportedVersion` should be sent the release. */
export const offers = (release: FirmwareRelease | null, hostname: string, reportedVersion: number): boolean =>
  release !== null && release.version > reportedVersion && (release.only === null || release.only.includes(hostname));
