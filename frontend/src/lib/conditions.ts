/**
 * How the dashboard shows Conditions. The server decides which Conditions a Device is in
 * and sends them worst first; this module maps a level to a look and to whether the summary
 * counts it. No threshold lives here.
 */
import type { Condition, ConditionLevel, ConditionName, DashboardDevice } from '@/types';

interface LevelLook {
  /** Badge colours: a tint for anything short of critical, solid for critical. */
  badge: string;
  /** Card border colour when this is the worst level present. */
  border: string;
  /** The same hue at full strength, for the stroke that draws the new border when a card escalates. */
  trace: string;
  /** A stretch at this level on the incident ruler: the badge's hue as a fill with no text on it, solid for critical. */
  span: string;
  /** A day an incident reached this level on the Campuses chart: a past day at the span's strength, and today, still going, solid. */
  column: { past: string; today: string };
}

const LOOKS: Record<ConditionLevel, LevelLook> = {
  critical: {
    badge: 'border-transparent bg-destructive-solid text-destructive-solid-foreground',
    border: 'border-destructive',
    trace: 'stroke-destructive',
    span: 'bg-destructive-solid',
    column: { past: 'fill-destructive-solid', today: 'fill-destructive-solid' },
  },
  high: {
    badge: 'border-transparent bg-red-500/15 text-red-700 dark:bg-red-500/20 dark:text-red-300',
    border: 'border-red-500/70',
    trace: 'stroke-red-500',
    span: 'bg-red-500/70 dark:bg-red-500/55',
    column: { past: 'fill-red-600/70 dark:fill-red-500/70', today: 'fill-red-600 dark:fill-red-500' },
  },
  warning: {
    badge: 'border-transparent bg-amber-500/15 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
    border: 'border-amber-500/70',
    trace: 'stroke-amber-500',
    span: 'bg-amber-500/70 dark:bg-amber-500/45',
    column: { past: 'fill-amber-600/70 dark:fill-amber-500/70', today: 'fill-amber-600 dark:fill-amber-500' },
  },
  moderate: {
    badge: 'border-transparent bg-yellow-400/20 text-yellow-800 dark:bg-yellow-400/15 dark:text-yellow-200',
    border: 'border-yellow-500/60',
    trace: 'stroke-yellow-500',
    span: 'bg-yellow-400/60 dark:bg-yellow-400/35',
    column: { past: 'fill-yellow-500/60 dark:fill-yellow-400/60', today: 'fill-yellow-500 dark:fill-yellow-400' },
  },
};

export const levelLook = (level: ConditionLevel): LevelLook => LOOKS[level];

/**
 * What a stretch on the incident ruler is drawn as: its level's colour, except Sensor fault, which
 * has its own (Fault Violet), so a closet nobody is watching never reads as one that ran hot. Its
 * badge and border stay critical: there the level speaks, and the ruler's legend names the violet.
 */
export type SpanKind = ConditionLevel | 'Sensor fault';

export const spanKind = (condition: ConditionName, level: ConditionLevel): SpanKind => (condition === 'Sensor fault' ? 'Sensor fault' : level);

/** Solid like critical, the level it always is: the 600 step on light, the 500 on dark. */
const SENSOR_FAULT_SPAN = 'bg-violet-600 dark:bg-violet-500';

export const spanFill = (kind: SpanKind): string => (kind === 'Sensor fault' ? SENSOR_FAULT_SPAN : LOOKS[kind].span);

/** The legend's order: the levels worst first, then Sensor fault. */
export const SPAN_KINDS: readonly SpanKind[] = ['critical', 'high', 'warning', 'moderate', 'Sensor fault'];

/** How loud a level is, for telling an escalation from a de-escalation. No Condition is 0. */
const RANK: Record<ConditionLevel, number> = { moderate: 1, warning: 2, high: 3, critical: 4 };

export const levelRank = (level: ConditionLevel | undefined): number => (level === undefined ? 0 : RANK[level]);

/** The most severe Condition, relying on the server's worst-first order. */
export const worstCondition = (conditions: Condition[]): Condition | undefined => conditions[0];

/** Warning or worse: what the summary counts. Moderate is a heads-up the card shows but the tile does not tally. */
const WARNING_OR_WORSE: ReadonlySet<ConditionLevel> = new Set<ConditionLevel>(['critical', 'high', 'warning']);

export const isWarningOrWorse = (condition: Condition): boolean => WARNING_OR_WORSE.has(condition.level);

export const hasWarningOrWorse = (device: DashboardDevice): boolean => device.conditions.some(isWarningOrWorse);
