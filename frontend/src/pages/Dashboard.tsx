import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePageTitle } from '@/hooks/use-page-title';
import { Link, useSearchParams } from 'react-router-dom';
import NumberFlow from '@number-flow/react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { getCampuses, getDashboard } from '@/api';
import { LiveStatus } from '@/components/LiveStatus';
import { DeviceCard } from '@/components/DeviceCard';
import { Placeholder } from '@/components/Placeholder';
import { NoValue, Tile } from '@/components/Tile';
import { Button } from '@/components/ui/button';
import { hasWarningOrWorse, isWarningOrWorse } from '@/lib/conditions';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useNow } from '@/hooks/use-now';
import { useReadingStream } from '@/hooks/use-reading-stream';
import { useResource } from '@/hooks/use-resource';
import type { Dashboard as DashboardPayload, DashboardDevice, ReadingEvent } from '@/types';

const ALL = 'all';

/** The dashboard: every Device's latest Reading, filtered by Campus from the URL. */
export default function Dashboard() {
  usePageTitle('Dashboard');
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
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
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

/** A Device as loaded, plus when its `secondsSinceReading` was true so the age can tick from there. */
interface LiveDevice extends DashboardDevice {
  asOf: number;
}

interface LoadedDashboard extends Omit<DashboardPayload, 'devices'> {
  devices: LiveDevice[];
}

async function loadDashboard(campus: string): Promise<LoadedDashboard> {
  const payload = await getDashboard(campus || undefined);
  const asOf = Date.now();
  return { ...payload, devices: payload.devices.map((device) => ({ ...device, asOf })) };
}

/**
 * The card for the Device that just reported, with the Reading, badges and border it
 * carries, aged from now. A card already showing a newer Reading (a reload that raced
 * the stream) is left alone, so replaying an event is always safe.
 */
function applyReading(dashboard: LoadedDashboard, event: ReadingEvent): LoadedDashboard {
  const index = dashboard.devices.findIndex((d) => d.hostname === event.device);
  if (index === -1) return dashboard;
  const device = dashboard.devices[index];
  if (device.latestReading !== null && device.latestReading.recordedAt > event.reading.recordedAt) return dashboard;
  const devices = dashboard.devices.slice();
  devices[index] = { ...device, latestReading: event.reading, online: event.online, conditions: event.conditions, secondsSinceReading: 0, asOf: Date.now() };
  return { ...dashboard, devices };
}

interface DashboardContentProps {
  campus: string;
  campusName: string | undefined;
  onShowAll: () => void;
}

function DashboardContent({ campus, campusName, onShowAll }: DashboardContentProps) {
  const load = useCallback(() => loadDashboard(campus), [campus]);
  const { state, reload, update } = useResource(load);
  const [refreshing, setRefreshing] = useState(false);

  // Each Reading lands on its card as it arrives. After a dropped stream, reload: anything sent meanwhile was missed.
  const stream = useReadingStream({
    onReading: (event) => update((dashboard) => applyReading(dashboard, event)),
    onReconnect: () => void reload(),
  });

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

  const { devices, reportIntervalSeconds, offlineAfterSeconds } = state.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Devices report every {reportIntervalSeconds} seconds. Offline means nothing has arrived for {offlineAfterSeconds} seconds.
        </p>
        <div className="flex items-center gap-3">
          <LiveStatus status={stream} />
          <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
            <RefreshCw className={refreshing ? 'motion-safe:animate-spin' : undefined} aria-hidden />
            Refresh
          </Button>
        </div>
      </div>

      <Summary devices={devices} />

      {devices.length === 0 ? (
        <EmptyState campus={campus} campusName={campusName} onShowAll={onShowAll} />
      ) : (
        <DeviceGrid devices={devices} reportIntervalSeconds={reportIntervalSeconds} offlineAfterSeconds={offlineAfterSeconds} onPastOffline={reload} />
      )}
    </div>
  );
}

interface DeviceGridProps {
  devices: LiveDevice[];
  reportIntervalSeconds: number;
  offlineAfterSeconds: number;
  /** Called when a card still shown Online has aged past the Offline threshold; must be stable. */
  onPastOffline: () => void;
}

function DeviceGrid({ devices, reportIntervalSeconds, offlineAfterSeconds, onPastOffline }: DeviceGridProps) {
  const now = useNow();
  // Each card ages from the moment its own data was true, so a live Reading resets only that card's age.
  const age = (device: LiveDevice): number | null =>
    device.secondsSinceReading === null ? null : device.secondsSinceReading + Math.max(0, Math.floor((now - device.asOf) / 1000));

  // Offline is the server's call, and the server only speaks when a Reading arrives. So when a
  // card shown Online has aged past the threshold, ask again: the answer carries Offline. The key
  // changes every second while any such card remains, so a server a second behind is asked again.
  const pastOffline = devices.filter((device) => device.online && (age(device) ?? -1) >= offlineAfterSeconds).map((device) => device.id);
  const pastOfflineKey = pastOffline.length === 0 ? '' : `${pastOffline.join(',')}@${Math.floor(now / 1000)}`;
  useEffect(() => {
    if (pastOfflineKey !== '') onPastOffline();
  }, [pastOfflineKey, onPastOffline]);
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-4" aria-label="Devices">
      {devices.map((device) => (
        <li key={device.id} className="flex">
          <DeviceCard device={device} secondsSinceReading={age(device)} reportIntervalSeconds={reportIntervalSeconds} />
        </li>
      ))}
    </ul>
  );
}

const mean = (values: number[]): number | null =>
  values.length === 0 ? null : Math.round(values.reduce((a, b) => a + b, 0) / values.length);

/** Headline before the detail. Averages ignore Devices with no Reading so an empty closet does not drag them to zero. */
function Summary({ devices }: { devices: DashboardDevice[] }) {
  const { offline, attention, attentionNames, reporting, avgTemp, avgHumidity } = useMemo(() => {
    const readings = devices.flatMap((d) => (d.latestReading ? [d.latestReading] : []));
    const flagged = devices.filter(hasWarningOrWorse);
    return {
      offline: devices.filter((d) => !d.online).length,
      attention: flagged.length,
      // Only the Conditions behind the count, in the server's worst-first order, without repeats.
      attentionNames: [...new Set(flagged.flatMap((d) => d.conditions.filter(isWarningOrWorse).map((c) => c.name)))],
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
        label="Need attention"
        value={<NumberFlow value={attention} />}
        note={attention === 0 ? 'No Condition at warning or worse' : attentionNames.join(' · ')}
        noteTone={attention > 0 ? 'warn' : 'muted'}
      />
      <Tile label="Average temperature" value={avgTemp === null ? <NoValue /> : <NumberFlow value={avgTemp} suffix="°F" />} note={reportingNote} />
      <Tile label="Average humidity" value={avgHumidity === null ? <NoValue /> : <NumberFlow value={avgHumidity} suffix="%" />} note={reportingNote} />
    </dl>
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
