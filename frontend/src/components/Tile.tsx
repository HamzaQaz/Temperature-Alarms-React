import { Card, CardContent } from '@/components/ui/card';

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

/** One headline number with a label above and a note beneath. Render inside a `<dl>`. */
export function Tile({ label, value, note, noteTone = 'muted' }: TileProps) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="px-5">
        <dt className="text-sm text-muted-foreground">{label}</dt>
        <dd className="mt-1 text-3xl font-semibold tabular-nums leading-none tracking-tight">{value}</dd>
        <dd className={noteTone === 'warn' ? 'mt-2 text-xs font-medium tabular-nums text-amber-700 dark:text-amber-400' : 'mt-2 text-xs tabular-nums text-muted-foreground'}>
          {note}
        </dd>
      </CardContent>
    </Card>
  );
}
