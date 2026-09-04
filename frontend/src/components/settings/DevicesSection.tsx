import { useState } from 'react';
import { Plus } from 'lucide-react';
import { addDevice, deleteDevice, getCampuses, getDevices } from '@/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useChange } from '@/hooks/use-change';
import { useResource } from '@/hooks/use-resource';
import { DeleteButton, EmptyRow, ErrorRow, InlineError, InlineForm, SectionHeader, SkeletonRows } from './section';

interface DevicesSectionProps {
  canEdit: boolean;
  onUnauthorised: () => void;
}

const COLUMNS = 4;

/** Devices tab. Still on the legacy device shape; ticket 05 replaces the form and columns. */
export function DevicesSection({ canEdit, onUnauthorised }: DevicesSectionProps) {
  const { state, reload } = useResource(getDevices);
  const campuses = useResource(getCampuses);
  const add = useChange(onUnauthorised);
  const remove = useChange(onUnauthorised);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ name: '', campus: '', closet: '' });

  const closeForm = () => {
    setFormOpen(false);
    setForm({ name: '', campus: '', closet: '' });
    add.clearError();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (await add.run(() => addDevice(form.name.trim(), form.campus, form.closet.trim()))) {
      closeForm();
      await reload();
    }
  };

  const campusOptions = campuses.state.status === 'ready' ? campuses.state.data : [];
  const complete = form.name.trim() !== '' && form.campus !== '' && form.closet.trim() !== '';

  return (
    <section className="space-y-4" aria-labelledby="devices-heading">
      <SectionHeader
        id="devices-heading"
        title="Devices"
        description="One Device per Closet, identified by its ESP_ hostname."
        action={
          <Button size="sm" onClick={() => setFormOpen(true)} disabled={!canEdit || formOpen}>
            <Plus aria-hidden />
            Add device
          </Button>
        }
      />

      {formOpen && (
        <InlineForm onSubmit={submit}>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="device-name">Hostname</Label>
              <Input
                id="device-name"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="ESP_A1B2C3"
                className="font-mono"
                autoFocus
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="device-campus">Campus</Label>
              <Select value={form.campus} onValueChange={(campus) => setForm({ ...form, campus })}>
                <SelectTrigger id="device-campus" className="w-full">
                  <SelectValue placeholder={campusOptions.length === 0 ? 'No campuses yet' : 'Choose a campus'} />
                </SelectTrigger>
                <SelectContent>
                  {campusOptions.map((campus) => (
                    <SelectItem key={campus.id} value={campus.shortcode}>
                      {campus.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="device-closet">Closet</Label>
              <Input
                id="device-closet"
                value={form.closet}
                onChange={(event) => setForm({ ...form, closet: event.target.value })}
                placeholder="IDF 2"
                required
              />
            </div>
          </div>
          <InlineError message={add.error} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={add.pending || !canEdit || !complete}>
              {add.pending ? 'Saving…' : 'Save device'}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={closeForm} disabled={add.pending}>
              Cancel
            </Button>
          </div>
        </InlineForm>
      )}

      <InlineError message={remove.error} />

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Hostname</TableHead>
              <TableHead>Campus</TableHead>
              <TableHead>Closet</TableHead>
              <TableHead className="w-14">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.status === 'loading' && <SkeletonRows columns={COLUMNS} />}
            {state.status === 'error' && <ErrorRow colSpan={COLUMNS} message={`Could not load devices. ${state.message}`} onRetry={reload} />}
            {state.status === 'ready' && state.data.length === 0 && (
              <EmptyRow colSpan={COLUMNS} title="No devices yet" hint="Add a Device by its hostname to see it on the dashboard." />
            )}
            {state.status === 'ready' &&
              state.data.map((device) => (
                <TableRow key={device.ID}>
                  <TableCell className="font-mono font-medium">{device.Name}</TableCell>
                  <TableCell>{device.Campus}</TableCell>
                  <TableCell>{device.Location}</TableCell>
                  <TableCell className="text-right">
                    <DeleteButton
                      label={`Delete ${device.Name}`}
                      title={`Delete ${device.Name}?`}
                      description="Its Readings go with it. The Device will need to be added again to show on the dashboard."
                      disabled={!canEdit}
                      onConfirm={async () => {
                        if (await remove.run(() => deleteDevice(device.ID, device.Name))) await reload();
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
