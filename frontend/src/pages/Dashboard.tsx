import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { usePageTitle } from '@/hooks/use-page-title';
import { Link, useSearchParams } from 'react-router-dom';
import NumberFlow from '@number-flow/react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { getCampuses, getDashboard } from '@/api';
import { loadHistory } from './history-loader';
import { LiveStatus } from '@/components/LiveStatus';
import { DeviceCard } from '@/components/DeviceCard';
import { Regroup } from '@/components/Regroup';
import { Placeholder } from '@/components/Placeholder';
import { NoValue, Tile } from '@/components/Tile';
import { Button } from '@/components/ui/button';
import { hasWarningOrWorse, isWarningOrWorse, worstCondition } from '@/lib/conditions';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useNow } from '@/hooks/use-now';
import { arrive, regroup, settle } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { useReadingStream } from '@/hooks/use-reading-stream';
import { useResource } from '@/hooks/use-resource';
import type { Campus, Dashboard as DashboardPayload, DashboardDevice, DashboardOrder, ReadingEvent } from '@/types';

const ALL = 'all';

/**
 * What the dashboard last showed, kept for this tab's lifetime so coming back from History
 * (or Settings) shows the cards at once, then refreshes them. Without it the way back would
 * be a skeleton, and the card a technician came from could not be the end of the move back.
 */
const dashboardCache = new Map<string, LoadedDashboard>();
let campusCache: Campus[] | undefined;

const cacheKey = (campus: string, order: DashboardOrder): string => `${order}:${campus}`;

/** The dashboard: every Device's latest Reading, filtered by Campus and ordered as the URL says. */
export default function Dashboard() {
  usePageTitle('Dashboard');
  const [searchParams, setSearchParams] = useSearchParams();
  const campusParam = searchParams.get('campus') ?? '';
  // Worst first is the default and stays out of the URL; only `?order=campus` is written.
  const order: DashboardOrder = searchParams.get('order') === 'campus' ? 'campus' : 'worst';
  const campuses = useResource(getCampuses, campusCache);
  useEffect(() => {
    if (campuses.state.status === 'ready') campusCache = campuses.state.data;
  }, [campuses.state]);

  // History is its own chunk; fetch it while the dashboard idles so a card's History opens in one step.
  useEffect(() => {
    const timer = setTimeout(() => void loadHistory(), 1500);
    return () => clearTimeout(timer);
  }, []);

  const campusList = campuses.state.status === 'ready' ? campuses.state.data : [];
  const selected = campusList.find((c) => c.shortcode.toLowerCase() === campusParam.toLowerCase());
  const tabValue = campusParam === '' ? ALL : (selected?.shortcode ?? campusParam);

  const showView = (campus: string, nextOrder: DashboardOrder) =>
    setSearchParams({ ...(campus === '' ? {} : { campus }), ...(nextOrder === 'worst' ? {} : { order: nextOrder }) });
  const showCampus = (value: string) => showView(value === ALL ? '' : value, order);
  const showOrder = (value: string) => showView(campusParam, value === 'campus' ? 'campus' : 'worst');

  return (
    <div className="flex-1 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">The latest Reading from every closet.</p>
        </div>
      </header>

      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* On a phone the strip takes the whole row, to the screen's edges, and the order sits under it rather than over its end. */}
        <div className="min-w-0 flex-1 max-sm:basis-full">
          {/* The filter's own placeholder, so the cards below do not jump when the Campuses arrive. */}
          {campuses.state.status === 'loading' && <Skeleton className="h-9 w-80 max-w-full rounded-lg" />}
          {campusList.length > 0 && (
            <Tabs value={tabValue} onValueChange={showCampus}>
              {/* A strip that scrolls sideways; on a phone it runs to the screen's edges, so a Campus cut off there reads as more to scroll. */}
              <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
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
        </div>
        <Tabs value={order} onValueChange={showOrder} className="shrink-0">
          <TabsList aria-label="Order">
            <TabsTrigger value="worst">Worst first</TabsTrigger>
            <TabsTrigger value="campus">By Campus</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Not keyed by campus or order: on a switch the cards on screen stay until the new answer arrives,
          then the ones that stay glide to their new places and the rest fade. */}
      <DashboardContent campus={campusParam} order={order} campusName={selected?.name} onShowAll={() => showCampus(ALL)} />
    </div>
  );
}

/** A Device as loaded, plus when its `secondsSinceReading` was true so the age can tick from there. */
interface LiveDevice extends DashboardDevice {
  asOf: number;
}

interface LoadedDashboard extends Omit<DashboardPayload, 'devices'> {
  /** The Campus filter these Devices answer, '' for all. */
  campus: string;
  /** The order the server listed them in. */
  order: DashboardOrder;
  devices: LiveDevice[];
}

async function loadDashboard(campus: string, order: DashboardOrder): Promise<LoadedDashboard> {
  const payload = await getDashboard(campus || undefined, order);
  const asOf = Date.now();
  return { ...payload, campus, order, devices: payload.devices.map((device) => ({ ...device, asOf })) };
}

/**
 * Whether this Reading changes its card's place: only under worst first, and only when it changes
 * the card's worst level, so a new Reading at the same level leaves every card where it is. The
 * browser does not sort; it asks the server again, which answers in the new order.
 */
function movesCard(dashboard: LoadedDashboard, event: ReadingEvent): boolean {
  if (dashboard.order !== 'worst') return false;
  const device = dashboard.devices.find((d) => d.hostname === event.device);
  if (device === undefined) return false;
  if (device.latestReading !== null && device.latestReading.recordedAt > event.reading.recordedAt) return false;
  return worstCondition(device.conditions)?.level !== worstCondition(event.conditions)?.level;
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
  order: DashboardOrder;
  campusName: string | undefined;
  onShowAll: () => void;
}

function DashboardContent({ campus, order, campusName, onShowAll }: DashboardContentProps) {
  const load = useCallback(() => loadDashboard(campus, order), [campus, order]);
  // Read once, at mount: whether this visit starts from what the last one showed.
  const [cached] = useState(() => dashboardCache.get(cacheKey(campus, order)));
  const { state, reload, update } = useResource(load, cached);
  const [refreshing, setRefreshing] = useState(false);
  // What is on screen now, for telling whether a Reading changes a card's place.
  const shown = useRef<LoadedDashboard | undefined>(undefined);
  useEffect(() => {
    shown.current = state.status === 'ready' ? state.data : undefined;
    if (state.status === 'ready') dashboardCache.set(cacheKey(state.data.campus, state.data.order), state.data);
  }, [state]);

  // Hostnames a reload was already asked for without a card coming back (another Campus's under
  // the filter), so each Device costs at most one request per view, however often it reports.
  const askedAbout = useRef(new Set<string>());
  useEffect(() => {
    askedAbout.current = new Set();
  }, [load]);

  // Each Reading lands on its card as it arrives; one that changes a card's worst level under worst
  // first also asks the server for the new order, and the card glides there. A Reading from a Device
  // with no card (registered after this loaded) asks the server once, so a new closet never stays
  // invisible. Only a Reading starts this, never the answer, so it cannot loop. After a dropped
  // stream, reload: anything sent meanwhile was missed.
  const stream = useReadingStream({
    onReading: (event) => {
      const moves = shown.current !== undefined && movesCard(shown.current, event);
      const unknown =
        shown.current !== undefined && !shown.current.devices.some((d) => d.hostname === event.device) && !askedAbout.current.has(event.device);
      if (unknown) askedAbout.current.add(event.device);
      update((dashboard) => applyReading(dashboard, event));
      if (moves || unknown) void reload();
    },
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
  // A Campus or order switch in flight: the cards on screen answer the last one until the new answer lands.
  const pending = state.data.campus !== campus || state.data.order !== order;

  return (
    <motion.div className="space-y-6" initial={cached ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={settle}>
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
        <DeviceGrid
          devices={devices}
          reportIntervalSeconds={reportIntervalSeconds}
          offlineAfterSeconds={offlineAfterSeconds}
          onPastOffline={reload}
          arriveOnMount={cached === undefined}
          pending={pending}
        />
      )}
    </motion.div>
  );
}

interface DeviceGridProps {
  devices: LiveDevice[];
  reportIntervalSeconds: number;
  offlineAfterSeconds: number;
  /** Called when a card still shown Online has aged past the Offline threshold; must be stable. */
  onPastOffline: () => void;
  /** Cards rise in one after the next on a first visit; a return visit starts settled. */
  arriveOnMount: boolean;
  /** A Campus or order switch is in flight and these cards answer the previous one. */
  pending: boolean;
}

function DeviceGrid({ devices, reportIntervalSeconds, offlineAfterSeconds, onPastOffline, arriveOnMount, pending }: DeviceGridProps) {
  const now = useNow();
  // After the first render, a card joining or leaving is the filter at work, not the page arriving.
  const [settled, setSettled] = useState(false);
  useEffect(() => setSettled(true), []);
  // Cards measure their place only when the set or order of cards changes, never on the
  // once-a-second tick, so sixty cards cost nothing to keep FLIP-ready.
  const order = devices.map((device) => device.id).join();
  const list = useRef<HTMLUListElement>(null);
  const reduced = useReducedMotion() ?? false;
  // Each card ages from the moment its own data was true, so a live Reading resets only that card's age.
  const age = (device: LiveDevice): number | null =>
    device.secondsSinceReading === null ? null : device.secondsSinceReading + Math.max(0, Math.floor((now - device.asOf) / 1000));

  // Offline is the server's call, and the server only speaks when a Reading arrives. So when a
  // card shown Online has aged past the threshold, ask again: the answer carries Offline. The key
  // changes every second while any such card remains, so a server a second behind is asked again.
  // Strictly past, as the server rules: exactly the threshold is still Online there.
  const pastOffline = devices.filter((device) => device.online && (age(device) ?? -1) > offlineAfterSeconds).map((device) => device.id);
  const pastOfflineKey = pastOffline.length === 0 ? '' : `${pastOffline.join(',')}@${Math.floor(now / 1000)}`;
  useEffect(() => {
    if (pastOfflineKey !== '') onPastOffline();
  }, [pastOfflineKey, onPastOffline]);
  return (
    <ul
      ref={list}
      className={cn(
        'relative grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-4 transition-opacity duration-200 ease-out-quint',
        pending && 'opacity-60 delay-150',
      )}
      aria-label="Devices"
      aria-busy={pending || undefined}
    >
      <Regroup list={list} order={order} still={reduced}>
        <AnimatePresence initial={arriveOnMount} mode="popLayout">
          {devices.map((device, index) => (
            <motion.li key={device.id} data-regroup={device.id} className="flex" {...(settled ? regroup : arrive(index))}>
              <DeviceCard
                device={device}
                secondsSinceReading={age(device)}
                anchorMs={device.secondsSinceReading === null ? null : device.asOf - device.secondsSinceReading * 1000}
                reportIntervalSeconds={reportIntervalSeconds}
              />
            </motion.li>
          ))}
        </AnimatePresence>
      </Regroup>
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

  // An Offline Device's last Reading still counts, so the note says "with a Reading", not "reporting".
  const reportingNote = reporting === 0 ? 'No readings yet' : `Across ${reporting} with a Reading`;

  return (
    <dl className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
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
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[6.5rem] rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-4">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-60 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
