/**
 * What the monthly report says (docs/adr/0008): one month's Incidents and a summary of each
 * Device's Readings turned into a subject, plain text, and a simple HTML part, evidence to take to
 * facilities for HVAC work. How many incidents there were and how long in each Condition, the
 * hottest and most humid closets with their peaks, the closets that ran warm most of the month,
 * and each Device's Offline and Sensor fault time; every closet named links to its History.
 * Readable on a phone, like the Incident emails: no images, nothing loaded from anywhere.
 *
 * A pure function: no I/O, no clock. The month, the zone, and the dashboard's address are handed in.
 */
import type { ConditionName } from './conditions';
import type { TimedReading } from './incidents';
import { todayIn, type LocalMonth } from './localDay';
import type { Email } from './mailer';
import { degrees, duration, escapeHtml, percent, when, type EmailSettings } from './notificationEmail';

/**
 * A closet ran warm when most of its Readings were within this many °F of its own Hot warning, or
 * above it: a fixed line, not a comparison with the other closets (owner decision, 2026-10-07).
 */
export const WARM_MARGIN_F = 3;

/** How many closets the hottest and most humid lists name. */
export const PEAK_LIST_LENGTH = 5;

/** The temperature from which a Reading counts toward running warm, for a closet whose Hot warning is `hotWarningF`. */
export const warmFromF = (hotWarningF: number): number => hotWarningF - WARM_MARGIN_F;

/** One Device, and what its Readings in the month came to. */
export interface ReportCloset {
  device: {
    id: number;
    hostname: string;
    closet: string;
    campus: { name: string; shortcode: string };
  };
  /** The Hot warning the closet is judged by, in °F. */
  hotWarningF: number;
  /** How many Readings it sent in the month. */
  readings: number;
  /** How many of them were at or above warmFromF(hotWarningF). */
  warmReadings: number;
  /** Its hottest Reading, the first of any tie; null without Readings. */
  hottest: TimedReading | null;
  /** Its most humid Reading, the first of any tie; null without a humidity. */
  mostHumid: TimedReading | null;
}

/** An Incident that overlaps the month, as it stood when the report was built. */
export interface ReportIncident {
  deviceId: number;
  condition: ConditionName;
  start: Date;
  /** Null while it is ongoing. */
  end: Date | null;
}

/** Everything one month's report is built from. */
export interface MonthlyReport {
  month: LocalMonth;
  /** Every Device the report covers; Incidents of any other are left out. */
  closets: ReportCloset[];
  incidents: ReportIncident[];
}

const SUBJECT_PREFIX = '[Temperature Alarms]';

/** The order Conditions are listed in, as CONTEXT.md names them. */
const CONDITION_ORDER: readonly ConditionName[] = ['Hot', 'Cold', 'Dry', 'Mold risk', 'Sensor fault', 'Offline'];

/** The Conditions that mean the closet went unwatched, listed per Device. */
const UNWATCHED: readonly ConditionName[] = ['Offline', 'Sensor fault'];

const plural = (n: number, noun: string, nouns = `${noun}s`): string => `${n.toLocaleString('en-US')} ${n === 1 ? noun : nouns}`;

/** How long the incident lasted within the month: an ongoing one runs to the month's end. */
function msWithin({ start, end }: ReportIncident, { from, to }: LocalMonth): number {
  const until = Math.min((end ?? to).getTime(), to.getTime());
  return Math.max(0, until - Math.max(start.getTime(), from.getTime()));
}

/** "Central High School (CHS), IDF 2", as the Incident emails name a closet. */
const closetName = ({ device }: ReportCloset): string => `${device.campus.name} (${device.campus.shortcode}), ${device.closet}`;

/** One line about a closet: its name, which the HTML part links to its History, then what is said about it. */
interface ClosetLine {
  closet: string;
  facts: string;
  history: string;
}

/** One part of the report: a heading, a sentence under it, then plain lines or closet lines. */
interface Section {
  heading: string;
  lead: string;
  lines: string[];
  closets: ClosetLine[];
}

function closetLine(closet: ReportCloset, name: string, facts: string, day: Date, { publicUrl, timeZone }: EmailSettings): ClosetLine {
  return { closet: name, facts, history: `${publicUrl}/history/${closet.device.id}?date=${todayIn(day, timeZone)}` };
}

/** Closets with a peak, highest first, the earlier of a tie first, then by name. */
function byPeak(closets: ReportCloset[], value: (c: ReportCloset) => { figure: number; at: Date } | null): Array<{ closet: ReportCloset; figure: number; at: Date }> {
  return closets
    .flatMap((closet) => {
      const peak = value(closet);
      return peak === null ? [] : [{ closet, ...peak }];
    })
    .sort((a, b) => b.figure - a.figure || a.at.getTime() - b.at.getTime() || closetName(a.closet).localeCompare(closetName(b.closet)))
    .slice(0, PEAK_LIST_LENGTH);
}

function incidentsSection({ month, incidents }: MonthlyReport, monthName: string): Section {
  const totals = new Map<ConditionName, { count: number; ms: number }>();
  for (const incident of incidents) {
    const total = totals.get(incident.condition) ?? { count: 0, ms: 0 };
    totals.set(incident.condition, { count: total.count + 1, ms: total.ms + msWithin(incident, month) });
  }
  return {
    heading: 'Incidents',
    lead: incidents.length === 0 ? `No incidents in ${monthName}.` : `${plural(incidents.length, 'incident')} in ${monthName}, by Condition:`,
    lines: CONDITION_ORDER.flatMap((condition) => {
      const total = totals.get(condition);
      return total === undefined ? [] : [`${condition}: ${plural(total.count, 'incident')}, ${duration(total.ms)} in all`];
    }),
    closets: [],
  };
}

function hottestSection(report: MonthlyReport, monthName: string, settings: EmailSettings): Section {
  const ranked = byPeak(report.closets, (c) => (c.hottest === null ? null : { figure: c.hottest.tempF, at: c.hottest.recordedAt }));
  return {
    heading: 'Hottest closets',
    lead: ranked.length === 0 ? `No Readings in ${monthName}.` : "Each closet's hottest Reading, hottest first:",
    lines: [],
    closets: ranked.map(({ closet, figure, at }) =>
      closetLine(closet, closetName(closet), `${degrees(figure)} at ${when(at, settings.timeZone)}`, at, settings),
    ),
  };
}

function mostHumidSection(report: MonthlyReport, monthName: string, settings: EmailSettings): Section {
  const ranked = byPeak(report.closets, (c) =>
    c.mostHumid === null || c.mostHumid.humidity === null ? null : { figure: c.mostHumid.humidity, at: c.mostHumid.recordedAt },
  );
  return {
    heading: 'Most humid closets',
    lead: ranked.length === 0 ? `No humidity Readings in ${monthName}.` : "Each closet's most humid Reading, most humid first:",
    lines: [],
    closets: ranked.map(({ closet, figure, at }) =>
      closetLine(closet, closetName(closet), `${percent(figure)} at ${when(at, settings.timeZone)}`, at, settings),
    ),
  };
}

/** Closets where more than half the month's Readings were warm, the largest share first. */
function warmSection(report: MonthlyReport, settings: EmailSettings): Section {
  const warm = report.closets
    .filter((c) => c.readings > 0 && c.warmReadings * 2 > c.readings)
    .sort((a, b) => b.warmReadings / b.readings - a.warmReadings / a.readings || closetName(a).localeCompare(closetName(b)));
  const within = `within ${WARM_MARGIN_F} °F of`;
  return {
    heading: 'Ran warm most of the month',
    lead:
      warm.length === 0
        ? `No closet ran warm most of the month (more than half its Readings ${within} its Hot warning, or above it).`
        : `Closets with more than half their Readings ${within} their Hot warning, or above it:`,
    lines: [],
    closets: warm.map((closet) => {
      const share = Math.round((closet.warmReadings * 100) / closet.readings);
      const facts = `${share}% of its Readings at ${degrees(warmFromF(closet.hotWarningF))} or above (${closet.warmReadings.toLocaleString('en-US')} of ${closet.readings.toLocaleString('en-US')})`;
      // Every closet listed has Readings, so a hottest one.
      return closetLine(closet, closetName(closet), facts, closet.hottest?.recordedAt ?? report.month.from, settings);
    }),
  };
}

/** Each Device's Offline and Sensor fault time, the longest in all first. */
function unwatchedSection(report: MonthlyReport, settings: EmailSettings): Section {
  const { month } = report;
  const byDevice = new Map<number, { totals: Map<ConditionName, { count: number; ms: number }>; ms: number; first: Date }>();
  for (const incident of report.incidents) {
    if (!UNWATCHED.includes(incident.condition)) continue;
    const seen = byDevice.get(incident.deviceId) ?? { totals: new Map(), ms: 0, first: month.to };
    const ms = msWithin(incident, month);
    const total = seen.totals.get(incident.condition) ?? { count: 0, ms: 0 };
    seen.totals.set(incident.condition, { count: total.count + 1, ms: total.ms + ms });
    const start = new Date(Math.max(incident.start.getTime(), month.from.getTime()));
    byDevice.set(incident.deviceId, { totals: seen.totals, ms: seen.ms + ms, first: start < seen.first ? start : seen.first });
  }
  const rows = report.closets
    .flatMap((closet) => {
      const seen = byDevice.get(closet.device.id);
      return seen === undefined ? [] : [{ closet, ...seen }];
    })
    .sort((a, b) => b.ms - a.ms || closetName(a.closet).localeCompare(closetName(b.closet)));
  return {
    heading: 'Offline and Sensor fault time',
    lead: rows.length === 0 ? 'No Device was Offline or in Sensor fault.' : 'Time each Device went unwatched, the longest first:',
    lines: [],
    closets: rows.map(({ closet, totals, first }) => {
      const facts = UNWATCHED.flatMap((condition) => {
        const total = totals.get(condition);
        return total === undefined ? [] : [`${condition} ${duration(total.ms)} (${plural(total.count, 'incident')})`];
      }).join(', ');
      // The History link opens on the day its first stretch in the month began.
      return closetLine(closet, `${closetName(closet)}, ${closet.device.hostname}`, facts, first, settings);
    }),
  };
}

/**
 * The email for one month: a subject counting its incidents and the closets that ran warm, a line
 * on what it covers, then the incidents by Condition, the hottest and most humid closets with
 * their peaks, the closets that ran warm most of the month, and each Device's Offline and Sensor
 * fault time. Each closet line links to that Device's History on the day it is about.
 */
export function monthlyReportEmail(report: MonthlyReport, settings: EmailSettings): Email {
  // Only the Devices the report covers count: an incident of any other (the Bench) is left out.
  const covered = new Set(report.closets.map((c) => c.device.id));
  const scoped: MonthlyReport = { ...report, incidents: report.incidents.filter((i) => covered.has(i.deviceId)) };
  const monthName = new Intl.DateTimeFormat('en-US', { timeZone: report.month.timeZone, month: 'long', year: 'numeric' }).format(report.month.from);
  const campuses = new Set(report.closets.map((c) => c.device.campus.shortcode)).size;

  const warm = warmSection(scoped, settings);
  const sections = [
    incidentsSection(scoped, monthName),
    hottestSection(scoped, monthName, settings),
    mostHumidSection(scoped, monthName, settings),
    warm,
    unwatchedSection(scoped, settings),
  ];
  const intro = `Monthly report for ${monthName}: ${plural(report.closets.length, 'closet')} at ${plural(campuses, 'Campus', 'Campuses')}.`;
  const footer = `Sent by Temperature Alarms (${settings.publicUrl}). Times are ${settings.timeZone}.`;
  const incidentCount = scoped.incidents.length === 0 ? 'no incidents' : plural(scoped.incidents.length, 'incident');
  const warmCount = warm.closets.length === 0 ? 'no closet ran warm' : `${plural(warm.closets.length, 'closet')} ran warm`;

  const text = [
    intro,
    '',
    ...sections.flatMap(({ heading, lead, lines, closets }) => [
      heading,
      lead,
      ...lines,
      ...closets.flatMap(({ closet, facts, history }) => [`${closet}: ${facts}`, `History: ${history}`]),
      '',
    ]),
    '--',
    footer,
    '',
  ].join('\n');

  const html = [
    '<!doctype html>',
    '<html><body style="font-family: Arial, Helvetica, sans-serif; font-size: 15px; line-height: 1.4; color: #1a1a1a;">',
    `<p>${escapeHtml(intro)}</p>`,
    ...sections.flatMap(({ heading, lead, lines, closets }) => [
      `<h2 style="font-size: 17px; margin: 24px 0 8px;">${escapeHtml(heading)}</h2>`,
      `<p style="margin: 0 0 8px;">${escapeHtml(lead)}</p>`,
      ...(lines.length === 0 ? [] : [`<p style="margin: 0 0 8px;">${lines.map(escapeHtml).join('<br>')}</p>`]),
      ...closets.map(
        ({ closet, facts, history }) => `<p style="margin: 0 0 8px;"><a href="${escapeHtml(history)}">${escapeHtml(closet)}</a>: ${escapeHtml(facts)}</p>`,
      ),
    ]),
    `<p style="margin: 24px 0 0; font-size: 13px; color: #555;">${escapeHtml(footer)}</p>`,
    '</body></html>',
  ].join('\n');

  return { subject: `${SUBJECT_PREFIX} Monthly report, ${monthName}: ${incidentCount}, ${warmCount}`, text, html };
}
