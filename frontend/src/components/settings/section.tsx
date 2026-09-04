import { useState, type ReactNode } from 'react';
import { AlertCircle, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { TableCell, TableRow } from '@/components/ui/table';
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
import { cn } from '@/lib/utils';

/** Title, one-line purpose, and the section's primary action, laid out the same in every tab. */
interface SectionHeaderProps {
  id: string;
  title: string;
  description: string;
  action?: ReactNode;
}

export function SectionHeader({ id, title, description, action }: SectionHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        <h3 id={id} className="text-lg font-semibold leading-none">
          {title}
        </h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

/** Placeholder rows shaped like the data, shown while a list loads. */
export function SkeletonRows({ columns, rows = 3 }: { columns: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        <TableRow key={row} aria-hidden>
          {Array.from({ length: columns }, (_, column) => (
            <TableCell key={column}>
              <Skeleton className={cn('h-4', column === columns - 1 ? 'ml-auto w-6' : column === 0 ? 'w-40' : 'w-16')} />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

/** A full-width row for empty and error states. */
export function MessageRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={colSpan} className="py-10 text-center">
        {children}
      </TableCell>
    </TableRow>
  );
}

export function EmptyRow({ colSpan, title, hint }: { colSpan: number; title: string; hint: string }) {
  return (
    <MessageRow colSpan={colSpan}>
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
    </MessageRow>
  );
}

export function ErrorRow({ colSpan, message, onRetry }: { colSpan: number; message: string; onRetry: () => void }) {
  return (
    <MessageRow colSpan={colSpan}>
      <div className="flex flex-col items-center gap-3">
        <p className="flex items-center gap-2 text-sm">
          <AlertCircle className="size-4 text-destructive" aria-hidden />
          {message}
        </p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </MessageRow>
  );
}

/** An inline message for a failed change, shown next to the thing that failed. */
export function InlineError({ message, id }: { message: string | null; id?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="flex items-center gap-2 text-sm text-destructive">
      <AlertCircle className="size-4 shrink-0" aria-hidden />
      {message}
    </p>
  );
}

/** The panel an inline add form sits in, so every tab's form looks the same. */
export function InlineForm({ onSubmit, children }: { onSubmit: (event: React.FormEvent) => void; children: ReactNode }) {
  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-lg border bg-muted/40 p-4 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-200"
    >
      {children}
    </form>
  );
}

interface DeleteButtonProps {
  label: string;
  title: string;
  description: string;
  disabled?: boolean;
  onConfirm: () => Promise<void>;
}

/** A row's delete action, behind a confirmation, with a pending state while it runs. */
export function DeleteButton({ label, title, description, disabled, onConfirm }: DeleteButtonProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const confirm = async (event: React.MouseEvent) => {
    event.preventDefault();
    setPending(true);
    try {
      await onConfirm();
      setOpen(false);
    } finally {
      setPending(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          aria-label={label}
          title={disabled ? 'Enter the Admin token to delete' : label}
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 aria-hidden />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={confirm}
            disabled={pending}
            className="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/40"
          >
            {pending ? 'Deleting…' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
