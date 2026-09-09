import { useRef, useState } from 'react';
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
import {
  DeleteButton,
  EmptyRow,
  ErrorRow,
  FieldHint,
  InlineError,
  InlineForm,
  SectionHeader,
  SkeletonRows,
  StatusLine,
  WrappingCell,
} from './section';

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
  const [submitted, setSubmitted] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const hostnameInput = useRef<HTMLInputElement>(null);

  const hostnameError = form.hostname === '' ? (submitted ? 'Enter the hostname.' : null) : hostnameProblem(form.hostname);
  const showHostnameError = (hostnameTouched || submitted) && hostnameError !== null;
  const campusMissing = form.campusId === '';
  const closetMissing = form.closet.trim() === '';

  const closeForm = () => {
    setFormOpen(false);
    setForm(EMPTY_FORM);
    setHostnameTouched(false);
    setSubmitted(false);
    add.clearError();
  };

  const openForm = () => {
    setStatus(null);
    setFormOpen(true);
  };

  // Boards are flashed in batches, so a saved Device leaves the form open for the next one:
  // hostname and closet cleared, the campus kept, focus back in the hostname field.
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    setHostnameTouched(true);
    if (hostnameError !== null || campusMissing || closetMissing) return;
    const hostname = form.hostname;
    const result = await add.run(() => addDevice(hostname, Number(form.campusId), form.closet.trim()));
    if (!result.ok) return;
    setForm({ ...EMPTY_FORM, campusId: form.campusId });
    setHostnameTouched(false);
    setSubmitted(false);
    setStatus(`${hostname} added. It appears on the dashboard with its first Reading.`);
    await reload();
    hostnameInput.current?.focus();
  };

  const removeDevice = async (id: number, hostname: string) => {
    const result = await remove.run(() => deleteDevice(id));
    if (result.ok) {
      setStatus(`${hostname} deleted.`);
      await reload();
      // The row that held the trash button is gone; land somewhere sensible rather than on body.
      addButton.current?.focus();
    }
    return result;
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
          <Button ref={addButton} size="sm" onClick={openForm} disabled={!canEdit || formOpen}>
            <Plus aria-hidden />
            Add device
          </Button>
        }
      />

      {formOpen && (
        <InlineForm onSubmit={submit} aria-label="Add a device">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="device-hostname">Hostname</Label>
              <Input
                ref={hostnameInput}
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
                aria-describedby={showHostnameError ? 'device-hostname-error device-hostname-hint' : 'device-hostname-hint'}
                autoFocus
              />
              {showHostnameError && <InlineError id="device-hostname-error" message={hostnameError} />}
            </div>
            <div className="space-y-2">
              <Label htmlFor="device-campus">Campus</Label>
              <Select value={form.campusId} onValueChange={(campusId) => setForm({ ...form, campusId })} disabled={noCampuses}>
                <SelectTrigger
                  id="device-campus"
                  className="w-full"
                  aria-invalid={(submitted && campusMissing && !noCampuses) || undefined}
                  aria-describedby={submitted && campusMissing && !noCampuses ? 'device-campus-error' : undefined}
                >
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
              {submitted && campusMissing && !noCampuses && <InlineError id="device-campus-error" message="Choose the campus the closet is at." />}
            </div>
            <div className="space-y-2">
              <Label htmlFor="device-closet">Closet</Label>
              <Input
                id="device-closet"
                value={form.closet}
                onChange={(event) => setForm({ ...form, closet: event.target.value })}
                placeholder="IDF 2"
                maxLength={CLOSET_MAX}
                aria-invalid={(submitted && closetMissing) || undefined}
                aria-describedby={submitted && closetMissing ? 'device-closet-error device-closet-hint' : 'device-closet-hint'}
              />
              {submitted && closetMissing && <InlineError id="device-closet-error" message="Name the closet." />}
            </div>
          </div>
          <FieldHint id="device-hostname-hint">
            The hostname is ESP_ followed by the last six hex digits of the Device's MAC address. It is printed to serial on boot.
          </FieldHint>
          <p id="device-closet-hint" className="sr-only">
            Name the closet by its network role and number, like IDF 2 or MDF.
          </p>
          {noCampuses && <InlineError message="A Device needs a Campus. Add one on the Campuses tab first." />}
          <InlineError message={add.error} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={add.pending || !canEdit || noCampuses}>
              {add.pending ? 'Saving…' : 'Save device'}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={closeForm} disabled={add.pending}>
              {status === null ? 'Cancel' : 'Done'}
            </Button>
            {noCampuses && (
              <Button asChild type="button" size="sm" variant="link">
                <Link to="/settings?tab=campuses">Go to Campuses</Link>
              </Button>
            )}
          </div>
        </InlineForm>
      )}

      <StatusLine message={status} />

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
                  <WrappingCell>
                    {device.campus.name} <span className="font-mono text-xs text-muted-foreground">{device.campus.shortcode}</span>
                  </WrappingCell>
                  <WrappingCell>{device.closet}</WrappingCell>
                  <TableCell className="text-right">
                    <DeleteButton
                      label={`Delete ${device.hostname}`}
                      title={`Delete ${device.hostname}?`}
                      description={`Every Reading from ${device.closet} at ${device.campus.name} is deleted with it. Add the Device again to store new Readings.`}
                      disabled={!canEdit}
                      error={remove.error}
                      onConfirm={() => removeDevice(device.id, device.hostname)}
                      onDismiss={remove.clearError}
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
