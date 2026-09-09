import { Link } from 'react-router-dom';
import NumberFlow from '@number-flow/react';
import { AnimatePresence, motion } from 'framer-motion';
import { History, Wifi, WifiOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { useLanded } from '@/hooks/use-landed';
import { levelLook, worstCondition } from '@/lib/conditions';
import { crossfade } from '@/lib/motion';
import { formatAge, nextReport, type NextReport } from '@/lib/reportTiming';
import { cn } from '@/lib/utils';
import type { Condition, DashboardDevice } from '@/types';

interface DeviceCardProps {
  device: DashboardDevice;
  /** Seconds since the latest Reading, ticking in the browser; null when there is none. */
  secondsSinceReading: number | null;
  reportIntervalSeconds: number;
}

interface MeasureProps {
  label: string;
  value: number | null;
  unit: string;
  size: 'lg' | 'md';
  dimmed: boolean;
}

/** A large reading meant to be legible from across a room. */
function Measure({ label, value, unit, size, dimmed }: MeasureProps) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          'font-semibold tabular-nums leading-none tracking-tight transition-colors duration-300 ease-out-quint',
          size === 'lg' ? 'text-5xl xl:text-6xl' : 'text-3xl xl:text-4xl',
          dimmed || value === null ? 'text-muted-foreground' : 'text-foreground',
        )}
      >
        {value === null ? (
          <span aria-label={`No ${label.toLowerCase()} reading`}>—</span>
        ) : (
          <>
            <NumberFlow value={value} />
            <span className={cn('font-medium text-muted-foreground', size === 'lg' ? 'text-2xl xl:text-3xl' : 'text-lg xl:text-xl')}>{unit}</span>
          </>
        )}
      </p>
    </div>
  );
}

/**
 * "Next in 12s" while the Device is on time; "Expected 15s ago" once a report is missed,
 * until the server calls it Offline. The two crossfade, so the change of state reads as one.
 */
function NextReportNote({ status, seconds }: NextReport) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      {status === 'due' ? (
        <motion.span key="due" {...crossfade}>
          Next in <NumberFlow value={seconds} suffix="s" />
        </motion.span>
      ) : (
        <motion.span key="late" {...crossfade} className="text-amber-700 dark:text-amber-400">
          Expected <NumberFlow value={seconds} suffix="s" /> ago
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
  return (
    <AnimatePresence mode="wait" initial={false}>
      {offline === undefined ? (
        <motion.span key="online" {...crossfade} className="flex">
          <Badge className="border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
            <Wifi aria-hidden />
            Online
          </Badge>
        </motion.span>
      ) : (
        <motion.span key="offline" {...crossfade} className="flex">
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

/** One Device: where it is, what it last reported, and whether it is still reporting. */
export function DeviceCard({ device, secondsSinceReading, reportIntervalSeconds }: DeviceCardProps) {
  const { latestReading, online, conditions } = device;
  const titleId = `device-${device.id}-title`;
  const offline = conditions.find((c) => c.name === 'Offline');
  const readingConditions = conditions.filter((c) => c.name !== 'Offline');
  const worst = worstCondition(conditions);
  // A Reading that arrived while the card was on screen: the fill rises to Raised Grey and
  // settles back as the numbers count, so the eye is told which closet just spoke.
  const landed = useLanded(latestReading?.recordedAt);

  return (
    <Card
      role="article"
      aria-labelledby={titleId}
      className={cn('relative isolate w-full gap-4 py-5 transition-colors duration-300 ease-out-quint', worst && levelLook(worst.level).border)}
    >
      {landed > 0 && (
        <span
          key={landed}
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 rounded-[inherit] bg-accent opacity-0 motion-safe:animate-reading-landed"
        />
      )}

      <CardHeader className="gap-1 px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm text-muted-foreground">{device.campus.name}</p>
            <div className="mt-0.5 flex items-center gap-2">
              <h2 id={titleId} className="truncate text-lg font-semibold leading-tight">
                {device.closet}
              </h2>
              {device.closetType && (
                <Badge
                  variant="outline"
                  className={cn(
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
            <motion.ul key="conditions" className="flex flex-wrap gap-1.5" aria-label="Conditions" {...crossfade}>
              <AnimatePresence initial={false}>
                {readingConditions.map((condition) => (
                  <motion.li key={condition.name} layout {...crossfade}>
                    <ConditionBadge condition={condition} />
                  </motion.li>
                ))}
              </AnimatePresence>
            </motion.ul>
          )}
        </AnimatePresence>
      </CardContent>

      <CardFooter className="mt-auto justify-between gap-3 border-t px-5 pt-4 text-sm text-muted-foreground">
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
          <Link to={`/history/${device.id}`} aria-label={`History for ${device.closet}`}>
            <History aria-hidden />
            History
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
