/**
 * How the dashboard shows Conditions. The server decides which Conditions a Device is in
 * and sends them worst first; this module maps a level to a look and to whether the summary
 * counts it. No threshold lives here.
 */
import type { Condition, ConditionLevel, DashboardDevice } from '@/types';

interface LevelLook {
  /** Badge colours: a tint for anything short of critical, solid for critical. */
  badge: string;
  /** Card border colour when this is the worst level present. */
  border: string;
}

const LOOKS: Record<ConditionLevel, LevelLook> = {
  critical: {
    badge: 'border-transparent bg-destructive-solid text-destructive-solid-foreground',
    border: 'border-destructive',
  },
  high: {
    badge: 'border-transparent bg-red-500/15 text-red-700 dark:bg-red-500/20 dark:text-red-300',
    border: 'border-red-500/70',
  },
  warning: {
    badge: 'border-transparent bg-amber-500/15 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
    border: 'border-amber-500/70',
  },
  moderate: {
    badge: 'border-transparent bg-yellow-400/20 text-yellow-800 dark:bg-yellow-400/15 dark:text-yellow-200',
    border: 'border-yellow-500/60',
  },
};

export const levelLook = (level: ConditionLevel): LevelLook => LOOKS[level];

/** The most severe Condition, relying on the server's worst-first order. */
export const worstCondition = (conditions: Condition[]): Condition | undefined => conditions[0];

/** Warning or worse: what the summary counts. Moderate is a heads-up the card shows but the tile does not tally. */
const WARNING_OR_WORSE: ReadonlySet<ConditionLevel> = new Set<ConditionLevel>(['critical', 'high', 'warning']);

export const isWarningOrWorse = (condition: Condition): boolean => WARNING_OR_WORSE.has(condition.level);

export const hasWarningOrWorse = (device: DashboardDevice): boolean => device.conditions.some(isWarningOrWorse);
