import { useRef, useState } from 'react';
import { AlertCircle, Upload, Wifi, WifiOff } from 'lucide-react';
import { getFirmwareStatus, publishFirmware, widenFirmware, withdrawFirmware } from '@/api';
import { ConditionBadge } from '@/components/ConditionBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useChange } from '@/hooks/use-change';
import { useResource } from '@/hooks/use-resource';
import { levelLook } from '@/lib/conditions';
import { cleanProgress, firmwareSummary, holdSentence, rolloutNote } from '@/lib/firmware';
import { formatHeap, formatSignal, formatUptime } from '@/lib/deviceInfo';
import { formatAge } from '@/lib/reportTiming';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { Condition, FirmwareRelease, FirmwareStatus } from '@/types';
import { DeleteButton, FieldHint, InlineError, InlineForm, SectionHeader, StatusLine } from './section';

interface FirmwareSectionProps {
  /** False while no Admin token is stored: the release and the versions need it to be read at all. */
  canEdit: boolean;
  onUnauthorised: () => void;
}

const dateOf = (iso: string): string => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

/** Whole seconds since `iso`, by this browser's clock, as the tables age a report. */
const secondsSince = (iso: string): number => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));

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
  const widen = useChange(onUnauthorised);
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
        ? `Published to ${targets.join(', ')}. Release to all opens once they have run it cleanly; it holds by itself if one of them fails it.`
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

  const releaseToAll = async () => {
    setStatus(null);
    const result = await widen.run(() => widenFirmware());
    if (!result.ok) return;
    setStatus('Released to every Device. Boards on version 3 or later install it within a Report interval; older ones within the hour.');
    await reload();
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

      {state.status === 'ready' && state.data.release !== null && state.data.rollout !== null && (
        <StagedRollout release={state.data.release} rollout={state.data.rollout} pending={widen.pending} error={widen.error} onReleaseToAll={releaseToAll} />
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
                        as of {formatAge(secondsSince(device.info.at))}
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
          Leave empty for every Device. Name one bench board first; Release to all then offers the build to every Device once that board has run it cleanly.
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

/** Online, or the Offline Condition, then any other the server sent (Sensor fault), as a Device card shows them. */
function Health({ conditions }: { conditions: Condition[] | null }) {
  if (conditions === null) return <span className="text-muted-foreground">Not registered</span>;
  const offline = conditions.find((c) => c.name === 'Offline');
  return (
    <div className="flex flex-wrap gap-1.5">
      {offline === undefined ? (
        <Badge className="border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
          <Wifi aria-hidden />
          Online
        </Badge>
      ) : (
        <Badge className={levelLook(offline.level).badge}>
          <WifiOff aria-hidden />
          Offline
        </Badge>
      )}
      {conditions
        .filter((c) => c.name !== 'Offline')
        .map((condition) => (
          <ConditionBadge key={condition.name} condition={condition} className="px-2 py-0.5 text-xs" />
        ))}
    </div>
  );
}

interface StagedRolloutProps {
  release: FirmwareRelease;
  rollout: NonNullable<FirmwareStatus['rollout']>;
  pending: boolean;
  error: string | null;
  onReleaseToAll: () => void;
}

/**
 * A staged release's named Devices (docs/adr/0007): each one's version, last report, health, and
 * clean Readings on the new version, with "Release to all" once every one has run it cleanly. A held
 * release says why and which Device instead, and offers nothing more.
 */
function StagedRollout({ release, rollout, pending, error, onReleaseToAll }: StagedRolloutProps) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1 text-sm">
          <h3 id="rollout-heading" className="font-medium">
            Named Devices first
          </h3>
          {release.hold === null ? (
            <p id="rollout-note" className="max-w-prose text-muted-foreground">
              {rolloutNote(rollout, release.version)}
            </p>
          ) : (
            <p className="flex max-w-prose items-start gap-2 text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                {holdSentence(release.hold, dateOf)} No other Device is offered it. Withdraw it, or publish a fixed build with a higher version.
              </span>
            </p>
          )}
        </div>
        {release.hold === null && (
          <Button type="button" variant="outline" size="sm" disabled={!rollout.ready || pending} aria-describedby="rollout-note" onClick={onReleaseToAll}>
            {pending ? 'Releasing…' : 'Release to all'}
          </Button>
        )}
      </div>
      <InlineError message={error} />
      <div className="overflow-x-auto rounded-lg border">
        <Table aria-labelledby="rollout-heading">
          <TableHeader>
            <TableRow>
              <TableHead>Device</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Last report</TableHead>
              <TableHead>Health</TableHead>
              <TableHead>Clean Readings</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rollout.devices.map((device) => (
              <TableRow key={device.hostname}>
                <TableCell className="font-mono">{device.hostname}</TableCell>
                <TableCell className="tabular-nums">{device.firmwareVersion ?? '—'}</TableCell>
                <TableCell className="tabular-nums">{device.lastReportAt === null ? '—' : formatAge(secondsSince(device.lastReportAt))}</TableCell>
                <TableCell>
                  <Health conditions={device.conditions} />
                </TableCell>
                <TableCell className="tabular-nums">{cleanProgress(device, rollout.cleanReportsToWiden)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
