import { zodResolver } from '@hookform/resolvers/zod';
import { QueryState, tKey, useCurrentLocale, useErrorText } from '@pos/app-kit';
import { pickLocalized } from '@pos/i18n';
import type { TableSection } from '@pos/validation';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  Input,
  NativeSelect,
  PageHeader,
} from '@pos/ui';
import { Archive, Plus, Users } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { LocalizedFields } from '../../components/localized-fields';
import { api } from '../../lib/api';
import { usePermissions } from '../../lib/permissions';
import { useCatalogMutation, useFloor } from '../../lib/queries';
import { usePreferences } from '../../stores/preferences';

const required = 'common:validation.required';
const sectionForm = z.object({
  nameEn: z.string().trim().min(1, required).max(120, 'common:validation.tooLong'),
  nameAr: z.string().trim().min(1, required).max(120, 'common:validation.tooLong'),
});
const tableForm = z.object({
  sectionId: z.string().min(1, required),
  label: z.string().trim().min(1, required).max(12, 'common:validation.tooLong'),
  seats: z.coerce
    .number<string>()
    .int('common:validation.invalid')
    .min(1, 'common:validation.invalid')
    .max(100, 'common:validation.invalid'),
});

function SectionDialog({ locationId, onClose }: { locationId: string; onClose: () => void }) {
  const { t } = useTranslation(['floor', 'common']);
  const errorText = useErrorText();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.input<typeof sectionForm>, unknown, z.output<typeof sectionForm>>({
    resolver: zodResolver(sectionForm),
    defaultValues: { nameEn: '', nameAr: '' },
  });
  const save = useCatalogMutation((values: z.output<typeof sectionForm>) =>
    api.floor.createSection(locationId, values),
  );
  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await save.mutateAsync(values);
      onClose();
    } catch (e) {
      setError(errorText(e));
    }
  });
  return (
    <DialogContent closeLabel={t('common:actions.close')}>
      <DialogHeader>
        <DialogTitle>{t('floor:newSection')}</DialogTitle>
      </DialogHeader>
      <form className="grid gap-4" noValidate onSubmit={(e) => void onSubmit(e)}>
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        <LocalizedFields register={form.register} errors={form.formState.errors} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {t('common:actions.save')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function TableDialog({
  locationId,
  sections,
  defaultSectionId,
  onClose,
}: {
  locationId: string;
  sections: TableSection[];
  defaultSectionId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation(['floor', 'common']);
  const locale = useCurrentLocale();
  const errorText = useErrorText();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.input<typeof tableForm>, unknown, z.output<typeof tableForm>>({
    resolver: zodResolver(tableForm),
    defaultValues: { sectionId: defaultSectionId, label: '', seats: '4' },
  });
  const save = useCatalogMutation((values: z.output<typeof tableForm>) =>
    api.floor.createTable(locationId, values),
  );
  const errors = form.formState.errors;
  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await save.mutateAsync(values);
      onClose();
    } catch (e) {
      setError(errorText(e));
    }
  });
  return (
    <DialogContent closeLabel={t('common:actions.close')}>
      <DialogHeader>
        <DialogTitle>{t('floor:newTable')}</DialogTitle>
      </DialogHeader>
      <form className="grid gap-4" noValidate onSubmit={(e) => void onSubmit(e)}>
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        <Field label={t('floor:section')}>
          <NativeSelect {...form.register('sectionId')}>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {pickLocalized(s, 'name', locale)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('floor:label')}
            hint={t('floor:labelHint')}
            error={errors.label?.message ? tKey(t, errors.label.message) : undefined}
          >
            <Input dir="ltr" autoComplete="off" {...form.register('label')} />
          </Field>
          <Field
            label={t('floor:seats')}
            error={errors.seats?.message ? tKey(t, errors.seats.message) : undefined}
          >
            <Input
              type="number"
              inputMode="numeric"
              dir="ltr"
              min={1}
              {...form.register('seats')}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {t('common:actions.save')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

export function TablesPage() {
  const { t } = useTranslation(['floor', 'common']);
  const locale = useCurrentLocale();
  const locationId = usePreferences((s) => s.locationId);
  const { canAt } = usePermissions();
  const floor = useFloor(locationId);
  const [dialog, setDialog] = useState<'section' | { sectionId: string } | null>(null);
  const archiveTable = useCatalogMutation((tableId: string) =>
    api.floor.archiveTable(locationId ?? '', tableId),
  );

  if (!locationId) {
    return (
      <>
        <PageHeader title={t('floor:title')} />
        <EmptyState title={t('floor:noLocation')} />
      </>
    );
  }
  const canManage = canAt(locationId, 'tables.manage');

  return (
    <>
      <PageHeader
        title={t('floor:title')}
        description={t('floor:description')}
        actions={
          canManage ? (
            <Button
              onClick={() => {
                setDialog('section');
              }}
            >
              <Plus aria-hidden />
              {t('floor:newSection')}
            </Button>
          ) : null
        }
      />
      <QueryState
        query={floor}
        isEmpty={(sections) => sections.length === 0}
        empty={{ title: t('floor:empty'), description: t('floor:emptyHint') }}
      >
        {(sections) => (
          <div className="grid gap-6">
            {sections.map((section) => (
              <Card key={section.id}>
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle>{pickLocalized(section, 'name', locale)}</CardTitle>
                  {canManage ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setDialog({ sectionId: section.id });
                      }}
                    >
                      <Plus aria-hidden />
                      {t('floor:newTable')}
                    </Button>
                  ) : null}
                </CardHeader>
                <CardContent>
                  <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                    {section.tables.map((table) => {
                      const occupied = table.openOrders.length > 0;
                      return (
                        <li key={table.id} className="grid gap-2 rounded-lg border p-3">
                          <div className="flex items-center justify-between">
                            <span className="ltr-nums text-lg font-semibold">{table.label}</span>
                            {canManage && !occupied ? (
                              <Button
                                variant="ghost"
                                size="icon-md"
                                aria-label={t('common:actions.archive')}
                                onClick={() => void archiveTable.mutateAsync(table.id)}
                              >
                                <Archive aria-hidden />
                              </Button>
                            ) : null}
                          </div>
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Users aria-hidden className="size-3" />
                            {t('floor:seatsCount', { count: table.seats })}
                          </span>
                          <Badge variant={occupied ? 'warning' : 'success'}>
                            {occupied ? t('floor:occupied') : t('floor:free')}
                          </Badge>
                        </li>
                      );
                    })}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </QueryState>
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        {dialog === 'section' ? (
          <SectionDialog
            locationId={locationId}
            onClose={() => {
              setDialog(null);
            }}
          />
        ) : null}
        {dialog !== null && dialog !== 'section' && floor.data ? (
          <TableDialog
            locationId={locationId}
            sections={floor.data}
            defaultSectionId={dialog.sectionId}
            onClose={() => {
              setDialog(null);
            }}
          />
        ) : null}
      </Dialog>
    </>
  );
}
