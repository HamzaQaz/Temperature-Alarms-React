import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { addDevice, deleteDevice, getCampuses, getDevices } from '@/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useChange } from '@/hooks/use-change';
import { useResource } from '@/hooks/use-resource';
import { HOSTNAME_EXAMPLE, hostnameProblem } from '@/lib/hostname';
import { DeleteButton, EmptyRow, ErrorRow, InlineError, InlineForm, SectionHeader, SkeletonRows } from './section';

interface DevicesSectionProps {
  /** False while no Admin token is stored; changes are disabled and the token panel explains why. */
  canEdit: boolean;
  onUnauthorised: () => void;
}

const COLUMNS = 4;
const HOSTNAME_LENGTH = HOSTNAME_EXAMPLE.length;
const CLOSET_MAX = 50;
const EMPTY_FORM = { hostname: '', campusId: '', closet: '' };

export function DevicesSection({ canEdit, onUnauthorised }: DevicesSectionProps) {
  const { state, reload } = useResource(getDevices);
  const campuses = useResource(getCampuses);
  const add = useChange(onUnauthorised);
  const remove = useChange(onUnauthorised);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [hostnameTouched, setHostnameTouched] = useState(false);

  const closeForm = () => {
    setFormOpen(false);
    setForm(EMPTY_FORM);
    setHostnameTouched(false);
    add.clearError();
  };

  const hostnameError = form.hostname === '' ? null : hostnameProblem(form.hostname);
  const showHostnameError = hostnameTouched && hostnameError !== null;
  const canSubmit = form.hostname !== '' && hostnameError === null && form.campusId !== '' && form.closet.trim() !== '';

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setHostnameTouched(true);
    if (!canSubmit) return;
    if (await add.run(() => addDevice(form.hostname, Number(form.campusId), form.closet.trim()))) {
      closeForm();
      await reload();
    }
  };

  const campusOptions = campuses.state.status === 'ready' ? campuses.state.data : [];
  const noCampuses = campuses.state.status === 'ready' && campusOptions.length === 0;

  return (
    <section className="space-y-4" aria-labelledby="devices-heading">
      <SectionHeader
        id="devices-heading"
        title="Devices"
        description="One Device per Closet, identified by its ESP_ hostname. Deleting a Device deletes its Readings."
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
              <Label htmlFor="device-hostname">Hostname</Label>
              <Input
                id="device-hostname"
                value={form.hostname}
                onChange={(event) => setForm({ ...form, hostname: event.target.value.toUpperCase().trim() })}
                onBlur={() => setHostnameTouched(true)}
                placeholder={HOSTNAME_EXAMPLE}
                maxLength={HOSTNAME_LENGTH}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                className="font-mono uppercase"
                aria-invalid={showHostnameError || undefined}
                aria-describedby={showHostnameError ? 'device-hostname-error' : 'device-hostname-hint'}
                autoFocus
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="device-campus">Campus</Label>
              <Select value={form.campusId} onValueChange={(campusId) => setForm({ ...form, campusId })} disabled={noCampuses}>
                <SelectTrigger id="device-campus" className="w-full">
                  <SelectValue placeholder={noCampuses ? 'No campuses yet' : 'Choose a campus'} />
                </SelectTrigger>
                <SelectContent>
                  {campusOptions.map((campus) => (
                    <SelectItem key={campus.id} value={String(campus.id)}>
                      {campus.name} <span className="text-muted-foreground">({campus.shortcode})</span>
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
                maxLength={CLOSET_MAX}
                aria-describedby="device-closet-hint"
                required
              />
            </div>
          </div>
          {showHostnameError ? (
            <InlineError id="device-hostname-error" message={hostnameError} />
          ) : (
            <p id="device-hostname-hint" className="text-xs text-muted-foreground">
              The hostname is ESP_ followed by the last six hex digits of the Device's MAC address. It is printed to serial on boot.
            </p>
          )}
          <p id="device-closet-hint" className="sr-only">
            Name the closet by its network role and number, like IDF 2 or MDF.
          </p>
          {noCampuses && (
            <InlineError
              message="A Device needs a Campus. Add one on the Campuses tab first."
            />
          )}
          <InlineError message={add.error} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={add.pending || !canEdit || !canSubmit}>
              {add.pending ? 'Saving…' : 'Save device'}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={closeForm} disabled={add.pending}>
              Cancel
            </Button>
            {noCampuses && (
              <Button asChild type="button" size="sm" variant="link">
                <Link to="/settings?tab=campuses">Go to Campuses</Link>
              </Button>
            )}
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
                <TableRow key={device.id}>
                  <TableCell className="font-mono font-medium">{device.hostname}</TableCell>
                  <TableCell>
                    {device.campus.name} <span className="font-mono text-xs text-muted-foreground">{device.campus.shortcode}</span>
                  </TableCell>
                  <TableCell>{device.closet}</TableCell>
                  <TableCell className="text-right">
                    <DeleteButton
                      label={`Delete ${device.hostname}`}
                      title={`Delete ${device.hostname}?`}
                      description={`Every Reading from ${device.closet} at ${device.campus.name} is deleted with it. Add the Device again to store new Readings.`}
                      disabled={!canEdit}
                      onConfirm={async () => {
                        if (await remove.run(() => deleteDevice(device.id))) await reload();
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
