import { useEffect, useRef, useState } from 'react';
import { openDashboardStream } from '@/api';
import type { ReadingEvent } from '@/types';

/**
 * connecting: no stream yet. live: Readings arrive as they happen.
 * reconnecting: the stream dropped and the browser is retrying; what is on screen may be behind.
 */
export type StreamStatus = 'connecting' | 'live' | 'reconnecting';

interface ReadingStreamHandlers {
  onReading: (event: ReadingEvent) => void;
  /** The stream is open again after a drop. Reload, because anything sent meanwhile was missed. */
  onReconnect: () => void;
}

/** How long to wait before opening a new stream when the browser gave up on the old one. */
const REOPEN_AFTER_MS = 5_000;

/**
 * Subscribe to the live stream of Readings for as long as the component is mounted.
 * The browser's EventSource retries a dropped connection by itself; the one case it
 * gives up on (a non-200 answer, as from a proxy mid-restart) is reopened here after a
 * pause, so a dashboard on a wall screen never needs a hand.
 */
export function useReadingStream({ onReading, onReconnect }: ReadingStreamHandlers): StreamStatus {
  const [status, setStatus] = useState<StreamStatus>('connecting');
  // Handlers change identity on every render; the stream must not.
  const handlers = useRef({ onReading, onReconnect });
  useEffect(() => {
    handlers.current = { onReading, onReconnect };
  });

  useEffect(() => {
    let stream: EventSource | undefined;
    let reopenTimer: ReturnType<typeof setTimeout> | undefined;
    let dropped = false;

    const open = () => {
      stream = openDashboardStream();
      stream.onopen = () => {
        setStatus('live');
        if (dropped) {
          dropped = false;
          handlers.current.onReconnect();
        }
      };
      stream.onmessage = (message: MessageEvent<string>) => {
        let event: ReadingEvent;
        try {
          event = JSON.parse(message.data) as ReadingEvent;
        } catch {
          return;
        }
        if (event.type === 'reading') handlers.current.onReading(event);
      };
      stream.onerror = () => {
        dropped = true;
        setStatus('reconnecting');
        if (stream?.readyState === EventSource.CLOSED) {
          reopenTimer = setTimeout(open, REOPEN_AFTER_MS);
        }
      };
    };
    open();

    return () => {
      clearTimeout(reopenTimer);
      stream?.close();
    };
  }, []);

  return status;
}
