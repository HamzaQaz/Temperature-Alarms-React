import type { CheckStatus, SystemHealth } from '../types.ts';
import { formatUptime } from './deviceInfo.ts';

/**
 * How Settings, System words each line the server sent: its fact, with the numbers, and, when it is
 * not fine, what to do. The status of every line, and every threshold, come from the server
 * (backend/src/systemHealth.ts); nothing is judged here. Ages are counted from the server's own
 * `checkedAt`, so the words agree with the status beside them.
 */
export interface SystemLine {
  key: 'database' | 'disk' | 'backup' | 'notifications' | 'firmware' | 'wifi' | 'server';
  label: string;
  status: CheckStatus;
  fact: string;
  /** What to do; null when the line is fine. */
  fix: string | null;
}

const UNITS = ['KB', 'MB', 'GB', 'TB'];

/** "900 B", "5 KB", "1.5 GB", "200 GB": binary units, one decimal under 10. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const figure = value < 10 ? String(Math.round(value * 10) / 10) : String(Math.round(value));
  return `${figure} ${UNITS[unit]}`;
}

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** "40 min ago", "10 h ago", "3 days ago". */
function ago(ms: number): string {
  if (ms < HOUR_MS) return `${Math.max(0, Math.floor(ms / 60000))} min ago`;
  if (ms < 2 * DAY_MS) return `${Math.floor(ms / HOUR_MS)} h ago`;
  return `${Math.floor(ms / DAY_MS)} days ago`;
}

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const place = (d: { hostname: string; closet: string; campus: { shortcode: string } }): string => `${d.campus.shortcode} ${d.closet}`;

/** Every line, in the ticket's order, worded with `dateOf` for absolute times. */
export function systemLines(health: SystemHealth, dateOf: (iso: string) => string): SystemLine[] {
  const checkedAt = new Date(health.checkedAt).getTime();
  const sinceCheck = (iso: string) => checkedAt - new Date(iso).getTime();
  const { database, disk, backup, notifications, firmware, wifi, server } = health;
  const fixFor = (status: CheckStatus, fix: string): string | null => (status === 'ok' ? null : fix);

  const lines: SystemLine[] = [];

  lines.push({
    key: 'database',
    label: 'Database',
    status: database.status,
    fact: `${formatBytes(database.sizeBytes)}. ${database.storing ? 'Readings are being stored.' : 'The latest Reading could not be stored.'}`,
    fix: fixFor(database.status, 'Check free disk, then the api log: `deploy/deploy.sh logs --service api`.'),
  });

  if (disk.freeBytes === null || disk.totalBytes === null) {
    lines.push({ key: 'disk', label: 'Free disk', status: disk.status, fact: `Could not be measured: ${disk.error ?? 'no answer'}.`, fix: fixFor(disk.status, 'Check it on the server: `df -h`.') });
  } else {
    const percent = disk.totalBytes > 0 ? Math.floor((disk.freeBytes / disk.totalBytes) * 100) : 0;
    const under = disk.status === 'ok' ? '' : `, under ${disk.minFreePercent}%`;
    lines.push({
      key: 'disk',
      label: 'Free disk',
      status: disk.status,
      fact: `${percent}% free: ${formatBytes(disk.freeBytes)} of ${formatBytes(disk.totalBytes)}${under}.`,
      fix: fixFor(disk.status, "Make room on the server's disk, or keep fewer days of Readings (`RETENTION_DAYS`) or of backups (`--keep-days`)."),
    });
  }

  const backupFile = backup.file === null ? '' : `${backup.file}${backup.sizeBytes === null ? '' : `, ${formatBytes(backup.sizeBytes)}`}`;
  if (backup.at === null) {
    lines.push({
      key: 'backup',
      label: 'Last backup',
      status: backup.status,
      fact: 'None recorded.',
      fix: fixFor(backup.status, 'Run `deploy/deploy.sh backup` now, and `deploy/deploy.sh schedule-backup` for one every night.'),
    });
  } else if (backup.status === 'ok') {
    lines.push({ key: 'backup', label: 'Last backup', status: 'ok', fact: `${ago(sinceCheck(backup.at))} (${dateOf(backup.at)}): ${backupFile}.`, fix: null });
  } else {
    lines.push({
      key: 'backup',
      label: 'Last backup',
      status: backup.status,
      fact: `No backup in ${Math.floor(sinceCheck(backup.at) / DAY_MS)} days: the last was ${dateOf(backup.at)} (${backupFile}).`,
      fix: 'Run `deploy/deploy.sh backup`, and `deploy/deploy.sh schedule-backup` if the nightly one has stopped.',
    });
  }

  if (!notifications.enabled) {
    lines.push({
      key: 'notifications',
      label: 'Email notifications',
      status: notifications.status,
      fact: 'Off: Incidents show on this site only.',
      fix: "To email technicians about Incidents, set SMTP_HOST, NOTIFY_FROM, NOTIFY_TO, and PUBLIC_URL with `deploy/deploy.sh install --reconfigure` (DEPLOYMENT.md).",
    });
  } else {
    const { lastSent, lastFailure, pending, failed } = notifications;
    const parts =
      notifications.status === 'attention' && lastFailure !== null
        ? [`On, but the last try failed at ${dateOf(lastFailure.at)}: ${lastFailure.error.replace(/\.$/, '')}.`]
        : ['On.', lastSent === null ? 'Nothing sent in the last week.' : `Last sent ${dateOf(lastSent.at)}.`];
    if (pending > 0) parts.push(`${pending} waiting to be sent.`);
    if (failed > 0) parts.push(`${failed} given up on this week.`);
    lines.push({
      key: 'notifications',
      label: 'Email notifications',
      status: notifications.status,
      fact: parts.join(' '),
      fix: fixFor(notifications.status, 'Check the relay, then send a test email from the Notifications tab.'),
    });
  }

  const { release } = firmware;
  if (release === null) {
    lines.push({ key: 'firmware', label: 'Firmware', status: firmware.status, fact: 'None published: boards keep what they run.', fix: null });
  } else {
    const published = `Version ${release.version}, published ${dateOf(release.publishedAt)}${release.only === null ? '' : ` to ${release.only.join(', ')}`}`;
    const { offered, current, behind } = firmware;
    let fleet: string;
    if (offered === 0) fleet = 'no installed Device is offered it';
    else if (current === offered) fleet = offered === 1 ? 'the one Device it is offered to runs it' : `all ${offered} Devices it is offered to run it`;
    else fleet = `${current} of ${count(offered, 'Device', 'Devices')} it is offered to ${current === 1 ? 'runs' : 'run'} it`;
    if (behind.length > 0) {
      const names = behind.map((d) => `${place(d)} (${d.hostname}${d.firmwareVersion === null ? '' : `, version ${d.firmwareVersion}`})`);
      fleet += `; still on an older build: ${names.join(', ')}`;
    } else if (current < offered) {
      fleet += '; the others have not checked for an update yet';
    }
    lines.push({
      key: 'firmware',
      label: 'Firmware',
      status: firmware.status,
      fact: `${published}: ${fleet}.`,
      fix: fixFor(firmware.status, 'Boards on version 3 or later update within a Report interval, older ones within the hour; one still behind after that: see its last update on the Firmware tab.'),
    });
  }

  lines.push({
    key: 'wifi',
    label: 'WiFi',
    status: wifi.status,
    fact:
      wifi.weak.length === 0
        ? `No Device has been under ${wifi.belowDbm} dBm for ${wifi.forHours} h.`
        : `${count(wifi.weak.length, 'Device', 'Devices')} under ${wifi.belowDbm} dBm for ${wifi.forHours} h or more: ${wifi.weak
            .map((d) => `${place(d)} (${d.hostname}, ${d.rssi} dBm since ${dateOf(d.since)})`)
            .join(', ')}.`,
    fix: fixFor(wifi.status, 'Move the board or its access point, or add one nearer the closet: a weak signal drops Readings.'),
  });

  lines.push({
    key: 'server',
    label: 'Server',
    status: server.status,
    fact: `Up ${formatUptime(server.uptimeSeconds)}, since ${dateOf(server.startedAt)}. ${server.version === null ? 'Version not recorded (built without deploy).' : `Version ${server.version}.`}`,
    fix: null,
  });

  return lines;
}

/** One sentence over the lines: nothing to do, or which need attention. Off lines are not counted. */
export function systemSummary(lines: SystemLine[]): string {
  const attention = lines.filter((l) => l.status === 'attention');
  if (attention.length === 0) return 'Nothing needs attention.';
  return `${count(attention.length, 'line needs', 'lines need')} attention: ${attention.map((l) => l.label).join(', ')}.`;
}
