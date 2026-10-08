import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { getFirmwareStatus, publishFirmware, withdrawFirmware } from '@/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useChange } from '@/hooks/use-change';
import { useResource } from '@/hooks/use-resource';
import { firmwareSummary } from '@/lib/firmware';
import { formatHeap, formatSignal, formatUptime } from '@/lib/deviceInfo';
import { formatAge } from '@/lib/reportTiming';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DeleteButton, FieldHint, InlineError, InlineForm, SectionHeader, StatusLine } from './section';

interface FirmwareSectionProps {
  /** False while no Admin token is stored: the release and the versions need it to be read at all. */
  canEdit: boolean;
  onUnauthorised: () => void;
}

const dateOf = (iso: string): string => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

const parseOnly = (text: string): string[] =>
  text
    .split(/[\s,]+/)
    .map((h) => h.trim().toUpperCase())
    .filter((h) => h !== '');

/**
 * Over-the-air firmware (docs/adr/0007): the build on offer, which Devices run it, and publishing a
 * new one. Boards check every hour and install a signed build whose version is above their own.
 */
export function FirmwareSection({ canEdit, onUnauthorised }: FirmwareSectionProps) {
  return (
    <section className="space-y-4" aria-labelledby="firmware-heading">
      <SectionHeader
        id="firmware-heading"
        title="Firmware"
        description="Builds the boards install over WiFi. A board installs a signed build with a higher version than its own within one Report interval of its publication (an hour for boards before version 3), then restarts."
      />
      {canEdit ? (
        <FirmwareStatusAndPublish onUnauthorised={onUnauthorised} />
      ) : (
        <p className="text-sm text-muted-foreground">Enter the Admin token above to see the published firmware and publish a new build.</p>
      )}
    </section>
  );
}

function FirmwareStatusAndPublish({ onUnauthorised }: { onUnauthorised: () => void }) {
  const { state, reload } = useResource(getFirmwareStatus);
  const publish = useChange(onUnauthorised);
  const withdraw = useChange(onUnauthorised);
  const [file, setFile] = useState<File | null>(null);
  const [only, setOnly] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (file === null) return;
    setStatus(null);
    const targets = parseOnly(only);
    const result = await publish.run(() => publishFirmware(file, targets));
    if (!result.ok) return;
    setStatus(
      targets.length > 0
        ? `Published to ${targets.join(', ')}. Once they run it, publish the same file again with the box empty for every Device.`
        : 'Published to every Device. Boards on version 3 or later install it within a Report interval; older ones within the hour.',
    );
    setFile(null);
    if (fileInput.current) fileInput.current.value = '';
    await reload();
  };

  const removeRelease = async () => {
    const result = await withdraw.run(() => withdrawFirmware());
    if (result.ok) {
      setStatus('Withdrawn. Boards keep what they run.');
      await reload();
    }
    return result;
  };

  const summary = state.status === 'ready' ? firmwareSummary(state.data, dateOf) : null;

  return (
    <>
      {state.status === 'loading' && <p className="text-sm text-muted-foreground">Loading…</p>}
      {state.status === 'error' && <InlineError message={`Could not load the firmware status. ${state.message}`} />}
      {summary !== null && (
        <div className="flex items-start gap-3 rounded-lg border px-4 py-3 text-sm">
          <div className="min-w-0 flex-1 space-y-1">
            <p>
              <span className="font-medium">{summary.release}</span> {summary.progress}
            </p>
            {summary.behind.length > 0 && <p className="text-muted-foreground">Still on an older build: {summary.behind.join(', ')}.</p>}
            {summary.neverChecked.length > 0 && (
              <p className="text-muted-foreground">
                Never checked for an update (flashed before over-the-air updates, or not online since): {summary.neverChecked.join(', ')}.
              </p>
            )}
          </div>
          {state.status === 'ready' && state.data.release !== null && (
            <DeleteButton
              label="Withdraw the published firmware"
              title="Withdraw the published firmware?"
              description="Boards stop being offered this build. Those that installed it keep it."
              error={withdraw.error}
              onConfirm={removeRelease}
              onDismiss={withdraw.clearError}
            />
          )}
        </div>
      )}

      {state.status === 'ready' && state.data.devices.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <Table aria-label="What each Device last reported about itself">
            <TableHeader>
              <TableRow>
                <TableHead>Device</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Sensor</TableHead>
                <TableHead>WiFi signal</TableHead>
                <TableHead>Up for</TableHead>
                <TableHead>Free memory</TableHead>
                <TableHead>Last restart</TableHead>
                <TableHead>Last update check</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.data.devices.map((device) => (
                <TableRow key={device.id}>
                  <TableCell>
                    <span className="font-mono">{device.hostname}</span>
                    <span className="block text-xs text-muted-foreground">
                      {device.campus.name} · {device.closet}
                    </span>
                  </TableCell>
                  <TableCell className="tabular-nums">{device.firmwareVersion ?? '—'}</TableCell>
                  <TableCell>{device.info?.sensor ?? '—'}</TableCell>
                  <TableCell className="tabular-nums">{formatSignal(device.info?.rssi ?? null)}</TableCell>
                  <TableCell className="tabular-nums">{formatUptime(device.info?.uptimeSeconds ?? null)}</TableCell>
                  <TableCell className="tabular-nums">{formatHeap(device.info?.freeHeap ?? null)}</TableCell>
                  <TableCell>{device.info?.resetReason ?? '—'}</TableCell>
                  <TableCell>
                    {device.info?.updateResult ?? '—'}
                    {device.info !== null && (
                      <span className="block text-xs text-muted-foreground">
                        as of {formatAge(Math.max(0, Math.floor((Date.now() - new Date(device.info.at).getTime()) / 1000)))}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <InlineForm onSubmit={submit} aria-label="Publish firmware">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="firmware-file">Signed build</Label>
            <Input
              ref={fileInput}
              id="firmware-file"
              type="file"
              accept=".signed"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              aria-describedby="firmware-file-hint"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="firmware-only">Only these Devices (optional)</Label>
            <Input
              id="firmware-only"
              value={only}
              onChange={(event) => setOnly(event.target.value)}
              placeholder="ESP_A1B2C3, ESP_D4E5F6"
              autoComplete="off"
              spellCheck={false}
              className="font-mono uppercase"
              aria-describedby="firmware-only-hint"
            />
          </div>
        </div>
        <FieldHint id="firmware-file-hint">
          TemperatureAlarms.ino.bin.signed from the build, with FIRMWARE_VERSION raised in version.h. The server refuses an unsigned build or a lower version.
        </FieldHint>
        <p id="firmware-only-hint" className="sr-only">
          Leave empty for every Device. Name one bench board first, then publish the same file again with this empty.
        </p>
        <InlineError message={publish.error} />
        <div>
          <Button type="submit" size="sm" disabled={file === null || publish.pending}>
            <Upload aria-hidden />
            {publish.pending ? 'Publishing…' : 'Publish'}
          </Button>
        </div>
      </InlineForm>

      <StatusLine message={status} />
    </>
  );
}
