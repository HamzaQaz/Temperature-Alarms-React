import dotenv from 'dotenv';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { loadConfig, ConfigError } from './config';
import { createPool } from './db';
import type { ConditionRules } from './conditions';
import {
  currentRelease,
  FirmwareImageError,
  holdText,
  offeredTo,
  publishFirmware,
  releaseProgress,
  withdrawFirmware,
  type DeviceProgress,
  type FirmwareRelease,
} from './firmwareStore';
import { progressDetail, STEP_TEXT } from './rollout';

dotenv.config();

/**
 * Over-the-air firmware from the server's shell (docs/adr/0007), run inside api by deploy.sh:
 *
 *   base64 < TemperatureAlarms.ino.bin.signed | node dist/firmwareCli.js publish [--only ESP_A1B2C3,...]
 *   node dist/firmwareCli.js status
 *   node dist/firmwareCli.js withdraw
 *
 * Publishing says who the build is offered to, and status where each of them is on the way to it,
 * as the Firmware tab does.
 *
 * The image arrives as base64 on stdin, so it passes through `docker compose exec` and PowerShell
 * pipelines as text, and is on no command line.
 */

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
};

/** How far it has gone: released to all after named Devices (since when, first to whom), or held. Who it is offered to is offeredTo. */
const stageOf = ({ staged, widenedAt, hold }: FirmwareRelease): string => {
  if (hold !== null) return `, held since ${hold.at.toISOString()} (${holdText(hold)})`;
  if (widenedAt !== null) return `, released to all since ${widenedAt.toISOString()} (first to ${(staged ?? []).join(', ')})`;
  return '';
};

const describe = (release: FirmwareRelease): string =>
  `version ${release.version} (${release.size} bytes, md5 ${release.md5}), published ${release.publishedAt.toISOString()}${stageOf(release)}`;

/** "Oct 7, 23:55 CDT": times on the server's clock (TZ), as the per-Device lines give them. */
const timeFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' });
const timeOf = (at: Date): string => timeFormat.format(at);

/**
 * One line per Device the release is offered to, stuck ones first, as the Firmware tab shows them:
 * `  ESP_64533B  CHS IDF 2  version 4  Waiting for its next check: by Oct 7, 23:55 CDT, or restart the board`.
 */
function progressLines(progress: DeviceProgress[], now: Date, formatTime: (at: Date) => string = timeOf): string[] {
  const cells = progress.map((p) => {
    const detail = progressDetail(p, now, formatTime);
    return [
      p.hostname,
      p.device === null ? 'not registered' : `${p.device.campus.shortcode} ${p.device.closet}`,
      p.firmwareVersion === null ? 'version unknown' : `version ${p.firmwareVersion}`,
      detail === null ? STEP_TEXT[p.step] : `${STEP_TEXT[p.step]}: ${detail}`,
    ];
  });
  const widths = [0, 1, 2].map((i) => Math.max(0, ...cells.map((row) => row[i].length)));
  return cells.map((row) => `  ${row.map((cell, i) => (i < 3 ? cell.padEnd(widths[i]) : cell)).join('  ')}`);
}

interface VersionRow extends RowDataPacket {
  hostname: string;
  firmwareVersion: number | null;
}

async function status(pool: Pool, rules: ConditionRules): Promise<void> {
  const release = await currentRelease(pool);
  if (release === null) {
    console.log('No release published: boards keep what they run.');
  } else {
    console.log(`Published: ${describe(release)}`);
    console.log(`${await offeredTo(pool, release)}.`);
    const now = new Date();
    const progress = await releaseProgress(pool, release, now, rules);
    if (progress.length > 0) {
      console.log('Where each of them is:');
      for (const line of progressLines(progress, now)) console.log(line);
    }
  }
  const [rows] = await pool.query<VersionRow[]>('SELECT hostname, firmware_version AS firmwareVersion FROM devices ORDER BY hostname');
  const counts = new Map<string, string[]>();
  for (const row of rows) {
    const key = row.firmwareVersion === null ? 'not checked in yet' : `version ${row.firmwareVersion}`;
    counts.set(key, [...(counts.get(key) ?? []), row.hostname]);
  }
  if (counts.size > 0) console.log("Every Device's version:");
  for (const [key, hostnames] of [...counts].sort()) {
    console.log(`  ${key}: ${hostnames.length}${hostnames.length <= 12 ? ` (${hostnames.join(', ')})` : ''}`);
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const onlyIndex = rest.indexOf('--only');
  const only = onlyIndex >= 0 ? (rest[onlyIndex + 1] ?? '').split(',').filter((h) => h.trim() !== '') : undefined;
  if (!['publish', 'status', 'withdraw'].includes(command ?? '')) {
    console.error('Usage: firmwareCli.js publish [--only ESP_A1B2C3,...] < image.base64 | status | withdraw');
    process.exit(2);
  }
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`Configuration error: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
  const pool = createPool(config.database);
  try {
    if (command === 'publish') {
      const image = Buffer.from((await readStdin()).replace(/\s+/g, ''), 'base64');
      const release = await publishFirmware(pool, image, only);
      console.log(`Published ${describe(release)}.`);
      console.log(`${await offeredTo(pool, release)}. A board that sends Readings checks at its next one; a silent one within the hour, or 30 s after a restart.`);
    } else if (command === 'withdraw') {
      await withdrawFirmware(pool);
      console.log('Withdrawn: no release is offered; boards keep what they run.');
    } else {
      await status(pool, { reportIntervalSeconds: config.reportIntervalSeconds, thresholds: config.thresholds });
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof FirmwareImageError ? `Refused: ${error.message}` : `Failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
