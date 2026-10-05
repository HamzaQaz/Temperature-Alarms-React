import { useCallback, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import NumberFlow from '@number-flow/react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { History, Wifi, WifiOff } from 'lucide-react';
import { EscalationTrace } from '@/components/EscalationTrace';
import { ReportHairline, type ReportState } from '@/components/ReportHairline';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { useLanded } from '@/hooks/use-landed';
import { headingScope, morphTo, type HistorySeed } from '@/lib/card-morph';
import { levelLook, levelRank, worstCondition } from '@/lib/conditions';
import { EASE_OUT_EXPO_CSS, crossfade, reveal } from '@/lib/motion';
import { formatAge, nextReport, type NextReport } from '@/lib/reportTiming';
import { cn } from '@/lib/utils';
import type { Condition, ConditionLevel, DashboardDevice } from '@/types';

interface DeviceCardProps {
  device: DashboardDevice;
  /** Seconds since the latest Reading, ticking in the browser; null when there is none. */
  secondsSinceReading: number | null;
  /** When the latest Reading's age was zero, in this browser's clock; null when there is none. */
  anchorMs: number | null;
  reportIntervalSeconds: number;
}

interface MeasureProps {
  label: string;
  value: number | null;
  unit: string;
  size: 'lg' | 'md';
  dimmed: boolean;
}

/** A digit rolling to a new Reading: brisk and decelerating, so it settles before the eye leaves it. */
const SPIN = { duration: 400, easing: EASE_OUT_EXPO_CSS };

/**
 * A large reading meant to be legible from across a room. The readout clips vertically so a
 * rolling digit stays inside its own line and never crosses the label above. The temperature's
 * unit is half the figure, as in History's header, so the two line up when the readout travels there.
 */
function Measure({ label, value, unit, size, dimmed }: MeasureProps) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        data-morph={size === 'lg' ? 'temp' : undefined}
        className={cn(
          'w-fit overflow-y-clip font-semibold tabular-nums leading-none tracking-tight transition-colors duration-300 ease-out-quint',
          size === 'lg' ? 'text-5xl xl:text-6xl' : 'text-3xl xl:text-4xl',
          dimmed || value === null ? 'text-muted-foreground' : 'text-foreground',
        )}
      >
        {value === null ? (
          <span aria-label={`No ${label.toLowerCase()} reading`}>—</span>
        ) : (
          <>
            <NumberFlow value={value} spinTiming={SPIN} />
            <span className={cn('font-medium text-muted-foreground', size === 'lg' ? 'text-[0.5em]' : 'text-lg xl:text-xl')}>{unit}</span>
          </>
        )}
      </p>
    </div>
  );
}

/**
 * "Next in 12s" while the Device is on time; "Expected 15s ago" once a report is missed,
 * until the server calls it Offline. The two crossfade, so the change of state reads as one.
 * The seconds themselves change in place, in tabular figures: a count that rolled every
 * second would be motion performing, and the hairline above already shows the interval passing.
 */
function NextReportNote({ status, seconds }: NextReport) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      {status === 'due' ? (
        <motion.span key="due" {...crossfade} className="tabular-nums">
          Next in {seconds}s
        </motion.span>
      ) : (
        <motion.span key="late" {...crossfade} className="tabular-nums text-amber-700 dark:text-amber-400">
          Expected {seconds}s ago
        </motion.span>
      )}
    </AnimatePresence>
  );
}

/**
 * Online, or the Offline Condition. The server decides; Offline is shown here rather than
 * among the other badges so the card carries it once, in the place the eye already checks.
 */
function OnlineBadge({ offline }: { offline: Condition | undefined }) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence mode="wait" initial={false}>
      {offline === undefined ? (
        <motion.span key="online" data-badge="online" {...crossfade} className="flex shrink-0">
          <Badge className="border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
            <Wifi aria-hidden />
            Online
          </Badge>
        </motion.span>
      ) : (
        // Offline arrives from the right, the side of the card the trace starts from.
        <motion.span key="offline" data-badge="offline" {...(reduced ? crossfade : reveal('right'))} className="flex shrink-0">
          <Badge className={levelLook(offline.level).badge}>
            <WifiOff aria-hidden />
            Offline
          </Badge>
        </motion.span>
      )}
    </AnimatePresence>
  );
}

/** One badge per active Condition, sized to be read from across a room. */
function ConditionBadge({ condition }: { condition: Condition }) {
  return (
    <Badge className={cn('px-2.5 py-1 text-sm font-semibold', levelLook(condition.level).badge)}>
      {condition.name}
      <span className="font-normal opacity-80">· {condition.level}</span>
    </Badge>
  );
}

/**
 * How many times the worst Condition has risen (none, moderate, warning, high, critical)
 * since the card mounted. A fall does not count, and nor does the level the card mounted
 * with: that was already true when the page loaded. State is adjusted during render, as in
 * `useLanded`.
 */
function useEscalations(level: ConditionLevel | undefined): number {
  const rank = levelRank(level);
  const [seen, setSeen] = useState({ rank, count: 0 });
  if (seen.rank !== rank) setSeen({ rank, count: rank > seen.rank ? seen.count + 1 : seen.count });
  return seen.count;
}

/** One Device: where it is, what it last reported, and whether it is still reporting. */
export function DeviceCard({ device, secondsSinceReading, anchorMs, reportIntervalSeconds }: DeviceCardProps) {
  const { latestReading, online, conditions } = device;
  const titleId = `device-${device.id}-title`;
  const offline = conditions.find((c) => c.name === 'Offline');
  const readingConditions = conditions.filter((c) => c.name !== 'Offline');
  const worst = worstCondition(conditions);
  const reduced = useReducedMotion();
  const cardRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();

  // A Reading that arrived while the card was on screen: the fill rises to Raised Grey and
  // settles back as the numbers count, so the eye is told which closet just spoke.
  const landed = useLanded(latestReading?.recordedAt);

  // A rise in the worst Condition draws the new border around the card from its badge, once.
  // The card's own border waits for the stroke to close, then takes the colour. A fall is quiet:
  // the border crossfades back over 300 ms.
  const escalations = useEscalations(worst?.level);
  const [traced, setTraced] = useState(0);
  const tracing = !reduced && worst !== undefined && escalations > traced;
  const finishTrace = useCallback(() => setTraced(escalations), [escalations]);
  const worstName = worst?.name;
  const traceOrigin = useCallback(() => {
    if (worstName === undefined) return null;
    const selector = worstName === 'Offline' ? '[data-badge]' : `[data-condition="${worstName}"]`;
    return cardRef.current?.querySelector(selector) ?? null;
  }, [worstName]);
  const traceCard = useCallback(() => cardRef.current, []);

  const report: ReportState =
    latestReading === null || secondsSinceReading === null ? 'none' : !online ? 'offline' : nextReport(secondsSinceReading, reportIntervalSeconds).status;

  // History opens with the Closet name, Campus and temperature carried from this card into its header.
  const historyPath = `/history/${device.id}`;
  const seed: HistorySeed = {
    id: device.id,
    closet: device.closet,
    closetType: device.closetType,
    campusName: device.campus.name,
    hostname: device.hostname,
    tempF: latestReading?.tempF ?? null,
    back: location.pathname + location.search,
  };
  const openHistory = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    morphTo(
      cardRef.current,
      () => navigate(historyPath, { state: { seed } }),
      () => headingScope(device.id),
      () => window.scrollTo(0, 0),
    );
  };

  return (
    <Card
      ref={cardRef}
      role="article"
      aria-labelledby={titleId}
      data-device-card={device.id}
      className={cn(
        'relative isolate w-full gap-4 py-5 transition-colors duration-300 ease-out-quint',
        worst && levelLook(worst.level).border,
        tracing && 'delay-[460ms] duration-150',
      )}
    >
      {landed > 0 && (
        <span
          key={landed}
          aria-hidden
          data-reduced="fade"
          className="pointer-events-none absolute inset-0 -z-10 rounded-[inherit] bg-accent opacity-0 animate-reading-landed"
        />
      )}

      {tracing && (
        <EscalationTrace key={escalations} card={traceCard} origin={traceOrigin} strokeClass={levelLook(worst.level).trace} onDone={finishTrace} />
      )}

      {/* One column that may shrink below its content, so a long Closet name truncates and the badge never clips. */}
      <CardHeader className="grid-cols-[minmax(0,1fr)] gap-1 px-5">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm text-muted-foreground" title={device.campus.name}>
              <span data-morph="campus" className="inline-block max-w-full truncate align-top">
                {device.campus.name}
              </span>
            </p>
            {/* The name and its IDF/MDF tag travel to History together, as one piece of the header. */}
            <div data-morph="closet" className="mt-0.5 flex w-fit max-w-full items-center gap-2">
              <h2 id={titleId} title={device.closet} className="min-w-0 truncate text-lg font-semibold leading-tight">
                {device.closet}
              </h2>
              {device.closetType && (
                <Badge
                  variant="outline"
                  className={cn(
                    'shrink-0',
                    device.closetType === 'MDF' && 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300',
                  )}
                >
                  {device.closetType}
                </Badge>
              )}
            </div>
          </div>
          <OnlineBadge offline={offline} />
        </div>
      </CardHeader>

      <CardContent className="space-y-4 px-5">
        {latestReading === null ? (
          <p className="py-3 text-muted-foreground">
            No readings yet from <span className="font-mono text-sm">{device.hostname}</span>
          </p>
        ) : (
          <div className="flex items-end justify-between gap-6">
            <Measure label="Temperature" value={latestReading.tempF} unit="°F" size="lg" dimmed={!online} />
            <Measure label="Humidity" value={latestReading.humidity} unit="%" size="md" dimmed={!online} />
          </div>
        )}
        <AnimatePresence initial={false}>
          {readingConditions.length > 0 && (
            <motion.ul key="conditions" className="relative flex flex-wrap gap-1.5" aria-label="Conditions" {...crossfade}>
              {/* Keyed by level too, so a Condition that worsens arrives again from the edge the trace starts on.
                  The names still present tell an outgoing badge whether it was replaced (gone at once) or is leaving (fades). */}
              <AnimatePresence initial={false} mode="popLayout" custom={readingConditions.map((c) => c.name)}>
                {readingConditions.map((condition) => (
                  <motion.li
                    key={`${condition.name}:${condition.level}`}
                    data-condition={condition.name}
                    className="relative z-[1]"
                    layout="position"
                    layoutDependency={readingConditions.map((c) => c.name + c.level).join()}
                    {...(reduced ? crossfade : reveal('left', condition.name))}
                  >
                    <ConditionBadge condition={condition} />
                  </motion.li>
                ))}
              </AnimatePresence>
            </motion.ul>
          )}
        </AnimatePresence>
      </CardContent>

      <CardFooter className="relative mt-auto justify-between gap-3 border-t px-5 pt-4 text-sm text-muted-foreground">
        <ReportHairline state={report} anchorMs={anchorMs} reportIntervalSeconds={reportIntervalSeconds} />
        {latestReading === null || secondsSinceReading === null ? (
          <span>Never reported</span>
        ) : (
          <span className="flex min-w-0 flex-wrap gap-x-3 tabular-nums">
            <time dateTime={latestReading.recordedAt} title={new Date(latestReading.recordedAt).toLocaleString()}>
              {formatAge(secondsSinceReading)}
            </time>
            {online && <NextReportNote {...nextReport(secondsSinceReading, reportIntervalSeconds)} />}
          </span>
        )}

        <Button asChild size="sm" variant="outline" className="shrink-0">
          <Link to={historyPath} state={{ seed }} onClick={openHistory} aria-label={`History for ${device.closet}`}>
            <History aria-hidden />
            History
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
