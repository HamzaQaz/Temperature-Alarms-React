import { Link } from 'react-router-dom';
import NumberFlow from '@number-flow/react';
import { History, Wifi, WifiOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { levelLook, worstCondition } from '@/lib/conditions';
import { formatAge, secondsUntilNextReport } from '@/lib/reportTiming';
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
          'font-semibold tabular-nums leading-none tracking-tight',
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
 * Online, or the Offline Condition. The server decides; Offline is shown here rather than
 * among the other badges so the card carries it once, in the place the eye already checks.
 */
function OnlineBadge({ offline }: { offline: Condition | undefined }) {
  return offline === undefined ? (
    <Badge className="border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
      <Wifi aria-hidden />
      Online
    </Badge>
  ) : (
    <Badge className={levelLook(offline.level).badge}>
      <WifiOff aria-hidden />
      Offline
    </Badge>
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

  return (
    <Card
      role="article"
      aria-labelledby={titleId}
      className={cn('w-full gap-4 py-5 transition-colors', worst && levelLook(worst.level).border)}
    >
      <CardHeader className="gap-1 px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm text-muted-foreground">{device.campus.name}</p>
            <div className="mt-0.5 flex items-center gap-2">
              <h3 id={titleId} className="truncate text-lg font-semibold leading-tight">
                {device.closet}
              </h3>
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
        {readingConditions.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Conditions">
            {readingConditions.map((condition) => (
              <li key={condition.name}>
                <ConditionBadge condition={condition} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <CardFooter className="mt-auto justify-between gap-3 border-t px-5 pt-4 text-sm text-muted-foreground">
        {latestReading === null || secondsSinceReading === null ? (
          <span>Never reported</span>
        ) : (
          <span className="flex min-w-0 flex-wrap gap-x-3 tabular-nums">
            <time dateTime={latestReading.recordedAt} title={new Date(latestReading.recordedAt).toLocaleString()}>
              {formatAge(secondsSinceReading)}
            </time>
            {online && (
              <span>
                Next in <NumberFlow value={secondsUntilNextReport(secondsSinceReading, reportIntervalSeconds)} suffix="s" />
              </span>
            )}
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
