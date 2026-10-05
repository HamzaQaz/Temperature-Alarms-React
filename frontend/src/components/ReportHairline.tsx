import { useState } from 'react';
import { usePageVisible } from '@/hooks/use-page-visible';
import { monotonicNow } from '@/lib/elapsed';
import { cn } from '@/lib/utils';

export type ReportState = 'due' | 'late' | 'offline' | 'none';

interface ReportHairlineProps {
  state: ReportState;
  /** When the latest Reading's age was zero, on the browser's monotonic clock (lib/elapsed.ts), from the server's age. */
  anchorMs: number | null;
  reportIntervalSeconds: number;
}

/**
 * The footer's top hairline, read as one progression: while a Device is on time a line over
 * it depletes across the Report interval, emptying as the next Reading falls due; when a
 * report is missed it stops and the hairline turns Warning Amber; once the server calls the
 * Device Offline the hairline goes dashed. The depletion is one CSS transform animation per
 * card, started once per Reading with a negative delay so it picks up mid-interval; no
 * re-render drives it, and it is unmounted while the tab is hidden and restarted on return.
 * Under reduced motion the line does not move; the amber and the dashes still say it.
 */
export function ReportHairline({ state, anchorMs, reportIntervalSeconds }: ReportHairlineProps) {
  const visible = usePageVisible();
  return (
    <span
      aria-hidden
      data-report={state}
      className={cn(
        'pointer-events-none absolute inset-x-0 -top-px h-0 border-t border-transparent transition-colors duration-300 ease-out-quint',
        state === 'late' && 'border-amber-500/70',
        state === 'offline' && 'border-dashed border-amber-500/70',
      )}
    >
      {state === 'due' && anchorMs !== null && visible && (
        <Depletion key={anchorMs} anchorMs={anchorMs} intervalMs={reportIntervalSeconds * 1000} />
      )}
    </span>
  );
}

function Depletion({ anchorMs, intervalMs }: { anchorMs: number; intervalMs: number }) {
  // Fixed at mount: where in the interval this Reading already is. A later render does not move it.
  const [delayMs] = useState(() => -Math.max(0, monotonicNow() - anchorMs));
  return (
    <span
      className="report-depletion absolute inset-x-0 -top-px h-px origin-left bg-muted-foreground/20"
      style={{ animationDuration: `${intervalMs}ms`, animationDelay: `${delayMs}ms` }}
    />
  );
}
