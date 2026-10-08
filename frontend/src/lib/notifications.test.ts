import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { monthName, notificationsSummary, reportQueued, testEmailSent } from './notifications.ts';
import type { NotificationStatus, RecipientList } from '../types.ts';

const off: NotificationStatus = {
  enabled: false,
  relay: null,
  from: null,
  recipients: [],
  toAll: false,
  lists: [],
  monthlyReport: false,
  lastSent: null,
  lastFailure: null,
  pending: 0,
  failed: 0,
};
const defaultList: RecipientList = {
  recipients: ['oncall@district.example', 'techs@district.example'],
  campuses: ['CHS', 'MHS'],
  isDefault: true,
  lastResult: null,
};
const on: NotificationStatus = {
  enabled: true,
  relay: { host: 'relay.district.example', port: 587, secure: 'starttls' },
  from: 'alarms@district.example',
  recipients: ['techs@district.example', 'oncall@district.example'],
  toAll: false,
  lists: [defaultList],
  monthlyReport: false,
  lastSent: null,
  lastFailure: null,
  pending: 0,
  failed: 0,
};
const day = (iso: string) => iso.slice(0, 10);

describe('notificationsSummary', () => {
  it('says when notifications are off and what turns them on', () => {
    const summary = notificationsSummary(off, day);
    assert.equal(summary.state, 'Off.');
    assert.match(summary.detail, /^Set SMTP_HOST, NOTIFY_FROM, NOTIFY_TO, and PUBLIC_URL in the server's \.env/);
    assert.deepEqual(summary.lists, []);
  });

  it('names the relay, its security, the sender, and how a Campus finds its recipients', () => {
    const summary = notificationsSummary(on, day);
    assert.equal(summary.state, 'On, through relay.district.example:587 (STARTTLS), from alarms@district.example.');
    assert.equal(summary.detail, 'Each Campus emails its own recipients, set under Campuses, or the default ones when it has none.');
    assert.match(notificationsSummary({ ...on, relay: { host: 'relay', port: 25, secure: 'none' } }, day).state, /\(no encryption\)/);
    assert.match(notificationsSummary({ ...on, toAll: true }, day).detail, / The default recipients also get every email \(NOTIFY_TO_ALL\)\.$/);
  });

  it('says whether the monthly report goes out on its own, and nothing about it while notifications are off', () => {
    assert.equal(notificationsSummary({ ...on, monthlyReport: true }, day).monthlyReport, 'A report on last month goes to the default recipients on the 1st of each month.');
    assert.match(notificationsSummary(on, day).monthlyReport ?? '', /^The monthly report is off: set NOTIFY_MONTHLY_REPORT=true in the server's \.env/);
    assert.equal(notificationsSummary({ ...off, monthlyReport: true }, day).monthlyReport, null);
  });

  it('gives each list, who is on it, the Campuses on it, and its last result', () => {
    const summary = notificationsSummary(
      {
        ...on,
        lists: [
          { ...defaultList, lastResult: { at: '2026-10-06T14:00:00.000Z', sent: true, subject: '[Temperature Alarms] Test email' } },
          {
            recipients: ['chs-techs@district.example'],
            campuses: ['CHS', 'NHS'],
            isDefault: false,
            lastResult: { at: '2026-10-05T09:00:00.000Z', sent: false, error: 'Invalid login: 535 Authentication failed' },
          },
          { recipients: ['mhs-techs@district.example'], campuses: ['MHS'], isDefault: false, lastResult: null },
        ],
      },
      day,
    );
    assert.deepEqual(summary.lists, [
      {
        recipients: 'oncall@district.example, techs@district.example',
        campuses: 'Default recipients (NOTIFY_TO), for CHS, MHS, the monthly report, and the test email.',
        lastResult: 'Last sent 2026-10-06: [Temperature Alarms] Test email.',
        failed: false,
      },
      {
        recipients: 'chs-techs@district.example',
        campuses: 'For CHS, NHS.',
        lastResult: 'Last failure 2026-10-05: Invalid login: 535 Authentication failed',
        failed: true,
      },
      { recipients: 'mhs-techs@district.example', campuses: 'For MHS.', lastResult: 'Nothing sent in the last week.', failed: false },
    ]);
    assert.equal(
      notificationsSummary({ ...on, lists: [{ ...defaultList, campuses: [] }] }, day).lists[0].campuses,
      'Default recipients (NOTIFY_TO), for no Campus at present, the monthly report, and the test email.',
    );
  });

  it('counts what waits in the outbox and what was given up on, saying nothing when both are none', () => {
    const quiet = notificationsSummary(on, day);
    assert.equal(quiet.pending, null);
    assert.equal(quiet.failed, null);
    assert.equal(notificationsSummary({ ...on, pending: 1 }, day).pending, '1 notification waiting to be sent.');
    assert.equal(notificationsSummary({ ...on, pending: 3 }, day).pending, '3 notifications waiting to be sent.');
    assert.equal(notificationsSummary({ ...on, failed: 1 }, day).failed, '1 notification could not be delivered within a day and was given up on this week.');
    assert.equal(notificationsSummary({ ...on, failed: 2 }, day).failed, '2 notifications could not be delivered within a day and were given up on this week.');
    assert.equal(notificationsSummary({ ...off, pending: 4 }, day).pending, null, 'off says only that it is off');
  });
});

describe('testEmailSent', () => {
  it('names who the relay took it for and its reply', () => {
    assert.equal(
      testEmailSent({ sentAt: '', accepted: ['techs@district.example'], rejected: [], response: '250 2.0.0 OK' }),
      'Test email sent to techs@district.example. The relay answered: 250 2.0.0 OK',
    );
  });

  it('names any recipient the relay refused', () => {
    assert.equal(
      testEmailSent({ sentAt: '', accepted: ['techs@district.example'], rejected: ['gone@district.example'], response: '250 OK' }),
      'Test email sent to techs@district.example. It refused gone@district.example. The relay answered: 250 OK',
    );
  });
});

describe('the monthly report on request', () => {
  it('names the month as the report does', () => {
    assert.equal(monthName('2026-09'), 'September 2026');
    assert.equal(monthName('2026-12'), 'December 2026');
    assert.equal(monthName('2027-01'), 'January 2027');
  });

  it('says which month was queued and when it goes', () => {
    assert.equal(
      reportQueued({ month: '2026-09', queuedAt: '2026-10-15T17:00:00.000Z' }),
      'The report on September 2026 is queued for the default recipients and goes out within a minute.',
    );
  });
});
