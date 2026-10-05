import { useCallback, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AlertCircle, CalendarDays, ChevronLeft, ChevronRight, History as HistoryIcon } from 'lucide-react';
import { getIncidents } from '@/api';
import { ConditionBadge } from '@/components/ConditionBadge';
import { LiveStatus } from '@/components/LiveStatus';
import { Placeholder } from '@/components/Placeholder';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useNow } from '@/hooks/use-now';
import { usePageTitle } from '@/hooks/use-page-title';
import { useReadingStream } from '@/hooks/use-reading-stream';
import { useResource } from '@/hooks/use-resource';
import { levelLook } from '@/lib/conditions';
import {
  durationOf,
  formatDuration,
  latestDate,
  overlaps,
  parseWindowKind,
  place,
  spanLayout,
  stepDays,
  ticks,
  windowBounds,
  windowLabel,
  windowPhrase,
  worstIncident,
  type Tick,
  type WindowKind,
} from '@/lib/incidentWindow';
import { addDays, formatDayLong, formatDayShort, formatTime, isDateString, toDateString } from '@/lib/localDate';
import { settle } from '@/lib/motion';
import { cn } from '@/lib/utils';
import type { Incident, IncidentEvent, Incidents as IncidentsPayload } from '@/types';

/** A window's incidents as loaded, with the window they were asked for, so the page knows when what it shows is behind the controls. */
interface LoadedIncidents extends IncidentsPayload {
  kind: WindowKind;
  date: string;
}

const STEP_NAMES: Record<WindowKind, { previous: string; next: string }> = {
  overnight: { previous: 'Previous night', next: 'Next night' },
  today: { previous: 'Previous day', next: 'Next day' },
  week: { previous: 'Previous 7 days', next: 'Next 7 days' },
};

const ms = (iso: string): number => new Date(iso).getTime();

/**
 * Incidents: every Condition at warning or worse, start to end, in a night, a day, or a week.
 * The window and its day live in the URL (`?window=today|week`, `?date=`), so a night can be
 * bookmarked; with no day the page follows the latest window and moves on when the next begins.
 */
export default function Incidents() {
  usePageTitle('Incidents');
  const [searchParams, setSearchParams] = useSearchParams();
  const now = useNow();
  const kind = parseWindowKind(searchParams.get('window'));
  const latest = latestDate(kind, new Date(now));
  const dateParam = searchParams.get('date') ?? '';
  // A day after the latest window (a hand-edited URL) has nothing in it yet; show the latest.
  const date = isDateString(dateParam) && dateParam < latest ? dateParam : latest;
  const followsLatest = date === latest;

  const show = (nextKind: WindowKind, nextDate?: string) => {
    const params: Record<string, string> = {};
    if (nextKind !== 'overnight') params.window = nextKind;
    if (nextDate !== undefined && nextDate < latestDate(nextKind, new Date())) params.date = nextDate;
    setSearchParams(params);
  };
  const step = (direction: 1 | -1) => show(kind, addDays(date, direction * stepDays(kind)));

  const load = useCallback(async (): Promise<LoadedIncidents> => {
    const { from, to } = windowBounds(kind, date);
    return { ...(await getIncidents(from, to)), kind, date };
  }, [kind, date]);
  const { state, reload, update } = useResource(load);

  // Rows that arrived or changed level while the page was open, by incident id: how many times, so each takes the wash once.
  const [landed, setLanded] = useState<Record<number, number>>({});
  const [arrived, setArrived] = useState<ReadonlySet<number>>(() => new Set());
  const [announcement, setAnnouncement] = useState('');

  const loaded = state.status === 'ready' ? state.data : undefined;
  const stream = useReadingStream({
    onIncident: ({ change, incident }: IncidentEvent) => {
      if (loaded === undefined) return;
      const present = loaded.incidents.some((i) => i.id === incident.id);
      if (!present && !overlaps(incident, ms(loaded.from), ms(loaded.to), Date.now())) return;
      // A new incident goes at the end, like the next line of a log; a change replaces its row where it is.
      update((data) => {
        const index = data.incidents.findIndex((i) => i.id === incident.id);
        if (index >= 0) return { ...data, incidents: data.incidents.map((i, n) => (n === index ? incident : i)) };
        if (!overlaps(incident, ms(data.from), ms(data.to), Date.now())) return data;
        return { ...data, incidents: [...data.incidents, incident] };
      });
      if (change === 'closed') return;
      setLanded((counts) => ({ ...counts, [incident.id]: (counts[incident.id] ?? 0) + 1 }));
      if (!present) {
        setArrived((ids) => new Set(ids).add(incident.id));
        setAnnouncement(`New incident: ${incident.condition} ${incident.level}, ${incident.device.closet}, ${incident.device.campus.name}`);
      } else if (change === 'level') {
        setAnnouncement(`${incident.device.closet}, ${incident.device.campus.name}: ${incident.condition} is now ${incident.level}`);
      }
    },
    onReconnect: () => void reload(),
  });

  const names = STEP_NAMES[kind];
  const phrase = windowPhrase(kind, date, new Date(now));

  return (
    <div className="flex-1 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">Incidents</h1>
            {followsLatest && <LiveStatus status={stream} />}
          </div>
          <p className="text-muted-foreground">Every Condition at warning or worse, from start to end, across the district.</p>
        </div>

        <div className="flex flex-wrap items-center gap-3 max-md:w-full">
          <Tabs value={kind} onValueChange={(value) => show(parseWindowKind(value))}>
            <TabsList aria-label="Window">
              <TabsTrigger value="overnight">Overnight</TabsTrigger>
              <TabsTrigger value="today">Today</TabsTrigger>
              <TabsTrigger value="week">7 days</TabsTrigger>
            </TabsList>
          </Tabs>
          <nav aria-label="Window shown" className="flex items-center gap-1.5 max-md:w-full">
            <Button variant="outline" size="icon" onClick={() => step(-1)} aria-label={names.previous}>
              <ChevronLeft aria-hidden />
            </Button>
            <p
              aria-live="polite"
              className="flex h-9 items-center gap-2 rounded-md border border-input px-3 text-sm whitespace-nowrap tabular-nums shadow-xs pointer-coarse:min-h-11 max-md:flex-1 dark:bg-input/30"
            >
              <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              {windowLabel(kind, date)}
            </p>
            {/* Next stops at the present: there is nothing after the latest window yet. */}
            <Button variant="outline" size="icon" onClick={() => step(1)} disabled={followsLatest} aria-label={names.next}>
              <ChevronRight aria-hidden />
            </Button>
            {!followsLatest && (
              <Button variant="ghost" size="sm" onClick={() => show(kind)}>
                Latest
              </Button>
            )}
          </nav>
        </div>
      </header>

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

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
        <LogSkeleton />
      ) : (
        // Keyed by window, so a step to another night fades in from what was there rather than morphing row by row.
        <motion.div
          key={`${loaded.kind}:${loaded.date}`}
          className={cn('space-y-6 transition-opacity duration-200 ease-out-quint', (loaded.kind !== kind || loaded.date !== date) && 'opacity-60')}
          aria-busy={loaded.kind !== kind || loaded.date !== date}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={settle}
        >
          {loaded.incidents.length === 0 ? (
            <Placeholder>
              <p className="font-medium">No incidents {windowPhrase(loaded.kind, loaded.date, new Date(now))}</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                No Condition reached warning or worse {windowPhrase(loaded.kind, loaded.date, new Date(now))}. A new one appears here as it starts.
              </p>
              <Button variant="outline" size="sm" onClick={() => step(-1)}>
                {STEP_NAMES[loaded.kind].previous}
              </Button>
            </Placeholder>
          ) : (
            <>
              <Summary incidents={loaded.incidents} phrase={loaded.kind === kind && loaded.date === date ? phrase : windowPhrase(loaded.kind, loaded.date, new Date(now))} now={now} />
              <Log data={loaded} now={now} landed={landed} arrived={arrived} />
            </>
          )}
        </motion.div>
      )}
    </div>
  );
}

/** A Reading's number as recorded: whole numbers stay whole, anything else to one decimal. */
const figure = (value: number): string => (Number.isInteger(value) ? String(value) : value.toFixed(1));

/** The peak in the Condition's own unit: °F for Hot and Cold, percent for Dry and Mold risk. */
const peakFigure = (incident: Incident): string | null => {
  const { value } = incident.peak;
  if (value === null) return null;
  return incident.condition === 'Hot' || incident.condition === 'Cold' ? `${figure(value)}°F` : `${figure(value)}%`;
};

const where = (incident: Incident): string => `${incident.device.campus.name} ${incident.device.closet}`;

/** What the worst incident did, in a clause: "reached Hot critical, 93.4°F at 2:41 AM". */
function worstClause(incident: Incident, now: number): string {
  if (incident.condition === 'Offline') {
    return `${incident.end === null ? 'has been' : 'was'} Offline for ${formatDuration(durationOf(incident, now))}`;
  }
  return `reached ${incident.condition} ${incident.level}, ${peakFigure(incident)} at ${formatTime(incident.peak.recordedAt)}`;
}

/** How many still-going incidents the summary names before it counts the rest. */
const STILL_GOING_NAMED = 3;

/**
 * One paragraph that answers "what happened overnight?": how many, the worst, and what is
 * still going. Counts and the worst are taken from what the API returned; no level is judged here.
 */
function Summary({ incidents, phrase, now }: { incidents: Incident[]; phrase: string; now: number }) {
  const count = incidents.length;
  const campuses = new Set(incidents.map((i) => i.device.campus.id)).size;
  const worst = worstIncident(incidents, now);
  const going = incidents.filter((i) => i.end === null);
  const named = going.slice(0, STILL_GOING_NAMED).map((i) => `${where(i)}, ${i.condition} since ${formatTime(i.start)}`);
  const more = going.length - named.length;
  return (
    <p className="max-w-[72ch] text-lg text-pretty">
      <b className="font-semibold tabular-nums">
        {count} {count === 1 ? 'incident' : 'incidents'}
      </b>{' '}
      {phrase} {campuses === 1 ? 'at 1 Campus' : `across ${campuses} Campuses`}.{' '}
      {worst && (
        <>
          {count > 1 ? 'The worst: ' : ''}
          <span className="tabular-nums">
            {where(worst)} {worstClause(worst, now)}.
          </span>{' '}
        </>
      )}
      {going.length === 0 ? (
        count > 1 ? 'All of them have ended.' : 'It has ended.'
      ) : (
        <>
          <b className="font-semibold tabular-nums">{going.length} still going</b>: <span className="tabular-nums">{named.join('; ')}</span>
          {more > 0 && `; and ${more} more`}.
        </>
      )}
    </p>
  );
}

interface LogProps {
  data: LoadedIncidents;
  now: number;
  landed: Record<number, number>;
  arrived: ReadonlySet<number>;
}

/**
 * Two readings of one log: each incident as a sentence with its numbers, and the same
 * incident as a span on a ruler the whole window shares, so overlaps and the worst stretch
 * show without reading. Under 1024px the span moves under its row, on a ruler of major marks.
 */
function Log({ data, now, landed, arrived }: LogProps) {
  const from = ms(data.from);
  const to = ms(data.to);
  const marks = ticks(data.kind, data.date);
  const nowAt = now >= from && now < to ? place(now, from, to) : null;
  return (
    <section aria-label="Incidents, oldest first" className="rounded-xl border bg-card px-1 py-2 text-card-foreground shadow-sm">
      <div aria-hidden className="grid border-b text-sm text-muted-foreground lg:grid-cols-[minmax(0,27rem)_minmax(0,1fr)]">
        <div className="px-5 py-3 max-lg:hidden">Incident</div>
        <div className="px-5 py-3 max-md:px-4">
          <Ruler marks={marks} from={from} to={to} nowAt={nowAt} />
        </div>
      </div>
      <ol>
        {data.incidents.map((incident) => (
          <IncidentRow
            key={incident.id}
            incident={incident}
            kind={data.kind}
            from={from}
            to={to}
            now={now}
            marks={marks}
            nowAt={nowAt}
            landed={landed[incident.id] ?? 0}
            arrived={arrived.has(incident.id)}
          />
        ))}
      </ol>
    </section>
  );
}

const pct = (share: number): string => `${share * 100}%`;

/** How close (as a share of the ruler) a label may sit to "Now" before it gives way: on the wide ruler, and on a phone's. */
const NOW_CLEARANCE = 0.05;
const NOW_CLEARANCE_NARROW = 0.1;

/** The ruler's labels: the hours (or days) and "Now". A label that would sit under "Now" gives way to it. */
function Ruler({ marks, from, to, nowAt }: { marks: Tick[]; from: number; to: number; nowAt: number | null }) {
  return (
    <div className="relative h-5 text-xs tabular-nums">
      {marks.map((mark) => {
        if (mark.label === undefined) return null;
        const at = place(mark.at, from, to);
        const nearNow = nowAt === null ? Infinity : Math.abs(at - nowAt);
        if (nearNow < NOW_CLEARANCE) return null;
        return (
          <span
            key={mark.at}
            className={cn('absolute top-0 whitespace-nowrap', at > 0 && '-translate-x-1/2', (!mark.major || nearNow < NOW_CLEARANCE_NARROW) && 'max-lg:hidden')}
            style={{ left: pct(at) }}
          >
            {mark.label}
          </span>
        );
      })}
      {nowAt !== null && (
        <span className="absolute top-0 -translate-x-1/2 font-medium whitespace-nowrap text-foreground" style={{ left: pct(nowAt) }}>
          Now
        </span>
      )}
    </div>
  );
}

interface IncidentRowProps {
  incident: Incident;
  kind: WindowKind;
  from: number;
  to: number;
  now: number;
  marks: Tick[];
  nowAt: number | null;
  /** How many times this row arrived or changed level live; each takes the wash once. */
  landed: number;
  /** Arrived on the stream after the page loaded, so it rises into place. */
  arrived: boolean;
}

function IncidentRow({ incident, kind, from, to, now, marks, nowAt, landed, arrived }: IncidentRowProps) {
  const start = new Date(incident.start);
  const end = incident.end === null ? null : new Date(incident.end);
  // A day name is needed when the time alone is ambiguous: a week, or a start before the window.
  const dayFirst = kind === 'week' || start.getTime() < from;
  const endDayDiffers = end !== null && toDateString(end) !== toDateString(start);
  const day = toDateString(start);
  const { device } = incident;
  const duration = formatDuration(durationOf(incident, now));

  return (
    <motion.li
      initial={arrived ? { opacity: 0, y: 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={settle}
      className="relative isolate grid border-b last:border-b-0 lg:grid-cols-[minmax(0,27rem)_minmax(0,1fr)]"
    >
      {landed > 0 && (
        <span
          key={landed}
          aria-hidden
          data-reduced="fade"
          className="pointer-events-none absolute inset-0 -z-10 rounded-lg bg-accent opacity-0 animate-reading-landed"
        />
      )}

      <div className="grid gap-x-4 gap-y-1 px-5 py-4 max-md:px-4 max-md:py-3.5 md:grid-cols-[6rem_minmax(0,1fr)]">
        <p className="tabular-nums max-md:flex max-md:flex-wrap max-md:items-baseline max-md:gap-x-2">
          {dayFirst && <span className="text-xs text-muted-foreground md:block">{formatDayShort(day)}</span>}
          <time dateTime={incident.start} className="text-lg leading-tight font-semibold md:block">
            {formatTime(start)}
          </time>
          <span className="text-sm text-muted-foreground md:block">
            {end === null ? (
              'ongoing'
            ) : (
              <>
                to{' '}
                <time dateTime={incident.end ?? undefined}>
                  {endDayDiffers && kind === 'week' ? `${formatDayShort(toDateString(end))}, ` : ''}
                  {formatTime(end)}
                </time>
              </>
            )}
          </span>
        </p>

        <div className="grid min-w-0 gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {/* Keyed by level, so a level change crossfades the badge in place. */}
            <motion.span key={incident.level} initial={landed > 0 ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={settle} className="flex">
              <ConditionBadge condition={{ name: incident.condition, level: incident.level }} />
            </motion.span>
            <span className={cn('text-sm tabular-nums', end === null ? 'font-medium text-foreground' : 'text-muted-foreground')}>
              {end === null ? `${duration} so far` : duration}
            </span>
          </div>
          <h2 className="text-lg font-semibold">
            {device.campus.name} <span className="font-normal text-muted-foreground">· {device.closet}</span>
          </h2>
          <p className="text-sm text-muted-foreground tabular-nums">
            <Facts incident={incident} />
          </p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="font-mono text-sm text-muted-foreground">{device.hostname}</span>
            <Button asChild variant="outline" size="sm">
              <Link to={`/history/${device.id}?date=${day}`} aria-label={`History, ${monthDay(day)}: ${device.closet}, ${device.campus.name}, ${formatDayLong(day)}`}>
                <HistoryIcon aria-hidden />
                History, {monthDay(day)}
              </Link>
            </Button>
          </div>
        </div>
      </div>

      <Track incident={incident} from={from} to={to} now={now} marks={marks} nowAt={nowAt} />
    </motion.li>
  );
}

const monthDayFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const monthDay = (date: string): string => {
  const [year, month, day] = date.split('-').map(Number);
  return monthDayFormat.format(new Date(year, month - 1, day, 12));
};

const strong = (text: string) => <b className="font-medium text-foreground">{text}</b>;

/** The incident's numbers: the peak and when, and how long it spent at its worst level when it got there later. */
function Facts({ incident }: { incident: Incident }) {
  const { peak, condition } = incident;
  if (condition === 'Offline') {
    if (incident.end === null) {
      const last = peak.humidity === null ? `${figure(peak.tempF)}°F` : `${figure(peak.tempF)}°F, ${figure(peak.humidity)}%`;
      return (
        <>
          {strong(`No Readings since ${formatTime(peak.recordedAt)}.`)} Last Reading {last}.
        </>
      );
    }
    return <>{strong(`No Readings for ${formatDuration(ms(incident.end) - ms(peak.recordedAt))}`)}, then the Device reported again.</>;
  }
  const value = peakFigure(incident) ?? '';
  const when = formatTime(peak.recordedAt);
  const lead =
    condition === 'Hot' ? (
      <>Peak {strong(value)} at {when}.</>
    ) : condition === 'Cold' ? (
      <>Lowest {strong(value)} at {when}.</>
    ) : condition === 'Dry' ? (
      <>Lowest {strong(value)} humidity at {when}.</>
    ) : (
      <>
        Peak {strong(value)} at {figure(peak.tempF)}°F, {when}.
      </>
    );
  return (
    <>
      {lead}
      <WorstStretch incident={incident} />
    </>
  );
}

/** "Critical from 2:11 AM to 3:35 AM." when the incident rose to its worst level after it began. */
function WorstStretch({ incident }: { incident: Incident }) {
  const { segments, level } = incident;
  if (segments.length < 2 || segments[0].level === level) return null;
  const worst = segments.filter((s) => s.level === level);
  const first = worst[0];
  const name = level.charAt(0).toUpperCase() + level.slice(1);
  const stretch = first.end === null ? `${name} since ${formatTime(first.start)}` : `${name} from ${formatTime(first.start)} to ${formatTime(first.end)}`;
  const again = worst.length - 1;
  return <> {stretch}{again > 0 ? `, and ${again} more ${again === 1 ? 'time' : 'times'}` : ''}.</>;
}

/**
 * The incident on the shared ruler: one span, a stretch per level in that level's signal
 * colour (critical solid, with no text on it), cut square where it runs past the window and
 * capped where it is still going. The row's text says all of this too, so it is hidden from
 * screen readers.
 */
function Track({ incident, from, to, now, marks, nowAt }: { incident: Incident; from: number; to: number; now: number; marks: Tick[]; nowAt: number | null }) {
  const span = spanLayout(incident, from, to, now);
  return (
    <div aria-hidden className="relative h-9 lg:h-auto">
      <div className="absolute inset-x-5 top-0 bottom-3 max-md:inset-x-4 lg:bottom-0">
        {marks.map((mark) =>
          mark.line ? <i key={mark.at} className="absolute inset-y-0 w-px bg-border/50" style={{ left: pct(place(mark.at, from, to)) }} /> : null,
        )}
        {nowAt !== null && <i className="absolute inset-y-0 border-l border-dashed border-ring" style={{ left: pct(nowAt) }} />}
        <span
          className={cn(
            'absolute top-1/2 h-3.5 min-w-1 -translate-y-1/2 overflow-hidden rounded-sm',
            span.cutStart && 'rounded-l-none',
            (span.ongoing || span.cutEnd) && 'rounded-r-none',
          )}
          style={{ left: pct(span.left), width: pct(span.width) }}
        >
          {span.pieces.map((piece, i) => (
            <i key={i} className={cn('absolute inset-y-0', levelLook(piece.level).span)} style={{ left: pct(piece.left), width: pct(piece.width) }} />
          ))}
          {span.ongoing && <i className="absolute inset-y-0 right-0 w-0.5 bg-foreground" />}
        </span>
      </div>
    </div>
  );
}

/** The log's shape while it loads: the summary's two lines and a few rows, so nothing jumps when it lands. */
function LogSkeleton() {
  return (
    <div className="space-y-6" aria-busy aria-label="Loading the incidents">
      <div className="max-w-[72ch] space-y-2">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-2/3" />
      </div>
      <div className="rounded-xl border bg-card px-1 py-2 shadow-sm">
        <div className="border-b px-5 py-3">
          <Skeleton className="h-5 w-full" />
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="grid gap-4 border-b px-5 py-4 last:border-b-0 md:grid-cols-[6rem_minmax(0,1fr)] lg:grid-cols-[6rem_minmax(0,19rem)_minmax(0,1fr)]">
            <Skeleton className="h-6 w-20" />
            <div className="space-y-2">
              <Skeleton className="h-6 w-36" />
              <Skeleton className="h-6 w-56 max-w-full" />
              <Skeleton className="h-4 w-48 max-w-full" />
            </div>
            <Skeleton className="h-3.5 w-1/3 self-center max-lg:hidden" />
          </div>
        ))}
      </div>
    </div>
  );
}
