import { deleteAlarm, getAlarms } from '@/api';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useChange } from '@/hooks/use-change';
import { useResource } from '@/hooks/use-resource';
import { DeleteButton, EmptyRow, ErrorRow, InlineError, SectionHeader, SkeletonRows } from './section';

interface AlarmsSectionProps {
  canEdit: boolean;
  onUnauthorised: () => void;
}

const COLUMNS = 3;

/** Alarms are being retired (ticket 05 removes this tab). Until then: list and delete only. */
export function AlarmsSection({ canEdit, onUnauthorised }: AlarmsSectionProps) {
  const { state, reload } = useResource(getAlarms);
  const remove = useChange(onUnauthorised);

  return (
    <section className="space-y-4" aria-labelledby="alarms-heading">
      <SectionHeader id="alarms-heading" title="Alarms" description="Email thresholds. Nothing sends these, and this tab is being retired." />
      <InlineError message={remove.error} />
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead className="w-32">Threshold</TableHead>
              <TableHead className="w-14">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.status === 'loading' && <SkeletonRows columns={COLUMNS} />}
            {state.status === 'error' && <ErrorRow colSpan={COLUMNS} message={`Could not load alarms. ${state.message}`} onRetry={reload} />}
            {state.status === 'ready' && state.data.length === 0 && (
              <EmptyRow colSpan={COLUMNS} title="No alarms" hint="Nothing left to remove." />
            )}
            {state.status === 'ready' &&
              state.data.map((alarm) => (
                <TableRow key={alarm.ID}>
                  <TableCell className="font-medium">{alarm.EMAIL}</TableCell>
                  <TableCell className="tabular-nums">{alarm.TEMP}°F</TableCell>
                  <TableCell className="text-right">
                    <DeleteButton
                      label={`Delete alarm for ${alarm.EMAIL}`}
                      title="Delete this alarm?"
                      description={`${alarm.EMAIL} will no longer be listed.`}
                      disabled={!canEdit}
                      onConfirm={async () => {
                        if (await remove.run(() => deleteAlarm(alarm.ID))) await reload();
                      }}
                    />
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
