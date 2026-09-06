import { Link } from 'react-router-dom';
import NumberFlow from '@number-flow/react';
import { History, Wifi, WifiOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { getMoldRiskLevel } from '@/lib/moldRisk';
import { formatAge, secondsUntilNextReport } from '@/lib/reportTiming';
import { cn } from '@/lib/utils';
import type { DashboardDevice } from '@/types';

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

/** Online while the last Reading is within three Report intervals; the server decides. */
function OnlineBadge({ online }: { online: boolean }) {
  return online ? (
    <Badge className="border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
      <Wifi aria-hidden />
      Online
    </Badge>
  ) : (
    <Badge variant="secondary" className="text-muted-foreground">
      <WifiOff aria-hidden />
      Offline
    </Badge>
  );
}

/** One Device: where it is, what it last reported, and whether it is still reporting. */
export function DeviceCard({ device, secondsSinceReading, reportIntervalSeconds }: DeviceCardProps) {
  const { latestReading, online } = device;
  const titleId = `device-${device.id}-title`;
  // Mold risk is the one Condition the browser still computes; ticket 08 moves it to the server.
  const moldRisk = latestReading ? getMoldRiskLevel(latestReading.tempF, latestReading.humidity) : 'none';

  return (
    <Card
      role="article"
      aria-labelledby={titleId}
      className={cn(
        'w-full gap-4 py-5 transition-colors',
        moldRisk === 'high' && 'border-destructive',
        moldRisk === 'moderate' && 'border-amber-500/70',
      )}
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
          <OnlineBadge online={online} />
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
        {moldRisk !== 'none' && (
          <div className="flex flex-wrap gap-1.5">
            <Badge
              variant={moldRisk === 'high' ? 'destructive' : 'secondary'}
              className={cn(moldRisk === 'moderate' && 'bg-amber-500/15 text-amber-700 dark:text-amber-400')}
            >
              Mold risk · {moldRisk}
            </Badge>
          </div>
        )}
      </CardContent>

      <CardFooter className="justify-between gap-3 border-t px-5 pt-4 text-sm text-muted-foreground">
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
          <Link to={`/history?device=${encodeURIComponent(device.hostname)}`} aria-label={`History for ${device.closet}`}>
            <History aria-hidden />
            History
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
