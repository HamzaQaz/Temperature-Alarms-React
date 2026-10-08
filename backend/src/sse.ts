/**
 * Server-Sent Events to open dashboards (docs/adr/0001). One in-process set of connected
 * responses: the backend runs as a single process, so a Reading that arrives anywhere is
 * seen by every browser. A heartbeat comment keeps proxies from closing an idle stream;
 * reconnecting after a drop is the browser's EventSource doing what it does by default.
 * Every message is unnamed, its `data` a JSON object whose `type` says what it is: a `reading`,
 * a `fault` report, or an `incident`. A stopping server ends every stream, telling the browser to
 * come back in 2 s (shutdown.ts).
 *
 * The response carries only the headers SSE needs. CORS is the shared middleware's job.
 */
import type { Request, RequestHandler, Response } from 'express';
import type { Condition, ConditionLevel, ConditionName } from './conditions';
import type { IncidentChange } from './incidents';

/** A Reading as the API sends it: the dashboard payload, the 201 on ingest, and the stream all use this shape. */
export interface ReadingPayload {
  tempF: number;
  humidity: number | null;
  /** ISO instant in UTC. */
  recordedAt: string;
}

/** What every open dashboard receives when a Device posts a Reading. */
export interface ReadingEvent {
  type: 'reading';
  /** The Device's hostname; the browser matches its card on this. */
  device: string;
  reading: ReadingPayload;
  online: boolean;
  /** Worst first, as the dashboard payload carries them. */
  conditions: Condition[];
  /** ISO instant in UTC: this Reading is the Device's last report. */
  lastReportAt: string;
}

/**
 * What every open dashboard receives when a Device posts a fault report (docs/adr/0009): its
 * sensor is not answering. No Reading came, so the card keeps its last one; its Conditions and
 * Online are new.
 */
export interface FaultEvent {
  type: 'fault';
  device: string;
  fault: 'sensor';
  online: boolean;
  /** Worst first, as the dashboard payload carries them. */
  conditions: Condition[];
  /** ISO instant in UTC: when the fault report arrived. */
  lastReportAt: string;
}

/** An incident as the API sends it: GET /api/incidents and the stream's `incident` message both use this shape. */
export interface IncidentPayload {
  id: number;
  device: {
    id: number;
    hostname: string;
    closet: string;
    campus: { id: number; name: string; shortcode: string };
  };
  condition: ConditionName;
  /** The worst level the incident reached. */
  level: ConditionLevel;
  /** ISO instants in UTC; `end` is null while the incident is ongoing. */
  start: string;
  end: string | null;
  /** The worst Reading during the incident; for Offline and Sensor fault, the last good Reading before it. */
  peak: {
    /** °F for Hot and Cold, percent for Dry and Mold risk, null for Offline and Sensor fault. */
    value: number | null;
    tempF: number;
    humidity: number | null;
    recordedAt: string;
  };
  /** Oldest first; only the last can be open. */
  segments: { level: ConditionLevel; start: string; end: string | null }[];
  /** Who said they are on it, and when (ISO instant in UTC); null until someone does. */
  acknowledgement: AcknowledgementPayload | null;
}

/** An Acknowledgement as the API sends it: a free-text name or short note, and when it was given. */
export interface AcknowledgementPayload {
  by: string;
  at: string;
}

/**
 * What every open dashboard receives when an incident opens, changes level, or closes
 * (docs/adr/0006), or when someone acknowledges it.
 */
export interface IncidentEvent {
  type: 'incident';
  change: IncidentChange | 'acknowledged';
  incident: IncidentPayload;
}

/** Every message the stream carries, told apart by `type`. */
export type StreamEvent = ReadingEvent | FaultEvent | IncidentEvent;

export interface Broadcaster {
  /** Express handler for GET /api/dashboard/stream. */
  readonly handler: RequestHandler;
  /** Send one event to every connected client. */
  broadcast(event: StreamEvent): void;
  /** How many dashboards are connected right now. */
  readonly clientCount: number;
  readonly heartbeatMs: number;
  /** End every stream with a 2 s retry and refuse new ones, as the server stops (shutdown.ts). */
  close(): void;
}

export interface BroadcasterOptions {
  /** How often to send a heartbeat comment. Under most proxies' idle timeout. */
  heartbeatMs?: number;
  /** Streams one address may hold open; past it, 429. */
  maxStreamsPerAddress?: number;
  /** Streams the server holds open in all; past it, 503. */
  maxStreams?: number;
}

const DEFAULT_HEARTBEAT_MS = 25_000;
/**
 * A browser holds at most six HTTP/1.1 connections to one origin, so one technician's tabs fit with
 * room to spare. Per address, room for a wall of screens behind one NAT, or every browser behind a
 * TLS proxy before TRUST_PROXY is set: the load test held 60 streams with SSE adding 1 to 2 ms
 * (.scratch/prodtest/load.md). nginx's limit_conn matches it. Each stream is a socket here and two
 * in nginx, whose 1024 worker connections are the tighter bound, so the total stays well under that.
 */
export const DEFAULT_MAX_STREAMS_PER_ADDRESS = 60;
export const DEFAULT_MAX_STREAMS = 400;
/** How soon a dashboard whose stream a stop ended reconnects, to the next process. Browsers wait 3 to 5 s by default. */
const RECONNECT_AFTER_STOP_MS = 2_000;

export function createBroadcaster({
  heartbeatMs = DEFAULT_HEARTBEAT_MS,
  maxStreamsPerAddress = DEFAULT_MAX_STREAMS_PER_ADDRESS,
  maxStreams = DEFAULT_MAX_STREAMS,
}: BroadcasterOptions = {}): Broadcaster {
  const clients = new Set<Response>();
  /** Open streams per address, as app.ts's trust proxy setting resolves it. */
  const perAddress = new Map<string, number>();
  let heartbeat: NodeJS.Timeout | undefined;
  let closed = false;

  // The timer runs only while someone is listening, so an idle server holds no timer at all.
  const startHeartbeat = () => {
    if (heartbeat !== undefined) return;
    heartbeat = setInterval(() => {
      for (const res of clients) res.write(': heartbeat\n\n');
    }, heartbeatMs);
    heartbeat.unref();
  };
  const stopHeartbeatIfIdle = () => {
    if (clients.size > 0 || heartbeat === undefined) return;
    clearInterval(heartbeat);
    heartbeat = undefined;
  };

  const handler = (req: Request, res: Response) => {
    if (closed) {
      res.status(503).json({ error: 'The server is stopping; try again shortly.' });
      return;
    }
    const address = req.ip ?? '';
    const held = perAddress.get(address) ?? 0;
    if (held >= maxStreamsPerAddress) {
      res.status(429).json({ error: 'Too many open streams from this address; close a tab and try again.' });
      return;
    }
    if (clients.size >= maxStreams) {
      res.status(503).json({ error: 'The server is holding as many streams as it can; try again shortly.' });
      return;
    }
    perAddress.set(address, held + 1);

    res.status(200).set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      // nginx would otherwise buffer the stream and nothing would arrive until it closed.
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    // A first comment so the browser's `open` event fires at once, before any Reading.
    res.write(': connected\n\n');

    clients.add(res);
    startHeartbeat();
    req.on('close', () => {
      clients.delete(res);
      const left = (perAddress.get(address) ?? 1) - 1;
      if (left > 0) perAddress.set(address, left);
      else perAddress.delete(address);
      stopHeartbeatIfIdle();
    });
  };

  return {
    handler,
    heartbeatMs,
    get clientCount() {
      return clients.size;
    },
    broadcast(event) {
      const frame = `data: ${JSON.stringify(event)}\n\n`;
      for (const res of clients) res.write(frame);
    },
    close() {
      closed = true;
      for (const res of clients) res.end(`retry: ${RECONNECT_AFTER_STOP_MS}\n\n`);
      // At once, not as each socket closes: a Reading or a sweep pass still in flight broadcasts after this.
      clients.clear();
      if (heartbeat !== undefined) clearInterval(heartbeat);
      heartbeat = undefined;
    },
  };
}
