import { zodResolver } from '@hookform/resolvers/zod';
import {
  QueryState,
  applyServerValidation,
  tKey,
  useCurrentLocale,
  useErrorText,
} from '@pos/app-kit';
import { formatBpsAsPercent, parsePercentToBps } from '@pos/domain';
import { pickLocalized } from '@pos/i18n';
import type { Tax } from '@pos/validation';
import {
  Alert,
  Badge,
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
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { ArchiveAction } from '../../components/archive-action';
import { LocalizedFields } from '../../components/localized-fields';
import { ArchivedBadge } from '../../components/status-badge';
import { api } from '../../lib/api';
import { usePermissions } from '../../lib/permissions';
import { useCatalogMutation, useTenantId, useTaxes } from '../../lib/queries';

const required = 'common:validation.required';
const percentField = z
  .string()
  .trim()
  .transform((v, ctx) => {
    try {
      return parsePercentToBps(v);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'common:validation.invalid' });
      return 0;
    }
  });

const taxForm = z.object({
  nameEn: z.string().trim().min(1, required).max(120, 'common:validation.tooLong'),
  nameAr: z.string().trim().min(1, required).max(120, 'common:validation.tooLong'),
  rate: percentField,
  isDefault: z.boolean(),
});
type TaxFormInput = z.input<typeof taxForm>;
type TaxFormOutput = z.output<typeof taxForm>;

function TaxDialog({ tax, onClose }: { tax: Tax | null; onClose: () => void }) {
  const { t } = useTranslation(['pricing', 'common', 'menu']);
  const tid = useTenantId();
  const errorText = useErrorText();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<TaxFormInput, unknown, TaxFormOutput>({
    resolver: zodResolver(taxForm),
    defaultValues: {
      nameEn: tax?.nameEn ?? '',
      nameAr: tax?.nameAr ?? '',
      rate: tax ? formatBpsAsPercent(tax.rateBps) : '',
      isDefault: tax?.isDefault ?? false,
    },
  });
  const save = useCatalogMutation(({ rate, ...values }: TaxFormOutput) => {
    const body = { ...values, rateBps: rate };
    return tax ? api.menu.taxes.update(tid, tax.id, body) : api.menu.taxes.create(tid, body);
  });
  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await save.mutateAsync(values);
      onClose();
    } catch (error) {
      if (!applyServerValidation(error, form.setError, ['nameEn', 'nameAr']))
        setFormError(errorText(error));
    }
  });
  const rateError = form.formState.errors.rate?.message;

  return (
    <DialogContent closeLabel={t('common:actions.close')}>
      <DialogHeader>
        <DialogTitle>{tax ? t('pricing:taxes.edit') : t('pricing:taxes.new')}</DialogTitle>
      </DialogHeader>
      <form className="grid gap-4" noValidate onSubmit={(e) => void onSubmit(e)}>
        {formError ? <Alert variant="destructive">{formError}</Alert> : null}
        <LocalizedFields register={form.register} errors={form.formState.errors} />
        <Field label={t('pricing:taxes.rate')} error={rateError ? tKey(t, rateError) : undefined}>
          <Input inputMode="decimal" dir="ltr" className="w-32" {...form.register('rate')} />
        </Field>
        <Controller
          control={form.control}
          name="isDefault"
          render={({ field }) => (
            <div className="flex items-center gap-2">
              <Checkbox
                id="tax-default"
                checked={field.value}
                onCheckedChange={(v) => {
                  field.onChange(v === true);
                }}
              />
              <Label htmlFor="tax-default">{t('pricing:taxes.isDefault')}</Label>
            </div>
          )}
        />
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

export function TaxesPage() {
  const { t } = useTranslation(['pricing', 'common', 'menu']);
  const locale = useCurrentLocale();
  const tid = useTenantId();
  const { can } = usePermissions();
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Tax | 'new' | null>(null);
  const query = useTaxes(showArchived);
  const archive = useCatalogMutation((id: string) => api.menu.taxes.archive(tid, id));
  const restore = useCatalogMutation((id: string) => api.menu.taxes.restore(tid, id));
  const canManage = can('settings.manage');

  return (
    <>
      <PageHeader
        title={t('pricing:taxes.title')}
        description={t('pricing:taxes.description')}
        actions={
          canManage ? (
            <Button
              onClick={() => {
                setEditing('new');
              }}
            >
              <Plus aria-hidden />
              {t('pricing:taxes.new')}
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
        empty={{ title: t('pricing:taxes.empty'), description: t('pricing:taxes.emptyHint') }}
      >
        {(rows) => (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('menu:fields.name')}</TableHead>
                  <TableHead className="w-32">{t('pricing:taxes.rate')}</TableHead>
                  <TableHead className="w-28">{t('menu:fields.status')}</TableHead>
                  <TableHead className="w-56 text-end">{t('menu:fields.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      {pickLocalized(row, 'name', locale)}{' '}
                      {row.isDefault ? (
                        <Badge variant="outline">{t('pricing:taxes.default')}</Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="ltr-nums">{formatBpsAsPercent(row.rateBps)}%</TableCell>
                    <TableCell>
                      <ArchivedBadge archivedAt={row.archivedAt} />
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {canManage && !row.archivedAt ? (
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
                          canArchive={canManage}
                          canRestore={canManage}
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
          <TaxDialog
            key={editing === 'new' ? 'new' : editing.id}
            tax={editing === 'new' ? null : editing}
            onClose={() => {
              setEditing(null);
            }}
          />
        ) : null}
      </Dialog>
    </>
  );
}
