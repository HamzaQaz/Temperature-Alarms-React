import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { addCampus, deleteCampus, getCampuses } from '@/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AnimatePresence } from 'framer-motion';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useChange } from '@/hooks/use-change';
import { useResource } from '@/hooks/use-resource';
import { AnimatedRow, DeleteButton, EmptyRow, ErrorRow, FieldHint, InlineError, InlineForm, SectionHeader, SkeletonRows, StatusLine, WrappingCell } from './section';

interface CampusesSectionProps {
  /** False while no Admin token is stored; changes are disabled and the token panel explains why. */
  canEdit: boolean;
  onUnauthorised: () => void;
}

const COLUMNS = 3;
const NAME_MAX = 100;
const SHORTCODE_MAX = 20;

export function CampusesSection({ canEdit, onUnauthorised }: CampusesSectionProps) {
  const { state, reload } = useResource(getCampuses);
  const add = useChange(onUnauthorised);
  const remove = useChange(onUnauthorised);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [shortcode, setShortcode] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);

  const nameMissing = name.trim() === '';
  const shortcodeMissing = shortcode.trim() === '';

  const closeForm = () => {
    setFormOpen(false);
    setName('');
    setShortcode('');
    setSubmitted(false);
    add.clearError();
  };

  const openForm = () => {
    setStatus(null);
    setFormOpen(true);
  };

  // A campus is added once in a long while, so the form closes on success and focus goes
  // back to the button it came from, with the outcome said once beside it.
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (nameMissing || shortcodeMissing) return;
    const campusName = name.trim();
    const result = await add.run(() => addCampus(campusName, shortcode.trim()));
    if (!result.ok) return;
    closeForm();
    setStatus(`${campusName} added.`);
    await reload();
    addButton.current?.focus();
  };

  const removeCampus = async (id: number, campusName: string) => {
    const result = await remove.run(() => deleteCampus(id));
    if (result.ok) {
      setStatus(`${campusName} deleted.`);
      await reload();
      // The row that held the trash button is gone; land somewhere sensible rather than on body.
      addButton.current?.focus();
    }
    return result;
  };

  return (
    <section className="space-y-4" aria-labelledby="campuses-heading">
      <SectionHeader
        id="campuses-heading"
        title="Campuses"
        description="Every Device belongs to one Campus. The shortcode is what the dashboard filters by."
        action={
          <Button ref={addButton} size="sm" variant="outline" onClick={openForm} disabled={!canEdit || formOpen}>
            <Plus aria-hidden />
            Add campus
          </Button>
        }
      />

      {formOpen && (
        <InlineForm onSubmit={submit} aria-label="Add a campus">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
            <div className="space-y-2">
              <Label htmlFor="campus-name">Name</Label>
              <Input
                id="campus-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Central High School"
                maxLength={NAME_MAX}
                autoFocus
                aria-invalid={(submitted && nameMissing) || undefined}
                aria-describedby={submitted && nameMissing ? 'campus-name-error' : undefined}
              />
              {submitted && nameMissing && <InlineError id="campus-name-error" message="Give the campus a name." />}
            </div>
            <div className="space-y-2">
              <Label htmlFor="campus-shortcode">Shortcode</Label>
              <Input
                id="campus-shortcode"
                value={shortcode}
                onChange={(event) => setShortcode(event.target.value.toUpperCase())}
                placeholder="CHS"
                maxLength={SHORTCODE_MAX}
                className="uppercase"
                aria-invalid={(submitted && shortcodeMissing) || undefined}
                aria-describedby={submitted && shortcodeMissing ? 'campus-shortcode-error campus-shortcode-hint' : 'campus-shortcode-hint'}
              />
              {submitted && shortcodeMissing && <InlineError id="campus-shortcode-error" message="Give the campus a shortcode." />}
            </div>
          </div>
          <FieldHint id="campus-shortcode-hint">Shortcodes are stored in upper case and must be unique.</FieldHint>
          <InlineError message={add.error} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={add.pending || !canEdit}>
              {add.pending ? 'Saving…' : 'Save campus'}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={closeForm} disabled={add.pending}>
              Cancel
            </Button>
          </div>
        </InlineForm>
      )}

      <StatusLine message={status} />

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="w-32">Shortcode</TableHead>
              <TableHead className="w-14">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.status === 'loading' && <SkeletonRows columns={COLUMNS} />}
            {state.status === 'error' && <ErrorRow colSpan={COLUMNS} message={`Could not load campuses. ${state.message}`} onRetry={reload} />}
            {state.status === 'ready' && state.data.length === 0 && (
              <EmptyRow
                colSpan={COLUMNS}
                title="No campuses yet"
                hint="Add the first campus, then Devices can be assigned to it."
              />
            )}
            <AnimatePresence initial={false}>
              {state.status === 'ready' &&
                state.data.map((campus) => (
                  <AnimatedRow key={campus.id}>
                  <WrappingCell className="font-medium">{campus.name}</WrappingCell>
                  <TableCell className="text-muted-foreground">{campus.shortcode}</TableCell>
                  <TableCell className="text-right">
                    <DeleteButton
                      label={`Delete ${campus.name}`}
                      title={`Delete ${campus.name}?`}
                      description={`The ${campus.shortcode} filter disappears from the dashboard. A campus that still has Devices cannot be deleted.`}
                      disabled={!canEdit}
                      error={remove.error}
                      onConfirm={() => removeCampus(campus.id, campus.name)}
                      onDismiss={remove.clearError}
                    />
                  </TableCell>
                  </AnimatedRow>
                ))}
            </AnimatePresence>
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
