import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { usePageTitle } from '@/hooks/use-page-title';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import NumberFlow from '@number-flow/react';
import { AlertCircle, ArrowLeft, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { getHistory, resetHistory } from '@/api';
import { AdminTokenPanel } from '@/components/AdminTokenPanel';
import { LiveStatus } from '@/components/LiveStatus';
import { Placeholder } from '@/components/Placeholder';
import { NoValue, Tile } from '@/components/Tile';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAdminToken } from '@/hooks/use-admin-token';
import { useChange } from '@/hooks/use-change';
import { motion } from 'framer-motion';
import { useReadingStream } from '@/hooks/use-reading-stream';
import { settle } from '@/lib/motion';
import { useResource } from '@/hooks/use-resource';
import { clearAdminToken, getAdminToken, setAdminToken } from '@/lib/adminToken';
import { addDays, formatDayLong, formatDayShort, formatHour, formatTime, formatTimeSeconds, isDateString, today } from '@/lib/localDate';
import { cn } from '@/lib/utils';
import type { DaySummary, History as HistoryPayload, Reading } from '@/types';

/** How long after a Reading arrives on the stream before the day is reloaded, so a burst costs one request. */
const LIVE_RELOAD_DELAY_MS = 2_000;
const ROWS_PER_PAGE = 100;

/**
 * One day of one Device's history: a chart, the day's numbers, and the Readings themselves.
 * The Device comes from the path and the day from `?date=`, defaulting to today, so a
 * day can be bookmarked and stepped through across midnight.
 */
export default function History() {
  const { deviceId: deviceIdParam } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const deviceId = Number(deviceIdParam);
  const dateParam = searchParams.get('date') ?? '';
  const followsToday = !isDateString(dateParam);
  // With no date in the URL the page follows today; a render after midnight moves it to the new day.
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const date = followsToday ? today() : dateParam;

  if (!Number.isInteger(deviceId) || deviceId <= 0) return <NoDevice />;

  const showDay = (day: string) => setSearchParams(day === today() ? {} : { date: day });

  // Keyed by device and day so a step to another day shows placeholders, not the previous day's chart.
  return <DayView key={`${deviceId}:${date}`} deviceId={deviceId} date={date} followsToday={followsToday} onShowDay={showDay} onDayRolledOver={rerender} />;
}

function NoDevice() {
  usePageTitle('History');
  return (
    <div className="flex-1 space-y-6">
      <PageHeading title="History" subtitle="One day of a Device's Readings." />
      <Placeholder>
        <p className="font-medium">Pick a Device first</p>
        <p className="max-w-sm text-sm text-muted-foreground">Every card on the dashboard has a History button that opens that Device's day.</p>
        <Button asChild variant="outline" size="sm">
          <Link to="/">Go to the dashboard</Link>
        </Button>
      </Placeholder>
    </div>
  );
}

interface PageHeadingProps {
  title: string;
  subtitle: React.ReactNode;
  tag?: React.ReactNode;
  actions?: React.ReactNode;
}

function PageHeading({ title, subtitle, tag, actions }: PageHeadingProps) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <Button asChild variant="outline" size="icon" className="mt-0.5 shrink-0">
          <Link to="/" aria-label="Back to the dashboard">
            <ArrowLeft aria-hidden />
          </Link>
        </Button>
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
            {tag}
          </div>
          <p className="text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      {actions}
    </header>
  );
}

interface DayViewProps {
  deviceId: number;
  date: string;
  /** True when the URL names no day, so the page should move on to the next day at midnight. */
  followsToday: boolean;
  onShowDay: (day: string) => void;
  /** A Reading has arrived after the day on screen while the page follows today. */
  onDayRolledOver: () => void;
}

function DayView({ deviceId, date, followsToday, onShowDay, onDayRolledOver }: DayViewProps) {
  const load = useCallback(() => getHistory(deviceId, date), [deviceId, date]);
  const { state, reload } = useResource(load);
  usePageTitle(state.status === 'ready' ? `${state.data.device.closet}, ${state.data.device.campus.name}` : 'History');

  // The day is reloaded, not patched, when a Reading for this Device lands on it: the
  // summary and the chart both change, and the server is the one that cuts the day.
  const loaded = state.status === 'ready' ? state.data : undefined;
  const reloadTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(reloadTimer.current), []);
  const stream = useReadingStream({
    onReading: (event) => {
      if (loaded === undefined || event.device !== loaded.device.hostname) return;
      const at = event.reading.recordedAt;
      if (at >= loaded.to && followsToday) {
        // Past midnight on a page left open: the Reading belongs to the new day, so show that day.
        onDayRolledOver();
        return;
      }
      if (at < loaded.from || at >= loaded.to) return;
      clearTimeout(reloadTimer.current);
      reloadTimer.current = setTimeout(() => void reload(), LIVE_RELOAD_DELAY_MS);
    },
    onReconnect: () => void reload(),
  });

  // Reset needs the Admin token. A 401 opens the same prompt Settings uses: "needed" when
  // none was stored, "rejected" when the stored one was refused (and is then forgotten).
  const token = useAdminToken();
  const [prompt, setPrompt] = useState<'closed' | 'needed' | 'rejected'>('closed');
  const onUnauthorised = useCallback(() => {
    setPrompt(getAdminToken() === null ? 'needed' : 'rejected');
    clearAdminToken();
  }, []);
  const change = useChange(onUnauthorised);
  const reset = async () => {
    if ((await change.run(() => resetHistory(deviceId))).ok) await reload();
  };

  if (state.status === 'loading') return <DaySkeleton />;

  if (state.status === 'error') {
    return (
      <div className="flex-1 space-y-6">
        <PageHeading title="History" subtitle={formatDayLong(date)} />
        <Placeholder role="alert">
          <p className="flex items-center gap-2 text-sm">
            <AlertCircle className="size-4 text-destructive" aria-hidden />
            {state.message}
          </p>
          {state.message === 'Device not found' ? (
            <Button asChild variant="outline" size="sm">
              <Link to="/">Back to the dashboard</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => void reload()}>
              Try again
            </Button>
          )}
        </Placeholder>
      </div>
    );
  }

  const history = state.data;
  const { device, readings, summary } = history;
  const isToday = date === today();

  return (
    <motion.div className="flex-1 space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={settle}>
      <PageHeading
        title={device.closet}
        subtitle={
          <>
            {device.campus.name} · <span className="font-mono text-sm">{device.hostname}</span>
          </>
        }
        tag={
          device.closetType && (
            <Badge variant="outline" className={cn(device.closetType === 'MDF' && 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300')}>
              {device.closetType}
            </Badge>
          )
        }
        actions={
          <div className="flex items-center gap-3">
            {/* A past day never changes, so only today says whether Readings are arriving. */}
            {isToday && <LiveStatus status={stream} />}
            {/* Not gated on the day shown: reset is the whole history, and a junk board's Readings may all be on other days. */}
            <ResetButton closet={device.closet} disabled={change.pending} pending={change.pending} onConfirm={() => void reset()} />
          </div>
        }
      />

      {prompt !== 'closed' && (
        <AdminTokenPanel
          action="Resetting a Device's history"
          hasToken={token !== null}
          rejected={prompt === 'rejected'}
          onSave={(value) => {
            setAdminToken(value);
            setPrompt('closed');
          }}
          onForget={() => {
            clearAdminToken();
            setPrompt('closed');
          }}
        />
      )}

      {change.error && (
        <p role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
          <AlertCircle className="size-4 shrink-0 text-destructive" aria-hidden />
          {change.error}
        </p>
      )}

      <DayPicker date={date} onShowDay={onShowDay} />

      <DaySummaryTiles summary={summary} readings={readings} />

      {readings.length === 0 ? (
        <Placeholder>
          <p className="font-medium">No Readings on {formatDayShort(date)}</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {isToday ? 'Nothing has arrived from this Device yet today. New Readings appear here as they come in.' : 'This Device sent nothing that day, or its Readings have since been deleted.'}
          </p>
          {!isToday && (
            <Button variant="outline" size="sm" onClick={() => onShowDay(today())}>
              Show today
            </Button>
          )}
        </Placeholder>
      ) : (
        <>
          <DayChart history={history} />
          <ReadingsTable readings={readings} date={date} />
        </>
      )}
    </motion.div>
  );
}

interface ResetButtonProps {
  closet: string;
  disabled: boolean;
  pending: boolean;
  onConfirm: () => void;
}

/** Reset is destructive and permanent, so it sits behind a confirmation that names the Device. */
function ResetButton({ closet, disabled, pending, onConfirm }: ResetButtonProps) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled} className="text-destructive hover:text-destructive">
          <Trash2 aria-hidden />
          {pending ? 'Resetting…' : 'Reset history'}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reset the history of {closet}?</AlertDialogTitle>
          <AlertDialogDescription>
            Every Reading this Device has ever sent is deleted, not just the day on screen. The Device itself stays and keeps reporting. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="bg-destructive-solid text-destructive-solid-foreground hover:bg-destructive-solid/90">
            Delete all Readings
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

interface DayPickerProps {
  date: string;
  onShowDay: (day: string) => void;
}

/** Previous, the day itself (a native date field, so any day is one pick away), next, and a way back to today. */
function DayPicker({ date, onShowDay }: DayPickerProps) {
  const isToday = date === today();
  return (
    <nav aria-label="Day" className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="icon" onClick={() => onShowDay(addDays(date, -1))} aria-label="Previous day">
        <ChevronLeft aria-hidden />
      </Button>
      <label className="relative">
        <span className="sr-only">Day shown</span>
        <input
          type="date"
          value={date}
          max={today()}
          onChange={(event) => {
            if (isDateString(event.target.value)) onShowDay(event.target.value);
          }}
          className="h-9 pointer-coarse:min-h-11 rounded-md border border-input bg-transparent px-3 text-sm tabular-nums shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </label>
      <Button variant="outline" size="icon" onClick={() => onShowDay(addDays(date, 1))} disabled={isToday} aria-label="Next day">
        <ChevronRight aria-hidden />
      </Button>
      <p className="ml-1 text-sm font-medium">{isToday ? `Today, ${formatDayLong(date)}` : formatDayLong(date)}</p>
      {!isToday && (
        <Button variant="ghost" size="sm" onClick={() => onShowDay(today())}>
          Today
        </Button>
      )}
    </nav>
  );
}

const lowHigh = (s: DaySummary, unit: string): string => `Low ${s.min}${unit} · High ${s.max}${unit}`;

/** The day's numbers, in the dashboard's tiles: averages headline, lows and highs beneath. */
function DaySummaryTiles({ summary, readings }: { summary: HistoryPayload['summary']; readings: Reading[] }) {
  const span =
    readings.length === 0 ? 'None yet' : readings.length === 1 ? `At ${formatTime(readings[0].recordedAt)}` : `${formatTime(readings[0].recordedAt)} to ${formatTime(readings[readings.length - 1].recordedAt)}`;
  return (
    <dl className="grid gap-4 sm:grid-cols-3">
      <Tile
        label="Average temperature"
        value={summary.tempF === null ? <NoValue /> : <NumberFlow value={summary.tempF.avg} suffix="°F" />}
        note={summary.tempF === null ? 'No Readings' : lowHigh(summary.tempF, '°')}
      />
      <Tile
        label="Average humidity"
        value={summary.humidity === null ? <NoValue /> : <NumberFlow value={summary.humidity.avg} suffix="%" />}
        note={summary.humidity === null ? (readings.length === 0 ? 'No Readings' : 'No humidity in these Readings') : lowHigh(summary.humidity, '%')}
      />
      <Tile label="Readings" value={<NumberFlow value={readings.length} />} note={span} />
    </dl>
  );
}

const chartConfig = {
  tempF: { label: 'Temperature', color: 'var(--chart-1)' },
  humidity: { label: 'Humidity', color: 'var(--chart-2)' },
} satisfies ChartConfig;

const MS_PER_HOUR = 3_600_000;

/** An axis range on multiples of five with a step of room either side, so ticks land on round numbers and a flat day is not a line along the edge. */
function niceDomain(values: number[], step = 5): [number, number] {
  if (values.length === 0) return [0, step];
  const min = Math.min(...values);
  const max = Math.max(...values);
  return [Math.floor((min - 1) / step) * step, Math.ceil((max + 1) / step) * step];
}

/** Both series over the whole day, midnight to midnight, so a quiet hour reads as a gap and not as a shorter day. */
function DayChart({ history }: { history: HistoryPayload }) {
  const from = Date.parse(history.from);
  const to = Date.parse(history.to);
  const data = useMemo(() => history.readings.map((r) => ({ at: Date.parse(r.recordedAt), tempF: r.tempF, humidity: r.humidity })), [history.readings]);
  // A tick every three hours from midnight; the closing midnight is the last one.
  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let t = from; t <= to; t += 3 * MS_PER_HOUR) out.push(t);
    return out;
  }, [from, to]);
  const tempDomain = useMemo(() => niceDomain(data.map((d) => d.tempF)), [data]);
  const humidityDomain = useMemo(() => niceDomain(data.flatMap((d) => (d.humidity === null ? [] : [d.humidity]))), [data]);
  // Dots on a few points help; on a full day of 30-second Readings they are noise.
  const sparse = data.length <= 48;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Over the day</CardTitle>
        <CardDescription>Temperature on the left axis, humidity on the right.</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="aspect-auto h-64 w-full sm:h-80">
          <LineChart accessibilityLayer data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="at"
              type="number"
              scale="time"
              domain={[from, to]}
              ticks={ticks}
              tickFormatter={(value: number) => (value === to ? '12 AM' : formatHour(value))}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={24}
            />
            {/* Whole degrees and whole percent, as the DHT11 reports them. */}
            <YAxis yAxisId="tempF" width={44} tickLine={false} axisLine={false} tickMargin={4} tickFormatter={(v: number) => `${v}°`} domain={tempDomain} allowDecimals={false} />
            <YAxis yAxisId="humidity" orientation="right" width={40} tickLine={false} axisLine={false} tickMargin={4} tickFormatter={(v: number) => `${v}%`} domain={humidityDomain} allowDecimals={false} />
            <ChartTooltip
              cursor={{ strokeDasharray: '3 3' }}
              content={
                <ChartTooltipContent
                  labelFormatter={(_label, payload) => {
                    const at = payload?.[0]?.payload?.at as number | undefined;
                    return at === undefined ? '' : formatTimeSeconds(at);
                  }}
                  formatter={(value, name) => (
                    <div className="flex flex-1 items-center justify-between gap-4">
                      <span className="text-muted-foreground">{chartConfig[name as keyof typeof chartConfig]?.label ?? name}</span>
                      <span className="font-mono font-medium tabular-nums">
                        {value}
                        {name === 'tempF' ? '°F' : '%'}
                      </span>
                    </div>
                  )}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            <Line yAxisId="tempF" dataKey="tempF" type="monotone" stroke="var(--color-tempF)" strokeWidth={2} dot={sparse} activeDot={{ r: 4 }} isAnimationActive={false} />
            <Line yAxisId="humidity" dataKey="humidity" type="monotone" stroke="var(--color-humidity)" strokeWidth={2} strokeDasharray="4 3" dot={sparse} activeDot={{ r: 4 }} isAnimationActive={false} />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

/** Every Reading of the day, newest first, a page at a time so a full day of 2,880 Readings stays quick. */
function ReadingsTable({ readings, date }: { readings: Reading[]; date: string }) {
  const [page, setPage] = useState(1);
  const newestFirst = useMemo(() => readings.slice().reverse(), [readings]);
  const pages = Math.max(1, Math.ceil(newestFirst.length / ROWS_PER_PAGE));
  const current = Math.min(page, pages);
  const start = (current - 1) * ROWS_PER_PAGE;
  const rows = newestFirst.slice(start, start + ROWS_PER_PAGE);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Readings</CardTitle>
        <CardDescription>
          Newest first. {readings.length === 1 ? 'One Reading' : `${readings.length.toLocaleString()} Readings`} on {formatDayShort(date)}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* The page keeps its shape whatever the day holds: the rows scroll inside, under a header that stays put. */}
        <div className="max-h-[30rem] overflow-y-auto rounded-md border">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead className="pl-4">Time</TableHead>
              <TableHead className="text-right">Temperature</TableHead>
              <TableHead className="pr-4 text-right">Humidity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((reading, i) => (
              // Two Readings can share a second (a board retrying a POST), so the instant alone is not a key.
              <TableRow key={`${reading.recordedAt}#${start + i}`}>
                <TableCell className="pl-4 tabular-nums">
                  <time dateTime={reading.recordedAt}>{formatTimeSeconds(reading.recordedAt)}</time>
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">{reading.tempF}°F</TableCell>
                <TableCell className="pr-4 text-right tabular-nums">
                  {reading.humidity === null ? <span className="text-muted-foreground">—</span> : `${reading.humidity}%`}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
        {pages > 1 && (
          <nav aria-label="Readings pages" className="flex flex-wrap items-center justify-between gap-3 pt-4">
            <p className="text-sm text-muted-foreground tabular-nums">
              {start + 1}–{Math.min(start + ROWS_PER_PAGE, newestFirst.length)} of {newestFirst.length.toLocaleString()}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage(current - 1)} disabled={current === 1}>
                Newer
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPage(current + 1)} disabled={current === pages}>
                Older
              </Button>
            </div>
          </nav>
        )}
      </CardContent>
    </Card>
  );
}

function DaySkeleton() {
  return (
    <div className="flex-1 space-y-6" aria-busy aria-label="Loading the day">
      <div className="flex items-start gap-3">
        <Skeleton className="size-9 rounded-md" />
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="size-9 rounded-md" />
        <Skeleton className="h-9 w-36 rounded-md" />
        <Skeleton className="size-9 rounded-md" />
        <Skeleton className="ml-1 h-4 w-56" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-[6.5rem] rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-96 rounded-xl" />
    </div>
  );
}
