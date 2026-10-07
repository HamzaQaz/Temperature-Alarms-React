import { useState } from 'react';
import { AlertCircle, Mail } from 'lucide-react';
import { getNotificationStatus, sendTestEmail } from '@/api';
import { Button } from '@/components/ui/button';
import { useChange } from '@/hooks/use-change';
import { useResource } from '@/hooks/use-resource';
import { notificationsSummary, testEmailSent } from '@/lib/notifications';
import { InlineError, SectionHeader, StatusLine } from './section';

interface NotificationsSectionProps {
  /** False while no Admin token is stored: the status needs it to be read at all. */
  canEdit: boolean;
  onUnauthorised: () => void;
}

const timeOf = (iso: string): string => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Email notifications (docs/adr/0008): whether Incidents are emailed, to whom, how the last send
 * went, what waits to be sent or was given up on, and a test email to prove the relay works. The
 * settings themselves live in the server's .env.
 */
export function NotificationsSection({ canEdit, onUnauthorised }: NotificationsSectionProps) {
  return (
    <section className="space-y-4" aria-labelledby="notifications-heading">
      <SectionHeader
        id="notifications-heading"
        title="Notifications"
        description="Emails to technicians when an Incident opens, gets worse, or ends, sent through the district's SMTP relay. The relay and the recipients are set in the server's .env."
      />
      {canEdit ? (
        <NotificationStatusAndTest onUnauthorised={onUnauthorised} />
      ) : (
        <p className="text-sm text-muted-foreground">Enter the Admin token above to see whether notifications are on and send a test email.</p>
      )}
    </section>
  );
}

function NotificationStatusAndTest({ onUnauthorised }: { onUnauthorised: () => void }) {
  const { state, reload } = useResource(getNotificationStatus);
  const test = useChange(onUnauthorised);
  const [status, setStatus] = useState<string | null>(null);

  const send = async () => {
    setStatus(null);
    await test.run(async () => setStatus(testEmailSent(await sendTestEmail())));
    // A failure is recorded too, so the last result below changes either way.
    await reload();
  };

  const summary = state.status === 'ready' ? notificationsSummary(state.data, timeOf) : null;
  const enabled = state.status === 'ready' && state.data.enabled;

  return (
    <>
      {state.status === 'loading' && <p className="text-sm text-muted-foreground">Loading…</p>}
      {state.status === 'error' && <InlineError message={`Could not load the notification status. ${state.message}`} />}
      {summary !== null && (
        <div className="flex flex-col items-start gap-3 rounded-lg border px-4 py-3 text-sm sm:flex-row">
          <div className="w-full min-w-0 flex-1 space-y-1">
            <p className="break-words">
              <span className="font-medium">{summary.state}</span> {summary.detail}
            </p>
            {summary.lastSent !== null && <p className="break-words text-muted-foreground">{summary.lastSent}</p>}
            {summary.pending !== null && <p className="text-muted-foreground">{summary.pending}</p>}
            {summary.lastFailure !== null && (
              <p className="flex items-start gap-2 text-destructive">
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span className="min-w-0 break-words">{summary.lastFailure}</span>
              </p>
            )}
            {summary.failed !== null && (
              <p className="flex items-start gap-2 text-destructive">
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span className="min-w-0 break-words">{summary.failed}</span>
              </p>
            )}
            {enabled && summary.lastSent === null && summary.lastFailure === null && (
              <p className="text-muted-foreground">Nothing sent in the last week.</p>
            )}
          </div>
          {enabled && (
            <Button variant="outline" size="sm" onClick={send} disabled={test.pending}>
              <Mail aria-hidden />
              {test.pending ? 'Sending…' : 'Send test email'}
            </Button>
          )}
        </div>
      )}
      <InlineError message={test.error} />
      <StatusLine message={status} />
    </>
  );
}
