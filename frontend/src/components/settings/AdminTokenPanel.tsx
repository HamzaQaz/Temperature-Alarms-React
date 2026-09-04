import { useEffect, useRef, useState } from 'react';
import { KeyRound, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface AdminTokenPanelProps {
  /** Whether a token is currently stored in this browser. */
  hasToken: boolean;
  /** True when the server rejected the stored token on the last change. */
  rejected: boolean;
  onSave: (token: string) => void;
  onForget: () => void;
}

/**
 * Asks for the Admin token once and shows where it lives afterwards.
 * Expands on its own when no token is stored or the server rejected the last one.
 */
export function AdminTokenPanel({ hasToken, rejected, onSave, onForget }: AdminTokenPanelProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const open = !hasToken || editing || rejected;

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-4 py-3 text-sm">
        <KeyRound className="size-4 text-muted-foreground" aria-hidden />
        <span className="min-w-[14rem] flex-1">
          <span className="font-medium">Admin token saved</span>
          <span className="text-muted-foreground"> in this browser and sent with every change.</span>
        </span>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            Change
          </Button>
          <Button variant="ghost" size="sm" onClick={onForget}>
            Forget
          </Button>
        </div>
      </div>
    );
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const token = draft.trim();
    if (token === '') return;
    onSave(token);
    setDraft('');
    setEditing(false);
  };

  return (
    <form
      onSubmit={submit}
      className="rounded-lg border bg-card p-4 shadow-sm motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200"
      aria-labelledby="admin-token-title"
    >
      <div className="flex items-start gap-3">
        {rejected ? (
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
        ) : (
          <KeyRound className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <h3 id="admin-token-title" className="font-semibold leading-none">
            {rejected ? 'Not authorised' : hasToken ? 'Change the Admin token' : 'Admin token needed'}
          </h3>
          <p className="text-sm text-muted-foreground">
            {rejected
              ? 'The server rejected the Admin token. Enter the current one to keep going. Nothing was changed.'
              : 'Adding or deleting anything here sends the shared Admin token. Viewing the dashboard never needs it. It is kept in this browser only.'}
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-2">
          <Label htmlFor="admin-token">Admin token</Label>
          <Input
            ref={inputRef}
            id="admin-token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Paste the token from the server's .env"
            aria-invalid={rejected || undefined}
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={draft.trim() === ''}>
            Save token
          </Button>
          {hasToken && !rejected && (
            <Button type="button" variant="outline" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
