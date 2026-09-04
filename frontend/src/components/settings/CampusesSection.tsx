import { useState } from 'react';
import { Plus } from 'lucide-react';
import { addCampus, deleteCampus, getCampuses } from '@/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useChange } from '@/hooks/use-change';
import { useResource } from '@/hooks/use-resource';
import { DeleteButton, EmptyRow, ErrorRow, InlineError, InlineForm, SectionHeader, SkeletonRows } from './section';

interface CampusesSectionProps {
  /** False while no Admin token is stored; changes are disabled and the token panel explains why. */
  canEdit: boolean;
  onUnauthorised: () => void;
}

const COLUMNS = 3;

export function CampusesSection({ canEdit, onUnauthorised }: CampusesSectionProps) {
  const { state, reload } = useResource(getCampuses);
  const add = useChange(onUnauthorised);
  const remove = useChange(onUnauthorised);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [shortcode, setShortcode] = useState('');

  const closeForm = () => {
    setFormOpen(false);
    setName('');
    setShortcode('');
    add.clearError();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (await add.run(() => addCampus(name.trim(), shortcode.trim()))) {
      closeForm();
      await reload();
    }
  };

  return (
    <section className="space-y-4" aria-labelledby="campuses-heading">
      <SectionHeader
        id="campuses-heading"
        title="Campuses"
        description="Every Device belongs to one Campus. The shortcode is what the dashboard filters by."
        action={
          <Button size="sm" onClick={() => setFormOpen(true)} disabled={!canEdit || formOpen}>
            <Plus aria-hidden />
            Add campus
          </Button>
        }
      />

      {formOpen && (
        <InlineForm onSubmit={submit}>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
            <div className="space-y-2">
              <Label htmlFor="campus-name">Name</Label>
              <Input
                id="campus-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Central High School"
                maxLength={100}
                autoFocus
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="campus-shortcode">Shortcode</Label>
              <Input
                id="campus-shortcode"
                value={shortcode}
                onChange={(event) => setShortcode(event.target.value.toUpperCase())}
                placeholder="CHS"
                maxLength={20}
                className="font-mono uppercase"
                aria-describedby="campus-shortcode-hint"
                required
              />
            </div>
          </div>
          <p id="campus-shortcode-hint" className="text-xs text-muted-foreground">
            Shortcodes are stored in upper case and must be unique.
          </p>
          <InlineError message={add.error} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={add.pending || !canEdit || name.trim() === '' || shortcode.trim() === ''}>
              {add.pending ? 'Saving…' : 'Save campus'}
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
            {state.status === 'ready' &&
              state.data.map((campus) => (
                <TableRow key={campus.id}>
                  <TableCell className="font-medium">{campus.name}</TableCell>
                  <TableCell className="font-mono text-muted-foreground">{campus.shortcode}</TableCell>
                  <TableCell className="text-right">
                    <DeleteButton
                      label={`Delete ${campus.name}`}
                      title={`Delete ${campus.name}?`}
                      description={`The ${campus.shortcode} filter disappears from the dashboard. A campus that still has Devices cannot be deleted.`}
                      disabled={!canEdit}
                      onConfirm={async () => {
                        if (await remove.run(() => deleteCampus(campus.id))) await reload();
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
