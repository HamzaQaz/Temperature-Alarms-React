import dotenv from 'dotenv';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { loadConfig, ConfigError } from './config';
import { createPool } from './db';
import { currentRelease, FirmwareImageError, publishFirmware, withdrawFirmware, type FirmwareRelease } from './firmwareStore';

dotenv.config();

/**
 * Over-the-air firmware from the server's shell (docs/adr/0007), run inside api by deploy.sh:
 *
 *   base64 < TemperatureAlarms.ino.bin.signed | node dist/firmwareCli.js publish [--only ESP_A1B2C3,...]
 *   node dist/firmwareCli.js status
 *   node dist/firmwareCli.js withdraw
 *
 * The image arrives as base64 on stdin, so it passes through `docker compose exec` and PowerShell
 * pipelines as text, and is on no command line.
 */

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
};

const describe = (release: FirmwareRelease): string =>
  `version ${release.version} (${release.size} bytes, md5 ${release.md5}), offered to ${release.only === null ? 'every Device' : release.only.join(', ')}, published ${release.publishedAt.toISOString()}`;

interface VersionRow extends RowDataPacket {
  hostname: string;
  firmwareVersion: number | null;
  checkedAt: Date | null;
}

async function status(pool: Pool): Promise<void> {
  const release = await currentRelease(pool);
  console.log(release === null ? 'No release published: boards keep what they run.' : `Published: ${describe(release)}`);
  const [rows] = await pool.query<VersionRow[]>(
    'SELECT hostname, firmware_version AS firmwareVersion, firmware_checked_at AS checkedAt FROM devices ORDER BY hostname',
  );
  const counts = new Map<string, string[]>();
  for (const row of rows) {
    const key = row.firmwareVersion === null ? 'not checked in yet' : `version ${row.firmwareVersion}`;
    counts.set(key, [...(counts.get(key) ?? []), row.hostname]);
  }
  for (const [key, hostnames] of [...counts].sort()) {
    console.log(`  ${key}: ${hostnames.length}${hostnames.length <= 12 ? ` (${hostnames.join(', ')})` : ''}`);
  }
  if (release !== null) {
    const behind = rows.filter((r) => (release.only === null || release.only.includes(r.hostname)) && (r.firmwareVersion ?? -1) < release.version);
    console.log(behind.length === 0 ? `Every Device it is offered to runs version ${release.version} or later.` : `Still to update: ${behind.map((r) => r.hostname).join(', ')}`);
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
      console.log(`Published ${describe(release)}. Boards check every hour.`);
    } else if (command === 'withdraw') {
      await withdrawFirmware(pool);
      console.log('Withdrawn: no release is offered; boards keep what they run.');
    } else {
      await status(pool);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof FirmwareImageError ? `Refused: ${error.message}` : `Failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
