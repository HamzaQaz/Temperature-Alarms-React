import { Badge } from '@/components/ui/badge';
import { levelLook } from '@/lib/conditions';
import { cn } from '@/lib/utils';
import type { Condition } from '@/types';

/**
 * One Condition with its level spelled out, sized to be read from across a room. The level is set
 * back at 90%: at 80% it falls under 4.5:1 on the critical fill and on the light moderate tint. On
 * the light theme's critical red (a lighter fill than the dark theme's) even 90% white is 4:1, so
 * there the level stays at full strength and only its weight sets it apart.
 */
export function ConditionBadge({ condition, className }: { condition: Condition; className?: string }) {
  return (
    <Badge className={cn('px-2.5 py-1 text-sm font-semibold', levelLook(condition.level).badge, className)}>
      {condition.name}
      <span className={cn('font-normal', condition.level === 'critical' ? 'dark:opacity-90' : 'opacity-90')}>· {condition.level}</span>
    </Badge>
  );
}
