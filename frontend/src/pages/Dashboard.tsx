import { useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import NumberFlow from '@number-flow/react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { getCampuses, getDashboard } from '@/api';
import { DeviceCard } from '@/components/DeviceCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { getMoldRiskLevel } from '@/lib/moldRisk';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useNow } from '@/hooks/use-now';
import { useResource } from '@/hooks/use-resource';
import type { Dashboard as DashboardPayload, DashboardDevice } from '@/types';

const ALL = 'all';

/** The dashboard: every Device's latest Reading, filtered by Campus from the URL. */
export default function Dashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const campusParam = searchParams.get('campus') ?? '';
  const campuses = useResource(getCampuses);

  const campusList = campuses.state.status === 'ready' ? campuses.state.data : [];
  const selected = campusList.find((c) => c.shortcode.toLowerCase() === campusParam.toLowerCase());
  const tabValue = campusParam === '' ? ALL : (selected?.shortcode ?? campusParam);

  const showCampus = (value: string) => setSearchParams(value === ALL ? {} : { campus: value });

  return (
    <div className="flex-1 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-muted-foreground">The latest Reading from every closet.</p>
        </div>
      </header>

      {campusList.length > 0 && (
        <Tabs value={tabValue} onValueChange={showCampus}>
          <div className="overflow-x-auto pb-1">
            <TabsList aria-label="Filter by campus">
              <TabsTrigger value={ALL}>All campuses</TabsTrigger>
              {campusList.map((campus) => (
                <TabsTrigger key={campus.id} value={campus.shortcode}>
                  {campus.name}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </Tabs>
      )}

      {/* Keyed by campus so switching shows placeholders instead of the previous campus's cards. */}
      <DashboardContent key={campusParam} campus={campusParam} campusName={selected?.name} onShowAll={() => showCampus(ALL)} />
    </div>
  );
}

interface LoadedDashboard extends DashboardPayload {
  /** When this payload arrived, so ages and countdowns can tick from it. */
  loadedAt: number;
}

interface DashboardContentProps {
  campus: string;
  campusName: string | undefined;
  onShowAll: () => void;
}

function DashboardContent({ campus, campusName, onShowAll }: DashboardContentProps) {
  const load = useCallback(
    async (): Promise<LoadedDashboard> => ({ ...(await getDashboard(campus || undefined)), loadedAt: Date.now() }),
    [campus],
  );
  const { state, reload } = useResource(load);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  };

  if (state.status === 'loading') return <DashboardSkeleton />;

  if (state.status === 'error') {
    return (
      <Placeholder role="alert">
        <p className="flex items-center gap-2 text-sm">
          <AlertCircle className="size-4 text-destructive" aria-hidden />
          {state.message}
        </p>
        <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
          Try again
        </Button>
      </Placeholder>
    );
  }

  const { devices, reportIntervalSeconds, offlineAfterSeconds, loadedAt } = state.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Devices report every {reportIntervalSeconds} seconds. Offline means nothing has arrived for {offlineAfterSeconds} seconds.
        </p>
        <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
          <RefreshCw className={refreshing ? 'motion-safe:animate-spin' : undefined} aria-hidden />
          Refresh
        </Button>
      </div>

      <Summary devices={devices} />

      {devices.length === 0 ? (
        <EmptyState campus={campus} campusName={campusName} onShowAll={onShowAll} />
      ) : (
        <DeviceGrid devices={devices} reportIntervalSeconds={reportIntervalSeconds} loadedAt={loadedAt} />
      )}
    </div>
  );
}

interface DeviceGridProps {
  devices: DashboardDevice[];
  reportIntervalSeconds: number;
  loadedAt: number;
}

function DeviceGrid({ devices, reportIntervalSeconds, loadedAt }: DeviceGridProps) {
  const now = useNow();
  const elapsed = Math.max(0, Math.floor((now - loadedAt) / 1000));
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-4" aria-label="Devices">
      {devices.map((device) => (
        <li key={device.id} className="flex">
          <DeviceCard
            device={device}
            secondsSinceReading={device.secondsSinceReading === null ? null : device.secondsSinceReading + elapsed}
            reportIntervalSeconds={reportIntervalSeconds}
          />
        </li>
      ))}
    </ul>
  );
}

const mean = (values: number[]): number | null =>
  values.length === 0 ? null : Math.round(values.reduce((a, b) => a + b, 0) / values.length);

/** Headline before the detail. Averages ignore Devices with no Reading so an empty closet does not drag them to zero. */
function Summary({ devices }: { devices: DashboardDevice[] }) {
  const { offline, alerts, reporting, avgTemp, avgHumidity } = useMemo(() => {
    const readings = devices.flatMap((d) => (d.latestReading ? [d.latestReading] : []));
    return {
      offline: devices.filter((d) => !d.online).length,
      // Mold risk is the one Condition the browser still computes; ticket 08 counts server Conditions here instead.
      alerts: readings.filter((r) => getMoldRiskLevel(r.tempF, r.humidity) !== 'none').length,
      reporting: readings.length,
      avgTemp: mean(readings.map((r) => r.tempF)),
      avgHumidity: mean(readings.flatMap((r) => (r.humidity === null ? [] : [r.humidity]))),
    };
  }, [devices]);

  const reportingNote = reporting === 0 ? 'No readings yet' : `Across ${reporting} reporting`;

  return (
    <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Tile
        label="Devices"
        value={<NumberFlow value={devices.length} />}
        note={devices.length === 0 ? 'None yet' : offline === 0 ? 'All online' : `${offline} offline`}
        noteTone={offline > 0 ? 'warn' : 'muted'}
      />
      <Tile
        label="Alerts"
        value={<NumberFlow value={alerts} />}
        note={alerts === 0 ? 'No mold risk' : `Mold risk in ${alerts} ${alerts === 1 ? 'closet' : 'closets'}`}
        noteTone={alerts > 0 ? 'warn' : 'muted'}
      />
      <Tile label="Average temperature" value={avgTemp === null ? <NoValue /> : <NumberFlow value={avgTemp} suffix="°F" />} note={reportingNote} />
      <Tile label="Average humidity" value={avgHumidity === null ? <NoValue /> : <NumberFlow value={avgHumidity} suffix="%" />} note={reportingNote} />
    </dl>
  );
}

const NoValue = () => (
  <span className="font-normal text-muted-foreground" aria-label="No value">
    –
  </span>
);

interface TileProps {
  label: string;
  value: React.ReactNode;
  note: string;
  noteTone?: 'muted' | 'warn';
}

function Tile({ label, value, note, noteTone = 'muted' }: TileProps) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="px-5">
        <dt className="text-sm text-muted-foreground">{label}</dt>
        <dd className="mt-1 text-3xl font-semibold tabular-nums leading-none tracking-tight">{value}</dd>
        <dd className={noteTone === 'warn' ? 'mt-2 text-xs font-medium text-amber-700 dark:text-amber-400' : 'mt-2 text-xs text-muted-foreground'}>
          {note}
        </dd>
      </CardContent>
    </Card>
  );
}

/** The dashed panel that stands in for the device grid when there is nothing to show. */
function Placeholder({ children, ...props }: React.ComponentProps<'div'>) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center" {...props}>
      {children}
    </div>
  );
}

interface EmptyStateProps {
  campus: string;
  campusName: string | undefined;
  onShowAll: () => void;
}

function EmptyState({ campus, campusName, onShowAll }: EmptyStateProps) {
  if (campus === '') {
    return (
      <Placeholder>
        <p className="font-medium">No Devices yet</p>
        <p className="max-w-sm text-sm text-muted-foreground">Add a Device on the Settings page and it appears here with its first Reading.</p>
        <Button asChild variant="outline" size="sm">
          <Link to="/settings?tab=devices">Add a Device</Link>
        </Button>
      </Placeholder>
    );
  }
  return (
    <Placeholder>
      <p className="font-medium">No Devices at {campusName ?? campus}</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        {campusName ? 'Nothing is installed at this campus yet.' : 'There is no campus with that shortcode.'}
      </p>
      <Button variant="outline" size="sm" onClick={onShowAll}>
        Show all campuses
      </Button>
    </Placeholder>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy aria-label="Loading the dashboard">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[6.5rem] rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-4">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-60 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
