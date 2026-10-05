import { Card } from '@/components/ui/card';

/** A dash where a number would be, when there is nothing to show yet. */
export const NoValue = () => (
  <span className="font-normal text-muted-foreground" aria-label="No value">
    –
  </span>
);

interface TileProps {
  label: string;
  value: React.ReactNode;
  note: string;
  noteTone?: 'muted' | 'warn';
}

/**
 * One headline number with a label above and a note beneath. Render inside a `<dl>`: the card is
 * the `div` that groups one term with its descriptions, the only wrapper a `dl` allows.
 */
export function Tile({ label, value, note, noteTone = 'muted' }: TileProps) {
  return (
    <Card className="block px-4 py-4 sm:px-5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-3xl font-semibold tabular-nums leading-none tracking-tight">{value}</dd>
      <dd className={noteTone === 'warn' ? 'mt-2 text-xs font-medium tabular-nums text-amber-700 dark:text-amber-400' : 'mt-2 text-xs tabular-nums text-muted-foreground'}>
        {note}
      </dd>
    </Card>
  );
}
