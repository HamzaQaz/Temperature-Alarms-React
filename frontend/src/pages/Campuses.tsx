import { useCallback, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AlertCircle } from 'lucide-react';
import { getCampusOverview } from '@/api';
import { ConditionBadge } from '@/components/ConditionBadge';
import { LiveStatus } from '@/components/LiveStatus';
import { Placeholder } from '@/components/Placeholder';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useLanded } from '@/hooks/use-landed';
import { useNow } from '@/hooks/use-now';
import { usePageTitle } from '@/hooks/use-page-title';
import { useReadingStream } from '@/hooks/use-reading-stream';
import { useResource } from '@/hooks/use-resource';
import type { HistorySeed } from '@/lib/card-morph';
import {
  CHART,
  CHART_WIDTH,
  chartLabel,
  chartLayout,
  dayLetter,
  dayName,
  figure,
  formatGap,
  listNames,
  rowSignature,
  sinceLast,
  weekPeak,
} from '@/lib/campusOverview';
import { formatDayShort, formatTime } from '@/lib/localDate';
import { settle } from '@/lib/motion';
import { cn } from '@/lib/utils';
import type { CampusOverview, ConditionCount, Overview, OverviewDay } from '@/types';

/** At most one reload per this long, however busy the stream: a district posts a Reading every few seconds. */
const REFRESH_EVERY_MS = 10_000;

/** The overview with the moment it was read, for "as of" in the summary. */
interface LoadedOverview extends Overview {
  asOf: number;
}

const loadOverview = async (): Promise<LoadedOverview> => ({ ...(await getCampusOverview()), asOf: Date.now() });

/** A link that reads as text until it is pointed at or focused; the focus ring is the controls' own. */
const quietLink = 'rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';

/**
 * Campuses: the district in one look, for IT leadership. One row per Campus in the server's
 * worst-first order, with what it is in now, its worst closet, its week, and how long since
 * its last incident. The server counts and ranks everything; the page lays it out.
 */
export default function Campuses() {
  usePageTitle('Campuses');
  const now = useNow();
  const { state, reload } = useResource(loadOverview);

  // Reload on the stream, throttled: the first message after a quiet spell reloads at once,
  // a burst after it waits for the rest of the ten seconds and costs one request.
  const lastLoad = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    lastLoad.current = Date.now();
    return () => clearTimeout(timer.current);
  }, []);
  const refresh = useCallback(() => {
    if (timer.current !== undefined) return;
    const wait = Math.max(0, lastLoad.current + REFRESH_EVERY_MS - Date.now());
    timer.current = setTimeout(() => {
      timer.current = undefined;
      lastLoad.current = Date.now();
      void reload();
    }, wait);
  }, [reload]);
  const stream = useReadingStream({ onReading: refresh, onIncident: refresh, onReconnect: refresh });

  const loaded = state.status === 'ready' ? state.data : undefined;

  return (
    <div className="flex-1 space-y-6">
      <header className="space-y-1">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">Campuses</h1>
          <LiveStatus status={stream} />
        </div>
        <p className="text-muted-foreground">Each Campus now and over the last 7 days, worst first.</p>
      </header>

      {state.status === 'error' ? (
        <Placeholder role="alert">
          <p className="flex items-center gap-2 text-sm">
            <AlertCircle className="size-4 text-destructive" aria-hidden />
            {state.message}
          </p>
          <Button variant="outline" size="sm" onClick={() => void reload()}>
            Try again
          </Button>
        </Placeholder>
      ) : loaded === undefined ? (
        <OverviewSkeleton />
      ) : loaded.campuses.length === 0 ? (
        <Placeholder>
          <p className="font-medium">No Campuses yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">Add a Campus and its Devices in Settings, and each one shows here with its week.</p>
          <Button asChild variant="outline" size="sm">
            <Link to="/settings">Open Settings</Link>
          </Button>
        </Placeholder>
      ) : (
        <motion.div className="space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={settle}>
          <Summary data={loaded} />
          <CampusTable data={loaded} now={now} />
          <p className="max-w-[75ch] text-sm text-pretty text-muted-foreground">
            An incident is a Condition at warning or worse; moderate Mold risk is a heads-up and is not counted. The dashed line is the{' '}
            {loaded.threshold.name} {loaded.threshold.level} threshold the server uses, <span className="tabular-nums">{figure(loaded.threshold.tempF)}°F</span>, and an amber
            column is a day an incident touched. Readings are kept <span className="tabular-nums">{loaded.retentionDays} days</span>, so “since last incident” looks back{' '}
            <span className="tabular-nums">{loaded.retentionDays} days</span> at most.
          </p>
        </motion.div>
      )}
    </div>
  );
}

/** How many Campuses the summary names before it counts the rest. */
const NAMED = 3;

const named = (names: string[]): string => (names.length <= NAMED ? listNames(names) : `${names.slice(0, NAMED).join(', ')}, and ${names.length - NAMED} more`);

/**
 * One sentence that answers "which Campuses need attention?", with the scope under it. Counts
 * are of the rows the server sent, sorted as it sent them; nothing is judged here.
 */
function Summary({ data }: { data: LoadedOverview }) {
  const { campuses } = data;
  const attention = campuses.filter((c) => c.now.conditions.length > 0);
  const headsUp = campuses.filter((c) => c.now.conditions.length === 0 && c.now.headsUp.length > 0);
  const calm = campuses.length - attention.length;
  const closets = campuses.reduce((sum, c) => sum + c.closets, 0);
  const days = campuses[0].days;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const headsUpClause =
    headsUp.length === 0 ? '' : ` ${named(headsUp.map((c) => c.name))} ${headsUp.length === 1 ? 'has' : 'have'} a Mold risk heads-up.`;

  return (
    <p className="max-w-[72ch] text-lg text-pretty">
      {attention.length === 0 ? (
        <>
          <b className="font-semibold">Every Campus is in range now.</b>
          {headsUpClause}
        </>
      ) : (
        <>
          <b className="font-semibold tabular-nums">{plural(attention.length, 'Campus has', 'Campuses have')}</b> a closet in a Condition now:{' '}
          {named(attention.map((c) => c.name))}.{' '}
          {calm > 0 && <span className="tabular-nums">The other {calm} {calm === 1 ? 'is' : 'are'} in range.</span>}
          {headsUpClause}
        </>
      )}
      <span className="mt-1 block text-sm text-muted-foreground tabular-nums">
        {plural(campuses.length, 'Campus', 'Campuses')}, {plural(closets, 'closet', 'closets')}. {formatDayShort(days[0].date)} to{' '}
        {formatDayShort(days[days.length - 1].date)}, as of {formatTime(data.asOf)}.
      </span>
    </p>
  );
}

/** A label for the cell on a phone, where the table's header is hidden and each row stacks. */
const stackedLabel =
  'max-md:grid max-md:grid-cols-[7.5rem_minmax(0,1fr)] max-md:items-center max-md:gap-3 max-md:px-0 max-md:before:text-sm max-md:before:text-muted-foreground max-md:before:content-[attr(data-label)]';

/** The table on a laptop; on a phone each row is its own card of labelled lines. */
function CampusTable({ data, now }: { data: LoadedOverview; now: number }) {
  return (
    <div className="md:rounded-xl md:border md:bg-card md:px-1 md:py-2 md:text-card-foreground md:shadow-sm">
      <Table className="tabular-nums max-md:block [&_tbody]:max-md:grid [&_tbody]:max-md:gap-3">
        <caption className="sr-only">Campuses, worst first</caption>
        <TableHeader className="max-md:hidden">
          <TableRow className="hover:bg-transparent">
            <TableHead className="px-4 text-sm font-medium text-muted-foreground">Campus</TableHead>
            <TableHead className="px-4 text-sm font-medium text-muted-foreground">In a Condition now</TableHead>
            <TableHead className="px-4 text-sm font-medium text-muted-foreground">Worst closet</TableHead>
            <TableHead className="px-4 text-sm font-medium text-muted-foreground">Daily high, 7 days</TableHead>
            <TableHead className="px-4 text-sm font-medium text-muted-foreground">Since last incident</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="max-md:block">
          {data.campuses.map((campus) => (
            <CampusRow key={campus.id} campus={campus} data={data} now={now} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function CampusRow({ campus, data, now }: { campus: CampusOverview; data: LoadedOverview; now: number }) {
  const landed = useLanded(rowSignature(campus));
  const since = sinceLast(campus.lastIncident, now, data.retentionDays);
  const cell = 'px-4 py-4 align-middle whitespace-normal';

  return (
    <TableRow className="relative isolate hover:bg-muted/35 max-md:block max-md:rounded-xl max-md:border max-md:bg-card max-md:px-4 max-md:py-1 max-md:shadow-sm max-md:hover:bg-card">
      <TableCell className={cn(cell, 'max-md:block max-md:px-0 max-md:py-3 xl:min-w-60')}>
        {landed > 0 && (
          // The Reading-landed wash: the row's fill rises to Raised Grey and settles. Grey, not a signal colour.
          <span
            key={landed}
            aria-hidden
            data-reduced="fade"
            className="pointer-events-none absolute inset-0 -z-10 rounded-lg bg-accent opacity-0 animate-reading-landed max-md:rounded-xl"
          />
        )}
        <Link
          to={`/?campus=${encodeURIComponent(campus.shortcode)}`}
          className={cn(quietLink, 'text-lg leading-tight font-semibold underline-offset-4 hover:underline')}
          aria-label={`${campus.name} on the Dashboard`}
        >
          {campus.name}
        </Link>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {campus.shortcode} · {campus.closets === 1 ? '1 closet' : `${campus.closets} closets`}
        </p>
      </TableCell>

      <TableCell data-label="Now" className={cn(cell, stackedLabel, 'max-md:border-t max-md:py-3')}>
        <NowCell campus={campus} />
      </TableCell>

      <TableCell data-label="Worst closet" className={cn(cell, stackedLabel, 'max-md:border-t max-md:py-3')}>
        <WorstCell campus={campus} now={now} />
      </TableCell>

      <TableCell data-label="7 days" className={cn(cell, stackedLabel, 'max-md:border-t max-md:py-3')}>
        <WeekCell days={campus.days} thresholdF={data.threshold.tempF} />
      </TableCell>

      <TableCell data-label="Since last" className={cn(cell, stackedLabel, 'max-md:border-t max-md:py-3')}>
        {since.date === null ? (
          <SinceText value={since.value} note={since.note} />
        ) : (
          <Link
            to={`/incidents?window=today&date=${since.date}`}
            className={cn(quietLink, 'group -mx-2 -my-1 inline-block px-2 py-1')}
            aria-label={`${since.value}, ${since.note}. Incidents on ${formatDayShort(since.date)}`}
          >
            <SinceText value={since.value} note={since.note} link />
          </Link>
        )}
      </TableCell>
    </TableRow>
  );
}

function SinceText({ value, note, link = false }: { value: string; note: string; link?: boolean }) {
  return (
    <span className="block">
      <b className={cn('block text-lg leading-tight font-semibold', link && 'underline-offset-4 group-hover:underline')}>{value}</b>
      <span className="text-sm text-muted-foreground">{note}</span>
    </span>
  );
}

const closetsCount = (n: number): string => (n === 1 ? '1 closet' : `${n} closets`);

/** Each Condition at warning or worse with how many closets, then moderate Mold risk as a heads-up. */
function NowCell({ campus }: { campus: CampusOverview }) {
  const { conditions, headsUp } = campus.now;
  if (conditions.length === 0 && headsUp.length === 0) return <span className="text-sm text-muted-foreground">None</span>;
  const item = (c: ConditionCount, note: string) => (
    <li key={`${c.name}:${c.level}`} className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
      <ConditionBadge condition={c} />
      <span className="text-sm text-muted-foreground">{note}</span>
    </li>
  );
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1.5">
      {conditions.map((c) => item(c, closetsCount(c.count)))}
      {headsUp.map((c) => item(c, `${closetsCount(c.count)}, heads-up`))}
    </ul>
  );
}

/** The Campus's worst closet now, as a link to its History today. */
function WorstCell({ campus, now }: { campus: CampusOverview; now: number }) {
  const { worst } = campus;
  if (worst === null) return <span className="text-sm text-muted-foreground">No closets</span>;
  const reading = worst.latestReading;
  const current = reading !== null && !worst.offline;
  const detail =
    reading === null
      ? 'No Readings yet'
      : worst.offline
        ? `Offline, last Reading ${formatGap(now - new Date(reading.recordedAt).getTime())} ago`
        : reading.humidity === null
          ? 'No humidity'
          : `Humidity ${figure(reading.humidity)}%`;
  const seed: HistorySeed = {
    id: worst.id,
    closet: worst.closet,
    closetType: worst.closetType,
    campusName: campus.name,
    hostname: worst.hostname,
    tempF: reading?.tempF ?? null,
    back: '/campuses',
  };
  return (
    <Link
      to={`/history/${worst.id}`}
      state={{ seed }}
      className={cn(quietLink, 'group -mx-2 -my-1 inline-flex items-baseline gap-3 px-2 py-1')}
      aria-label={`History today: ${worst.closet}, ${campus.name}${current ? `, ${figure(reading.tempF)}°F` : ''}. ${detail}`}
    >
      {current ? (
        <span className="text-3xl leading-none font-semibold tracking-tight">
          {figure(reading.tempF)}
          <span className="text-lg font-medium text-muted-foreground">°F</span>
        </span>
      ) : (
        <span className="text-3xl leading-none font-semibold text-muted-foreground" aria-hidden>
          –
        </span>
      )}
      <span className="min-w-0">
        <b className="block font-medium underline-offset-4 group-hover:underline">{worst.closet}</b>
        <span className="text-sm text-muted-foreground">{detail}</span>
      </span>
    </Link>
  );
}

/**
 * Each day's high as a small column against the server's Hot warning line. A column is amber
 * only on a day the server flagged as holding an incident (the One Meaning Rule); today, still
 * going, is a step brighter. The week's peak sits beside it on a wide screen.
 */
function WeekCell({ days, thresholdF }: { days: OverviewDay[]; thresholdF: number }) {
  const { columns, lineY } = chartLayout(days, thresholdF);
  const peak = weekPeak(days);
  return (
    <div className="flex items-center gap-4">
      <svg
        width={CHART_WIDTH}
        height={CHART.plot + CHART.labels}
        viewBox={`0 0 ${CHART_WIDTH} ${CHART.plot + CHART.labels}`}
        role="img"
        aria-label={chartLabel(days, thresholdF)}
        className="shrink-0 overflow-visible"
      >
        {columns.map(({ day, x, y, height }) => (
          <g key={day.date}>
            {y === null ? (
              <rect x={x} y={CHART.plot - 1} width={CHART.column} height={1} className="fill-border" />
            ) : (
              <rect
                x={x}
                y={y}
                width={CHART.column}
                height={height}
                rx={3}
                className={cn(
                  day.incident
                    ? day.partial
                      ? 'fill-amber-600 dark:fill-amber-500'
                      : 'fill-amber-600/70 dark:fill-amber-500/70'
                    : day.partial
                      ? 'fill-muted-foreground'
                      : 'fill-muted-foreground/45',
                )}
              />
            )}
            <text x={x + CHART.column / 2} y={CHART.plot + 14} textAnchor="middle" className="fill-muted-foreground text-xs">
              {dayLetter(day.date)}
            </text>
          </g>
        ))}
        <line x1={-4} x2={CHART_WIDTH + 4} y1={lineY} y2={lineY} strokeDasharray="3 3" className="stroke-muted-foreground" />
      </svg>
      {peak !== null && (
        <p className="whitespace-nowrap max-xl:hidden" aria-hidden>
          <b className="block text-lg leading-tight font-semibold">{figure(peak.value)}°F</b>
          <span className="text-sm text-muted-foreground">{dayName(peak.day)}</span>
        </p>
      )}
    </div>
  );
}

/** The page's shape while the overview loads: the summary's two lines and a few rows. */
function OverviewSkeleton() {
  return (
    <div className="space-y-6" aria-busy aria-label="Loading the Campuses">
      <div className="max-w-[72ch] space-y-2">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <div className="grid gap-3 md:rounded-xl md:border md:bg-card md:px-1 md:py-2 md:shadow-sm">
        <div className="border-b px-4 py-3 max-md:hidden">
          <Skeleton className="h-5 w-full" />
        </div>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="grid gap-4 px-4 py-4 max-md:rounded-xl max-md:border max-md:bg-card md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,0.9fr)] md:border-b md:last:border-b-0"
          >
            <div className="space-y-2">
              <Skeleton className="h-6 w-48 max-w-full" />
              <Skeleton className="h-4 w-24" />
            </div>
            <Skeleton className="h-7 w-32 self-center" />
            <Skeleton className="h-8 w-36 self-center" />
            <Skeleton className="h-14 w-44 self-center" />
            <div className="space-y-2 self-center">
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-4 w-28" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
