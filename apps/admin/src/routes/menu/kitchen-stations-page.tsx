import { zodResolver } from '@hookform/resolvers/zod';
import { pickLocalized } from '@pos/i18n';
import type { KitchenStation } from '@pos/validation';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Label,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@pos/ui';
import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { ArchiveAction } from '../../components/archive-action';
import { LocalizedFields } from '../../components/localized-fields';
import { QueryState } from '@pos/app-kit';
import { ArchivedBadge } from '../../components/status-badge';
import { api } from '../../lib/api';
import { applyServerValidation, tKey, useErrorText } from '@pos/app-kit';
import { useCurrentLocale } from '@pos/app-kit';
import { usePermissions } from '../../lib/permissions';
import { useCatalogMutation, useKitchenStations, useRestaurantId } from '../../lib/queries';

const required = 'common:validation.required';
const stationForm = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{2,20}$/, 'common:validation.invalid'),
  nameEn: z.string().trim().min(1, required).max(120, 'common:validation.tooLong'),
  nameAr: z.string().trim().min(1, required).max(120, 'common:validation.tooLong'),
  sortOrder: z.coerce
    .number<string>()
    .int('common:validation.invalid')
    .min(0, 'common:validation.invalid'),
});
type StationFormInput = z.input<typeof stationForm>;
type StationFormOutput = z.output<typeof stationForm>;

function StationDialog({
  station,
  onClose,
}: {
  station: KitchenStation | null;
  onClose: () => void;
}) {
  const { t } = useTranslation(['menu', 'common']);
  const rid = useRestaurantId();
  const errorText = useErrorText();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<StationFormInput, unknown, StationFormOutput>({
    resolver: zodResolver(stationForm),
    defaultValues: {
      code: station?.code ?? '',
      nameEn: station?.nameEn ?? '',
      nameAr: station?.nameAr ?? '',
      sortOrder: String(station?.sortOrder ?? 0),
    },
  });
  const save = useCatalogMutation((values: StationFormOutput) =>
    station
      ? api.menu.kitchenStations.update(rid, station.id, values)
      : api.menu.kitchenStations.create(rid, values),
  );
  const errors = form.formState.errors;
  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await save.mutateAsync(values);
      onClose();
    } catch (error) {
      if (!applyServerValidation(error, form.setError, ['code', 'nameEn', 'nameAr']))
        setFormError(errorText(error));
    }
  });

  return (
    <DialogContent closeLabel={t('common:actions.close')}>
      <DialogHeader>
        <DialogTitle>
          {station ? t('menu:kitchenStations.edit') : t('menu:kitchenStations.new')}
        </DialogTitle>
      </DialogHeader>
      <form className="grid gap-4" noValidate onSubmit={(e) => void onSubmit(e)}>
        {formError ? <Alert variant="destructive">{formError}</Alert> : null}
        <Field
          label={t('menu:kitchenStations.code')}
          hint={t('menu:kitchenStations.codeHint')}
          error={errors.code?.message ? tKey(t, errors.code.message) : undefined}
        >
          <Input
            dir="ltr"
            className="w-48 uppercase"
            autoComplete="off"
            {...form.register('code')}
          />
        </Field>
        <LocalizedFields register={form.register} errors={errors} />
        <Field label={t('menu:fields.sortOrder')} hint={t('menu:fields.sortOrderHint')}>
          <Input
            type="number"
            inputMode="numeric"
            dir="ltr"
            className="w-32"
            {...form.register('sortOrder')}
          />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? t('common:states.saving') : t('common:actions.save')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

export function KitchenStationsPage() {
  const { t } = useTranslation(['menu', 'common']);
  const locale = useCurrentLocale();
  const rid = useRestaurantId();
  const { can } = usePermissions();
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<KitchenStation | 'new' | null>(null);
  const query = useKitchenStations(showArchived);
  const archive = useCatalogMutation((id: string) => api.menu.kitchenStations.archive(rid, id));
  const restore = useCatalogMutation((id: string) => api.menu.kitchenStations.restore(rid, id));

  return (
    <>
      <PageHeader
        title={t('menu:kitchenStations.title')}
        description={t('menu:kitchenStations.description')}
        actions={
          can('products.create') ? (
            <Button
              onClick={() => {
                setEditing('new');
              }}
            >
              <Plus aria-hidden />
              {t('menu:kitchenStations.new')}
            </Button>
          ) : null
        }
      />
      <div className="mb-4 flex items-center gap-2">
        <Checkbox
          id="show-archived"
          checked={showArchived}
          onCheckedChange={(v) => {
            setShowArchived(v === true);
          }}
        />
        <Label htmlFor="show-archived">{t('menu:showArchived')}</Label>
      </div>
      <QueryState
        query={query}
        isEmpty={(rows) => rows.length === 0}
        empty={{
          title: t('menu:kitchenStations.empty'),
          description: t('menu:kitchenStations.emptyHint'),
        }}
      >
        {(rows) => (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-36">{t('menu:kitchenStations.code')}</TableHead>
                  <TableHead>{t('menu:fields.name')}</TableHead>
                  <TableHead className="w-28">{t('menu:fields.status')}</TableHead>
                  <TableHead className="w-56 text-end">{t('menu:fields.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="ltr-nums font-mono text-xs">{row.code}</TableCell>
                    <TableCell className="font-medium">
                      {pickLocalized(row, 'name', locale)}
                    </TableCell>
                    <TableCell>
                      <ArchivedBadge archivedAt={row.archivedAt} />
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {can('products.update') && !row.archivedAt ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditing(row);
                            }}
                          >
                            <Pencil aria-hidden />
                            {t('common:actions.edit')}
                          </Button>
                        ) : null}
                        <ArchiveAction
                          name={pickLocalized(row, 'name', locale)}
                          archived={row.archivedAt !== null}
                          canArchive={can('products.delete')}
                          canRestore={can('products.update')}
                          pending={archive.isPending || restore.isPending}
                          onArchive={() => archive.mutateAsync(row.id)}
                          onRestore={() => restore.mutateAsync(row.id)}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </QueryState>
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        {editing !== null ? (
          <StationDialog
            key={editing === 'new' ? 'new' : editing.id}
            station={editing === 'new' ? null : editing}
            onClose={() => {
              setEditing(null);
            }}
          />
        ) : null}
      </Dialog>
    </>
  );
}
