import { statfs } from 'node:fs/promises';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { currentRelease } from './firmwareStore';
import { isBench } from './outbox';
import { outboxStatus } from './outboxStore';

/**
 * Whether the system itself is OK, for Settings, System: the database, the disk, the last backup,
 * email notifications, firmware, the boards' WiFi, and the server. Each line is decided here, from
 * the thresholds below, so the page only words it. Shown on the page only; nothing is emailed
 * (owner decision, .scratch/operations/issues/02-system-health-on-settings.md).
 */

/** A line is fine, or a feature that is not set up (email notifications), or needs someone to act. */
export type CheckStatus = 'ok' | 'off' | 'attention';

/** No backup for longer than this needs one: a nightly backup that stopped has missed two nights. */
export const BACKUP_MAX_AGE_DAYS = 2;
/** Less free disk than this share of it needs room made. */
export const DISK_MIN_FREE_PERCENT = 10;
/** A board whose signal is under this... */
export const WEAK_SIGNAL_DBM = -80;
/** ...for this long without a Reading at a better one has weak WiFi. Ingest keeps when it began (routes/readings.ts). */
export const WEAK_SIGNAL_HOURS = 24;

const DAY_MS = 24 * 3600 * 1000;

/** The disk the server runs on: under Compose, the Docker disk that also holds the database volume. */
export interface DiskSpace {
  freeBytes: number;
  totalBytes: number;
}

/** Free space for an unprivileged writer on the filesystem holding `/`. */
export async function measureDisk(path = '/'): Promise<DiskSpace> {
  const { bsize, blocks, bavail } = await statfs(path);
  return { freeBytes: bavail * bsize, totalBytes: blocks * bsize };
}

export const backupStatus = (at: Date | null, now: Date): CheckStatus =>
  at !== null && now.getTime() - at.getTime() <= BACKUP_MAX_AGE_DAYS * DAY_MS ? 'ok' : 'attention';

export const diskStatus = ({ freeBytes, totalBytes }: DiskSpace): CheckStatus =>
  totalBytes > 0 && (freeBytes / totalBytes) * 100 >= DISK_MIN_FREE_PERCENT ? 'ok' : 'attention';

interface CampusRef {
  id: number;
  name: string;
  shortcode: string;
}

interface DeviceRef {
  id: number;
  hostname: string;
  closet: string;
  campus: CampusRef;
}

export interface SystemHealth {
  checkedAt: Date;
  /** `storing` is false while the latest Reading could not be written (ingestHealth.ts). */
  database: { status: CheckStatus; sizeBytes: number; storing: boolean };
  /** Null figures and the reason when the disk could not be measured. */
  disk: { status: CheckStatus; freeBytes: number | null; totalBytes: number | null; minFreePercent: number; error: string | null };
  /** From the marker `deploy backup` writes; all null when none is recorded. */
  backup: { status: CheckStatus; at: Date | null; file: string | null; sizeBytes: number | null; maxAgeDays: number };
  notifications: {
    status: CheckStatus;
    enabled: boolean;
    lastSent: { at: Date; subject: string } | null;
    lastFailure: { at: Date; error: string } | null;
    pending: number;
    failed: number;
  };
  /**
   * How many installed Devices the release is offered to, how many of them run it (or later), and
   * those that checked for it and still run an older build, as the Firmware tab counts them.
   */
  firmware: {
    status: CheckStatus;
    release: { version: number; publishedAt: Date; only: string[] | null } | null;
    offered: number;
    current: number;
    behind: Array<DeviceRef & { firmwareVersion: number | null }>;
  };
  wifi: { status: CheckStatus; belowDbm: number; forHours: number; weak: Array<DeviceRef & { rssi: number; since: Date }> };
  server: { status: CheckStatus; version: string | null; startedAt: Date; uptimeSeconds: number };
}

interface SizeRow extends RowDataPacket {
  bytes: number | string | null;
}

interface BackupRow extends RowDataPacket {
  at: Date;
  file: string;
  sizeBytes: number | string | null;
}

interface DeviceRow extends RowDataPacket {
  id: number;
  hostname: string;
  closet: string;
  campusId: number;
  campusName: string;
  campusShortcode: string;
  firmwareVersion: number | null;
  checkedAt: Date | null;
  rssi: number | null;
  weakSince: Date | null;
}

const deviceRef = (row: DeviceRow): DeviceRef => ({
  id: row.id,
  hostname: row.hostname,
  closet: row.closet,
  campus: { id: row.campusId, name: row.campusName, shortcode: row.campusShortcode },
});

export interface SystemHealthDeps {
  pool: Pool;
  now: Date;
  /** False while Readings cannot be written. */
  storing: boolean;
  notificationsEnabled: boolean;
  diskSpace: () => Promise<DiskSpace>;
  /** The commit the api image was built from (APP_VERSION), when deploy built it. */
  version: string | undefined;
  startedAt: Date;
}

/** Every line of Settings, System, read now. Throws only when the database cannot be read. */
export async function systemHealth({ pool, now, storing, notificationsEnabled, diskSpace, version, startedAt }: SystemHealthDeps): Promise<SystemHealth> {
  // MySQL's own figure for the tables, refreshed as it recounts them, so a size near enough.
  const [[size]] = await pool.query<SizeRow[]>(
    'SELECT SUM(data_length + index_length) AS bytes FROM information_schema.tables WHERE table_schema = DATABASE()',
  );
  const [backups] = await pool.query<BackupRow[]>('SELECT finished_at AS at, file, size_bytes AS sizeBytes FROM last_backup WHERE id = 1');
  const backup = backups[0];
  const outbox = await outboxStatus(pool, now);
  const release = await currentRelease(pool);
  const [devices] = await pool.query<DeviceRow[]>(`
    SELECT d.id, d.hostname, d.closet, d.firmware_version AS firmwareVersion, d.firmware_checked_at AS checkedAt,
           d.rssi, d.weak_signal_since AS weakSince,
           c.id AS campusId, c.name AS campusName, c.shortcode AS campusShortcode
    FROM devices d JOIN campuses c ON c.id = d.campus_id
    ORDER BY c.name, d.closet, d.hostname`);
  // A board on the Bench is not installed: it updates and finds its WiFi once it is.
  const installed = devices.filter((d) => !isBench(d.campusShortcode));

  let disk: SystemHealth['disk'];
  try {
    const space = await diskSpace();
    disk = { status: diskStatus(space), ...space, minFreePercent: DISK_MIN_FREE_PERCENT, error: null };
  } catch (error) {
    disk = { status: 'attention', freeBytes: null, totalBytes: null, minFreePercent: DISK_MIN_FREE_PERCENT, error: error instanceof Error ? error.message : String(error) };
  }

  // Only the latest try counts: a relay that failed and has sent since is working again.
  const failingNow = outbox.lastFailure !== null && (outbox.lastSent === null || outbox.lastFailure.at.getTime() > outbox.lastSent.at.getTime());

  const offered = release === null ? [] : installed.filter((d) => release.only === null || release.only.includes(d.hostname));
  const current = release === null ? 0 : offered.filter((d) => d.firmwareVersion !== null && d.firmwareVersion >= release.version).length;
  const behind =
    release === null ? [] : offered.filter((d) => d.checkedAt !== null && (d.firmwareVersion ?? 0) < release.version).map((d) => ({ ...deviceRef(d), firmwareVersion: d.firmwareVersion }));

  const weakBefore = now.getTime() - WEAK_SIGNAL_HOURS * 3600 * 1000;
  const weak = installed
    .filter((d): d is DeviceRow & { rssi: number; weakSince: Date } => d.rssi !== null && d.rssi < WEAK_SIGNAL_DBM && d.weakSince !== null && d.weakSince.getTime() <= weakBefore)
    .map((d) => ({ ...deviceRef(d), rssi: d.rssi, since: d.weakSince }));

  return {
    checkedAt: now,
    database: { status: storing ? 'ok' : 'attention', sizeBytes: Number(size.bytes ?? 0), storing },
    disk,
    backup: {
      status: backupStatus(backup?.at ?? null, now),
      at: backup?.at ?? null,
      file: backup?.file ?? null,
      sizeBytes: backup?.sizeBytes == null ? null : Number(backup.sizeBytes),
      maxAgeDays: BACKUP_MAX_AGE_DAYS,
    },
    notifications: {
      status: !notificationsEnabled ? 'off' : failingNow ? 'attention' : 'ok',
      enabled: notificationsEnabled,
      lastSent: outbox.lastSent,
      lastFailure: outbox.lastFailure,
      pending: outbox.pending,
      failed: outbox.failed,
    },
    firmware: {
      status: behind.length > 0 ? 'attention' : 'ok',
      release: release === null ? null : { version: release.version, publishedAt: release.publishedAt, only: release.only },
      offered: offered.length,
      current,
      behind,
    },
    wifi: { status: weak.length > 0 ? 'attention' : 'ok', belowDbm: WEAK_SIGNAL_DBM, forHours: WEAK_SIGNAL_HOURS, weak },
    server: {
      status: 'ok',
      version: version === undefined || version.trim() === '' ? null : version.trim(),
      startedAt,
      uptimeSeconds: Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 1000)),
    },
  };
}
