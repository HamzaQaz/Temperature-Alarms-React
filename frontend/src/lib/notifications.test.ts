import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { notificationsSummary, testEmailSent } from './notifications.ts';
import type { NotificationStatus } from '../types.ts';

const off: NotificationStatus = { enabled: false, relay: null, from: null, recipients: [], lastSent: null, lastFailure: null, pending: 0, failed: 0 };
const on: NotificationStatus = {
  enabled: true,
  relay: { host: 'relay.district.example', port: 587, secure: 'starttls' },
  from: 'alarms@district.example',
  recipients: ['techs@district.example', 'oncall@district.example'],
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
    assert.equal(summary.lastSent, null);
    assert.equal(summary.lastFailure, null);
  });

  it('names the relay, its security, the sender, and every recipient', () => {
    const summary = notificationsSummary(on, day);
    assert.equal(summary.state, 'On, through relay.district.example:587 (STARTTLS), from alarms@district.example.');
    assert.equal(summary.detail, 'Sent to techs@district.example, oncall@district.example.');
    assert.equal(summary.lastSent, null);
    assert.equal(summary.lastFailure, null);
    assert.match(notificationsSummary({ ...on, relay: { host: 'relay', port: 25, secure: 'none' } }, day).state, /\(no encryption\)/);
  });

  it('gives the last send and the last failure with their times', () => {
    const summary = notificationsSummary(
      {
        ...on,
        lastSent: { at: '2026-10-06T14:00:00.000Z', subject: '[Temperature Alarms] Test email' },
        lastFailure: { at: '2026-10-05T09:00:00.000Z', error: 'Invalid login: 535 Authentication failed' },
      },
      day,
    );
    assert.equal(summary.lastSent, 'Last sent 2026-10-06: [Temperature Alarms] Test email.');
    assert.equal(summary.lastFailure, 'Last failure 2026-10-05: Invalid login: 535 Authentication failed');
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
