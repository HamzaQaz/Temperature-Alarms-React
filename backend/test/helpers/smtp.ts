import { SMTPServer } from 'smtp-server';
import type { NotificationsConfig } from '../../src/config';

/** An email as it reached the test relay: the envelope, and the message as sent. */
export interface ReceivedEmail {
  from: string;
  to: string[];
  /** The Subject header, unfolded and decoded. */
  subject: string;
  /** The From header. */
  fromHeader: string;
  /** The plain text body (the text/plain part of a multipart one), decoded, so a test need not care where a line was folded. */
  text: string;
  /** The text/html part, decoded; empty when the email has none. */
  html: string;
  raw: string;
}

export interface TestRelay {
  port: number;
  /** Every email the relay took, in order. */
  received: ReceivedEmail[];
  /** Addresses the relay refuses at RCPT TO, as a relay does a mailbox it does not know; an email to none other fails. */
  refuse: Set<string>;
  /** Notifications config pointing at this relay, plain SMTP, with any override. */
  config(overrides?: Partial<NotificationsConfig['smtp']>): NotificationsConfig;
  close(): Promise<void>;
}

/** The headers, unfolded, and the body of a message or of one MIME part. */
const split = (raw: string): { head: string; body: string } => {
  const [head, ...rest] = raw.split(/\r?\n\r?\n/);
  return { head: head.replace(/\r?\n[ \t]+/g, ' '), body: rest.join('\n\n') };
};

const header = (head: string, name: string): string => new RegExp(`^${name}:\\s*(.*)$`, 'im').exec(head)?.[1]?.trim() ?? '';

/** `=XX` escapes undone, read as UTF-8. */
const fromHexes = (text: string): string =>
  Buffer.from(text.replace(/=([0-9A-F]{2})/gi, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16))), 'latin1').toString('utf8');

/** RFC 2047 encoded words undone, as nodemailer writes a subject holding `°`. */
const decodeWords = (value: string): string =>
  value
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?[^?]+\?([QB])\?([^?]*)\?=/gi, (_match, encoding: string, text: string) =>
      encoding.toUpperCase() === 'B' ? Buffer.from(text, 'base64').toString('utf8') : fromHexes(text.replace(/_/g, ' ')),
    );

/** A body undone from its transfer encoding. */
const decodeBody = (head: string, body: string): string => {
  const encoding = header(head, 'Content-Transfer-Encoding').toLowerCase();
  if (encoding === 'quoted-printable') return fromHexes(body.replace(/=\r?\n/g, ''));
  if (encoding === 'base64') return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
  return body;
};

/** The plain text and HTML bodies of a message, single part or multipart/alternative. */
const bodiesOf = (raw: string): { text: string; html: string } => {
  const { head, body } = split(raw);
  const boundary = /boundary="?([^";]+)"?/i.exec(header(head, 'Content-Type'))?.[1];
  if (boundary === undefined) return { text: decodeBody(head, body), html: '' };
  const parts = body
    .split(`--${boundary}`)
    .slice(1, -1)
    .map((part) => split(part.replace(/^\r?\n/, '')));
  const typed = (type: string) => parts.find((part) => header(part.head, 'Content-Type').startsWith(type));
  const text = typed('text/plain');
  const html = typed('text/html');
  return { text: text === undefined ? '' : decodeBody(text.head, text.body), html: html === undefined ? '' : decodeBody(html.head, html.body) };
};

/**
 * An SMTP server in this process, so a test asserts on what actually arrived. Plain text by
 * default (it offers no STARTTLS); `login` makes it require that user and password, and a wrong
 * login is refused with a reply that echoes the password, to prove the API never repeats it.
 * `port` binds that port, so a relay can come back where a closed one was.
 */
export async function startTestRelay({ login, port: wanted = 0 }: { login?: { user: string; password: string }; port?: number } = {}): Promise<TestRelay> {
  const received: ReceivedEmail[] = [];
  const refuse = new Set<string>();
  const server = new SMTPServer({
    disabledCommands: login === undefined ? ['STARTTLS', 'AUTH'] : ['STARTTLS'],
    allowInsecureAuth: true,
    authOptional: login === undefined,
    logger: false,
    onAuth(auth, _session, callback) {
      if (login !== undefined && auth.username === login.user && auth.password === login.password) {
        callback(null, { user: auth.username });
        return;
      }
      callback(new Error(`Invalid login for ${auth.username} with password ${auth.password}`));
    },
    onRcptTo(address, _session, callback) {
      callback(refuse.has(address.address) ? Object.assign(new Error(`5.1.1 <${address.address}>: mailbox unavailable`), { responseCode: 550 }) : undefined);
    },
    onData(stream, session, callback) {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const { head } = split(raw);
        received.push({
          from: session.envelope.mailFrom === false ? '' : session.envelope.mailFrom.address,
          to: session.envelope.rcptTo.map((rcpt) => rcpt.address),
          subject: decodeWords(header(head, 'Subject')),
          fromHeader: header(head, 'From'),
          ...bodiesOf(raw),
          raw,
        });
        callback();
      });
    },
  });
  const port: number = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(wanted, '127.0.0.1', () => {
      const address = server.server.address();
      if (address === null || typeof address === 'string') reject(new Error('Test relay did not bind to a TCP port'));
      else resolve(address.port);
    });
  });
  return {
    port,
    received,
    refuse,
    config: (overrides = {}) => ({
      smtp: { host: '127.0.0.1', port, secure: 'none', auth: login, ...overrides },
      from: 'alarms@district.example',
      to: ['techs@district.example', 'oncall@district.example'],
      toAll: false,
      publicUrl: 'https://alarms.district.example',
      coalesceSeconds: 60,
      remindHours: 0,
    }),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
