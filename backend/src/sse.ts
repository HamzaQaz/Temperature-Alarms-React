/**
 * Server-Sent Events to open dashboards (docs/adr/0001). One in-process set of connected
 * responses: the backend runs as a single process, so a Reading that arrives anywhere is
 * seen by every browser. A heartbeat comment keeps proxies from closing an idle stream;
 * reconnecting after a drop is the browser's EventSource doing what it does by default.
 * Every message is unnamed, its `data` a JSON object whose `type` says what it is: a `reading`
 * or an `incident`.
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
  /** The worst Reading during the incident; for Offline, the last Reading before it. */
  peak: {
    /** °F for Hot and Cold, percent for Dry and Mold risk, null for Offline. */
    value: number | null;
    tempF: number;
    humidity: number | null;
    recordedAt: string;
  };
  /** Oldest first; only the last can be open. */
  segments: { level: ConditionLevel; start: string; end: string | null }[];
}

/** What every open dashboard receives when an incident opens, changes level, or closes (docs/adr/0006). */
export interface IncidentEvent {
  type: 'incident';
  change: IncidentChange;
  incident: IncidentPayload;
}

/** Every message the stream carries, told apart by `type`. */
export type StreamEvent = ReadingEvent | IncidentEvent;

export interface Broadcaster {
  /** Express handler for GET /api/dashboard/stream. */
  readonly handler: RequestHandler;
  /** Send one event to every connected client. */
  broadcast(event: StreamEvent): void;
  /** How many dashboards are connected right now. */
  readonly clientCount: number;
  readonly heartbeatMs: number;
}

export interface BroadcasterOptions {
  /** How often to send a heartbeat comment. Under most proxies' idle timeout. */
  heartbeatMs?: number;
}

const DEFAULT_HEARTBEAT_MS = 25_000;

export function createBroadcaster({ heartbeatMs = DEFAULT_HEARTBEAT_MS }: BroadcasterOptions = {}): Broadcaster {
  const clients = new Set<Response>();
  let heartbeat: NodeJS.Timeout | undefined;

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
  };
}
