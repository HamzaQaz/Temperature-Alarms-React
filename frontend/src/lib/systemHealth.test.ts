import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes, systemLines, systemSummary, type SystemLine } from './systemHealth.ts';
import type { SystemHealth } from '../types.ts';

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const chs = { id: 1, name: 'Central High', shortcode: 'CHS' };

/** A healthy install, checked at noon. */
const healthy: SystemHealth = {
  checkedAt: '2026-10-07T12:00:00.000Z',
  database: { status: 'ok', sizeBytes: 1.5 * GB, storing: true },
  disk: { status: 'ok', freeBytes: 84 * GB, totalBytes: 200 * GB, minFreePercent: 10, error: null },
  backup: { status: 'ok', at: '2026-10-07T02:00:00.000Z', file: 'temperature-alarms_20261007-020000.sql.gz', sizeBytes: 12 * MB, maxAgeDays: 2 },
  notifications: { status: 'ok', enabled: true, lastSent: { at: '2026-10-07T09:30:00.000Z', subject: 'Hot critical' }, lastFailure: null, pending: 0, failed: 0 },
  firmware: { status: 'ok', release: { version: 6, publishedAt: '2026-10-01T15:00:00.000Z', only: null }, offered: 12, current: 12, behind: [] },
  wifi: { status: 'ok', belowDbm: -80, forHours: 24, weak: [] },
  server: { status: 'ok', version: '03c4700 2026-10-07', startedAt: '2026-10-04T08:00:00.000Z', uptimeSeconds: 3 * 86400 + 4 * 3600 },
};
const at = (iso: string) => iso.slice(5, 16).replace('T', ' ');
const line = (health: SystemHealth, key: SystemLine['key']): SystemLine => {
  const found = systemLines(health, at).find((l) => l.key === key);
  assert.ok(found, key);
  return found;
};

describe('systemLines', () => {
  it('gives every line in the order the ticket lists them, each with the status the server decided', () => {
    const lines = systemLines(healthy, at);
    assert.deepEqual(
      lines.map((l) => [l.key, l.status]),
      [
        ['database', 'ok'],
        ['disk', 'ok'],
        ['backup', 'ok'],
        ['notifications', 'ok'],
        ['firmware', 'ok'],
        ['wifi', 'ok'],
        ['server', 'ok'],
      ],
    );
    assert.ok(lines.every((l) => l.fix === null));
  });

  it('states each fine line as a fact with its numbers', () => {
    assert.equal(line(healthy, 'database').fact, '1.5 GB. Readings are being stored.');
    assert.equal(line(healthy, 'disk').fact, '42% free: 84 GB of 200 GB.');
    assert.equal(line(healthy, 'backup').fact, '10 h ago (10-07 02:00): temperature-alarms_20261007-020000.sql.gz, 12 MB.');
    assert.equal(line(healthy, 'notifications').fact, 'On. Last sent 10-07 09:30.');
    assert.equal(line(healthy, 'firmware').fact, 'Version 6, published 10-01 15:00: all 12 Devices it is offered to run it.');
    assert.equal(line(healthy, 'wifi').fact, 'No Device has been under -80 dBm for 24 h.');
    assert.equal(line(healthy, 'server').fact, 'Up 3 d 4 h, since 10-04 08:00. Version 03c4700 2026-10-07.');
  });

  it('a missing or old backup names the command, as the ticket words it', () => {
    const none = line({ ...healthy, backup: { ...healthy.backup, status: 'attention', at: null, file: null, sizeBytes: null } }, 'backup');
    assert.equal(none.fact, 'None recorded.');
    assert.equal(none.fix, 'Run `deploy/deploy.sh backup` now, and `deploy/deploy.sh schedule-backup` for one every night.');
    const old = line({ ...healthy, backup: { ...healthy.backup, status: 'attention', at: '2026-10-04T02:00:00.000Z' } }, 'backup');
    assert.equal(old.fact, 'No backup in 3 days: the last was 10-04 02:00 (temperature-alarms_20261007-020000.sql.gz, 12 MB).');
    assert.equal(old.fix, 'Run `deploy/deploy.sh backup`, and `deploy/deploy.sh schedule-backup` if the nightly one has stopped.');
  });

  it('a full disk, or one that could not be measured', () => {
    const full = line({ ...healthy, disk: { ...healthy.disk, status: 'attention', freeBytes: 19 * GB } }, 'disk');
    assert.equal(full.fact, '9% free: 19 GB of 200 GB, under 10%.');
    assert.match(full.fix ?? '', /^Make room on the server's disk/);
    const unknown = line({ ...healthy, disk: { ...healthy.disk, status: 'attention', freeBytes: null, totalBytes: null, error: 'ENOSYS' } }, 'disk');
    assert.equal(unknown.fact, 'Could not be measured: ENOSYS.');
    assert.equal(unknown.fix, 'Check it on the server: `df -h`.');
  });

  it('Readings not being stored point at the disk and the log', () => {
    const stuck = line({ ...healthy, database: { status: 'attention', sizeBytes: 1.5 * GB, storing: false } }, 'database');
    assert.equal(stuck.fact, '1.5 GB. The latest Reading could not be stored.');
    assert.equal(stuck.fix, 'Check free disk, then the api log: `deploy/deploy.sh logs --service api`.');
  });

  it('notifications: off, failing, and what waits or was given up on', () => {
    const off = line({ ...healthy, notifications: { status: 'off', enabled: false, lastSent: null, lastFailure: null, pending: 0, failed: 0 } }, 'notifications');
    assert.equal(off.status, 'off');
    assert.equal(off.fact, 'Off: Incidents show on this site only.');
    assert.match(off.fix ?? '', /SMTP_HOST, NOTIFY_FROM, NOTIFY_TO, and PUBLIC_URL/);
    const failing = line(
      { ...healthy, notifications: { ...healthy.notifications, status: 'attention', lastFailure: { at: '2026-10-07T11:00:00.000Z', error: 'connect ECONNREFUSED' }, pending: 2 } },
      'notifications',
    );
    assert.equal(failing.fact, 'On, but the last try failed at 10-07 11:00: connect ECONNREFUSED. 2 waiting to be sent.');
    assert.equal(failing.fix, 'Check the relay, then send a test email from the Notifications tab.');
    const quiet = line({ ...healthy, notifications: { ...healthy.notifications, lastSent: null, failed: 1 } }, 'notifications');
    assert.equal(quiet.fact, 'On. Nothing sent in the last week. 1 given up on this week.');
  });

  it('firmware: none published, staged, and boards still behind', () => {
    assert.equal(line({ ...healthy, firmware: { status: 'ok', release: null, offered: 0, current: 0, behind: [] } }, 'firmware').fact, 'None published: boards keep what they run.');
    const staged = line({ ...healthy, firmware: { ...healthy.firmware, release: { version: 6, publishedAt: '2026-10-01T15:00:00.000Z', only: ['ESP_000001'] }, offered: 1, current: 1 } }, 'firmware');
    assert.equal(staged.fact, 'Version 6, published 10-01 15:00 to ESP_000001: the one Device it is offered to runs it.');
    const behind = line(
      {
        ...healthy,
        firmware: {
          ...healthy.firmware,
          status: 'attention',
          current: 9,
          behind: [
            { id: 2, hostname: 'ESP_000002', closet: 'IDF 2', campus: chs, firmwareVersion: 5 },
            { id: 3, hostname: 'ESP_000003', closet: 'MDF', campus: chs, firmwareVersion: null },
          ],
        },
      },
      'firmware',
    );
    assert.equal(behind.fact, 'Version 6, published 10-01 15:00: 9 of 12 Devices it is offered to run it; still on an older build: CHS IDF 2 (ESP_000002, version 5), CHS MDF (ESP_000003).');
    const unchecked = line({ ...healthy, firmware: { ...healthy.firmware, current: 11 } }, 'firmware');
    assert.equal(unchecked.fact, 'Version 6, published 10-01 15:00: 11 of 12 Devices it is offered to run it; the others have not checked for an update yet.');
    assert.equal(unchecked.fix, null);
    assert.equal(line({ ...healthy, firmware: { ...healthy.firmware, offered: 0, current: 0 } }, 'firmware').fact, 'Version 6, published 10-01 15:00: no installed Device is offered it.');
    assert.equal(behind.fix, 'Boards on version 3 or later update within a Report interval, older ones within the hour; one still behind after that: see its last update on the Firmware tab.');
  });

  it('weak WiFi names each board, its signal, and since when', () => {
    const weak = line(
      { ...healthy, wifi: { ...healthy.wifi, status: 'attention', weak: [{ id: 1, hostname: 'ESP_000001', closet: 'IDF 1', campus: chs, rssi: -86, since: '2026-10-05T09:00:00.000Z' }] } },
      'wifi',
    );
    assert.equal(weak.fact, '1 Device under -80 dBm for 24 h or more: CHS IDF 1 (ESP_000001, -86 dBm since 10-05 09:00).');
    assert.equal(weak.fix, 'Move the board or its access point, or add one nearer the closet: a weak signal drops Readings.');
  });

  it('a server built by hand has no version', () => {
    assert.equal(line({ ...healthy, server: { ...healthy.server, version: null, uptimeSeconds: 125 } }, 'server').fact, 'Up 2 min, since 10-04 08:00. Version not recorded (built without deploy).');
  });
});

describe('systemSummary', () => {
  it('says all is fine, or which lines need attention', () => {
    assert.equal(systemSummary(systemLines(healthy, at)), 'Nothing needs attention.');
    const lines = systemLines(
      {
        ...healthy,
        backup: { ...healthy.backup, status: 'attention', at: null, file: null, sizeBytes: null },
        wifi: { ...healthy.wifi, status: 'attention' },
        notifications: { status: 'off', enabled: false, lastSent: null, lastFailure: null, pending: 0, failed: 0 },
      },
      at,
    );
    assert.equal(systemSummary(lines), '2 lines need attention: Last backup, WiFi.');
    assert.equal(systemSummary(lines.filter((l) => l.key !== 'wifi')), '1 line needs attention: Last backup.');
  });
});

describe('formatBytes', () => {
  it('in binary units, one decimal under 10', () => {
    assert.deepEqual([0, 900, 5 * 1024, 12.34 * MB, 1.5 * GB, 200 * GB, 2.5 * 1024 * GB].map(formatBytes), ['0 B', '900 B', '5 KB', '12 MB', '1.5 GB', '200 GB', '2.5 TB']);
  });
});
