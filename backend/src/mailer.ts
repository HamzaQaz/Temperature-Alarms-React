import { createTransport } from 'nodemailer';
import type { NotificationsConfig } from './config';

/** One email: plain text, with an optional simple HTML part. */
export interface Email {
  subject: string;
  text: string;
  html?: string;
  /** Who it goes to: NOTIFY_TO when unset, or one recipient list (docs/adr/0008). */
  to?: string[];
}

/** What the relay said when it took an email. */
export interface SentEmail {
  messageId: string;
  /** The relay's final reply, e.g. `250 2.0.0 OK queued as 1A2B3C`. */
  response: string;
  accepted: string[];
  rejected: string[];
}

/** The relay refused or could not be reached. The message is safe to show: it never holds the SMTP password. */
export class MailerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailerError';
  }
}

/**
 * How email leaves the server (docs/adr/0008). createApp makes the SMTP one from the config;
 * tests may pass their own.
 */
export interface Mailer {
  /** Hand one email to the relay, for its recipients (NOTIFY_TO unless it names its own). Rejects with a MailerError. */
  send(email: Email): Promise<SentEmail>;
}

/**
 * Short enough that the Settings test button answers while someone is still looking at it, long
 * enough for a slow district relay. nodemailer's own defaults wait two minutes to connect.
 */
const CONNECTION_TIMEOUT_MS = 10_000;
const SOCKET_TIMEOUT_MS = 30_000;

/** Removes the password, and the encodings AUTH sends it in, from anything the relay echoed back. */
function scrubbed(message: string, auth: NotificationsConfig['smtp']['auth']): string {
  if (auth === undefined) return message;
  const secrets = [
    auth.password,
    Buffer.from(auth.password).toString('base64'),
    Buffer.from(`\0${auth.user}\0${auth.password}`).toString('base64'),
  ];
  return secrets.reduce((text, secret) => text.split(secret).join('********'), message);
}

/** A Mailer that sends through the configured relay, one connection per email. */
export function createMailer({ smtp, from, to }: NotificationsConfig): Mailer {
  const transport = createTransport({
    host: smtp.host,
    port: smtp.port,
    // starttls: a plain connection that must upgrade, never falling back to plain text; tls: TLS from
    // the first byte; none: plain text, for a relay on the same trusted network that offers no TLS.
    secure: smtp.secure === 'tls',
    requireTLS: smtp.secure === 'starttls',
    ignoreTLS: smtp.secure === 'none',
    auth: smtp.auth === undefined ? undefined : { user: smtp.auth.user, pass: smtp.auth.password },
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: CONNECTION_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
  });
  return {
    async send({ subject, text, html, to: recipients = to }) {
      try {
        const info = await transport.sendMail({ from, to: recipients, subject, text, html });
        return { messageId: info.messageId, response: info.response, accepted: info.accepted, rejected: info.rejected };
      } catch (error) {
        // Only the message crosses: nodemailer's error object also carries the command it sent.
        const message = error instanceof Error ? error.message : String(error);
        throw new MailerError(scrubbed(message, smtp.auth));
      }
    },
  };
}
