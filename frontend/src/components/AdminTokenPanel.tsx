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
  /** Leave the "Not authorised" state without entering a token. The panel stays open if none is stored. */
  onDismissRejection?: () => void;
  /** What on this page sends the token, e.g. "Adding or deleting anything here". */
  action?: string;
}

/**
 * Asks for the Admin token once and shows where it lives afterwards.
 * Expands on its own when no token is stored or the server rejected the last one.
 * After a save, focus lands on the Change button so a keyboard user is still in the panel.
 */
export function AdminTokenPanel({
  hasToken,
  rejected,
  onSave,
  onForget,
  onDismissRejection,
  action = 'Adding or deleting anything here',
}: AdminTokenPanelProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [justSaved, setJustSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const changeRef = useRef<HTMLButtonElement>(null);
  const open = !hasToken || editing || rejected;

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open && justSaved) {
      changeRef.current?.focus();
      setJustSaved(false);
    }
  }, [open, justSaved]);

  if (!open) {
    return (
      <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-4 py-3 text-sm">
        <KeyRound className="size-4 text-muted-foreground" aria-hidden />
        <span className="min-w-[14rem] flex-1">
          <span className="font-medium">Admin token saved</span>
          <span className="text-muted-foreground"> in this browser and sent with every change.</span>
        </span>
        <div className="flex gap-1">
          <Button ref={changeRef} variant="ghost" size="sm" onClick={() => setEditing(true)}>
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
    setJustSaved(true);
  };

  const cancel = () => {
    setDraft('');
    setEditing(false);
    onDismissRejection?.();
  };
  // Cancel leaves an edit, or the "Not authorised" state; with no token stored the panel stays, as it should.
  const canCancel = (hasToken && !rejected) || (rejected && onDismissRejection !== undefined);

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
          <h2 id="admin-token-title" className="font-semibold leading-none">
            {rejected ? 'Not authorised' : hasToken ? 'Change the Admin token' : 'Admin token needed'}
          </h2>
          {/* The rejection is announced from here, so the heading keeps its role and the sentence is heard whole. */}
          <p className="max-w-prose text-sm text-muted-foreground" role={rejected ? 'alert' : undefined}>
            {rejected
              ? 'The server rejected the Admin token. Enter the current one to keep going. Nothing was changed.'
              : `${action} sends the shared Admin token. Viewing the dashboard never needs it. It is kept in this browser only.`}
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
          {canCancel && (
            <Button type="button" variant="outline" onClick={cancel}>
              Cancel
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
