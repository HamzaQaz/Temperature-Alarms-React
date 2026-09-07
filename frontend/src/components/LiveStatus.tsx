import type { StreamStatus } from '@/hooks/use-reading-stream';
import { cn } from '@/lib/utils';

const LOOK: Record<StreamStatus, { label: string; dot: string; text: string }> = {
  connecting: { label: 'Connecting', dot: 'bg-muted-foreground/60', text: 'text-muted-foreground' },
  live: { label: 'Live', dot: 'bg-emerald-500', text: 'text-muted-foreground' },
  reconnecting: {
    label: 'Reconnecting',
    dot: 'bg-amber-500 motion-safe:animate-pulse',
    text: 'text-amber-700 dark:text-amber-400',
  },
};

/**
 * Whether Readings are arriving as they happen. Quiet while live; amber while the
 * browser is retrying, so a wall screen showing stale numbers says so.
 */
export function LiveStatus({ status }: { status: StreamStatus }) {
  const { label, dot, text } = LOOK[status];
  return (
    <span role="status" className={cn('flex items-center gap-1.5 text-sm tabular-nums', text)}>
      <span className={cn('size-2 rounded-full', dot)} aria-hidden />
      {label}
      {status === 'reconnecting' && <span className="sr-only">: live updates paused</span>}
    </span>
  );
}
