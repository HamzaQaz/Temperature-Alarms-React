/**
 * What a firmware hold email says (docs/adr/0007, 0008): which release stopped, which of the Devices
 * it went to first failed it and how, and where to act. Its own email, never part of an Incident
 * digest: it is about the release, not a closet. Plain, like the Incident emails: no images, nothing
 * loaded from anywhere.
 *
 * A pure function: no I/O, no clock. The time zone and the dashboard's address are handed in.
 */
import { holdText, type QueuedHold } from './firmwareStore';
import type { Email } from './mailer';
import { escapeHtml, SUBJECT_PREFIX, when, type EmailSettings } from './notificationEmail';

/** "went Offline", "went into Sensor fault", "failed to install it": the subject's short form. */
const SUBJECT_REASON = { Offline: 'went Offline', 'Sensor fault': 'went into Sensor fault', 'update failed': 'failed to install it' } as const;

/** The email for a held release, as it stands when sent. */
export function holdEmail({ version, hold, device }: QueuedHold, { publicUrl, timeZone }: EmailSettings): Email {
  const heading = `Firmware ${version} is held: ${holdText(hold)}.`;
  const details = [
    device === null ? hold.hostname : `${device.campus.name} (${device.campus.shortcode}), ${device.closet}, ${hold.hostname}`,
    `Held: ${when(hold.at, timeZone)}`,
    'No other Device is offered it; the Devices that installed it keep it.',
    'Withdraw it, or publish a fixed build with a higher version, on the Firmware tab.',
  ];
  const settings = { url: `${publicUrl}/settings?tab=firmware`, text: 'Settings, Firmware' };
  const footer = `Sent by Temperature Alarms (${publicUrl}). Times are ${timeZone}.`;

  const text = [heading, ...details, `Firmware: ${settings.url}`, '', '--', footer, ''].join('\n');
  const html = [
    '<!doctype html>',
    '<html><body style="font-family: Arial, Helvetica, sans-serif; font-size: 15px; line-height: 1.4; color: #1a1a1a;">',
    `<p style="margin: 0 0 16px;"><strong>${escapeHtml(heading)}</strong><br>${details.map(escapeHtml).join('<br>')}<br>` +
      `<a href="${escapeHtml(settings.url)}">${escapeHtml(settings.text)}</a></p>`,
    `<p style="margin: 24px 0 0; font-size: 13px; color: #555;">${escapeHtml(footer)}</p>`,
    '</body></html>',
  ].join('\n');

  return { subject: `${SUBJECT_PREFIX} Firmware ${version} held: ${hold.hostname} ${SUBJECT_REASON[hold.reason]}`, text, html };
}
