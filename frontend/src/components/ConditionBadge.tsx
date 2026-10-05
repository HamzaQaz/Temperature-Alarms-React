import { Badge } from '@/components/ui/badge';
import { levelLook } from '@/lib/conditions';
import { cn } from '@/lib/utils';
import type { Condition } from '@/types';

/** One Condition with its level spelled out, sized to be read from across a room. */
export function ConditionBadge({ condition, className }: { condition: Condition; className?: string }) {
  return (
    <Badge className={cn('px-2.5 py-1 text-sm font-semibold', levelLook(condition.level).badge, className)}>
      {condition.name}
      <span className="font-normal opacity-80">· {condition.level}</span>
    </Badge>
  );
}
