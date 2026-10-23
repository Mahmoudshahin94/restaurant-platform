import { zodResolver } from '@hookform/resolvers/zod';
import { QueryState, tKey, useCurrentLocale, useErrorText } from '@pos/app-kit';
import { formatBpsAsPercent, parseDecimalToMinor, parsePercentToBps } from '@pos/domain';
import { pickLocalized } from '@pos/i18n';
import type { DiscountType } from '@pos/shared-types';
import type { Discount } from '@pos/validation';
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
  NativeSelect,
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
import { ArchivedBadge } from '../../components/status-badge';
import { api } from '../../lib/api';
import { useMoney } from '../../lib/money';
import { usePermissions } from '../../lib/permissions';
import { useCatalogMutation, useDiscounts, useTenantId } from '../../lib/queries';

const required = 'common:validation.required';

/** The value field means a percentage or an amount depending on the type. */
function discountForm(currency: string) {
  return z
    .object({
      nameEn: z.string().trim().min(1, required).max(120, 'common:validation.tooLong'),
      nameAr: z.string().trim().min(1, required).max(120, 'common:validation.tooLong'),
      type: z.enum(['PERCENTAGE', 'FIXED']),
      value: z.string().trim().min(1, required),
    })
    .transform((v, ctx) => {
      try {
        const value =
          v.type === 'PERCENTAGE'
            ? parsePercentToBps(v.value)
            : parseDecimalToMinor(v.value, currency);
        if (value <= 0) throw new Error('not positive');
        return { ...v, value };
      } catch {
        ctx.addIssue({ code: 'custom', path: ['value'], message: 'common:validation.invalid' });
        return z.NEVER;
      }
    });
}
type DiscountFormInput = z.input<ReturnType<typeof discountForm>>;
type DiscountFormOutput = z.output<ReturnType<typeof discountForm>>;

function DiscountDialog({
  discount,
  currency,
  onClose,
}: {
  discount: Discount | null;
  currency: string;
  onClose: () => void;
}) {
  const { t } = useTranslation(['pricing', 'common']);
  const tid = useTenantId();
  const errorText = useErrorText();
  const { toInput } = useMoney();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<DiscountFormInput, unknown, DiscountFormOutput>({
    resolver: zodResolver(discountForm(currency)),
    defaultValues: {
      nameEn: discount?.nameEn ?? '',
      nameAr: discount?.nameAr ?? '',
      type: discount?.type ?? 'PERCENTAGE',
      value: discount
        ? discount.type === 'PERCENTAGE'
          ? formatBpsAsPercent(discount.value)
          : toInput(discount.value)
        : '',
    },
  });
  const type = form.watch('type');
  const save = useCatalogMutation((values: DiscountFormOutput) =>
    discount
      ? api.menu.discounts.update(tid, discount.id, values)
      : api.menu.discounts.create(tid, values),
  );
  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await save.mutateAsync(values);
      onClose();
    } catch (error) {
      setFormError(errorText(error));
    }
  });
  const valueError = form.formState.errors.value?.message;

  return (
    <DialogContent closeLabel={t('common:actions.close')}>
      <DialogHeader>
        <DialogTitle>
          {discount ? t('pricing:discounts.edit') : t('pricing:discounts.new')}
        </DialogTitle>
      </DialogHeader>
      <form className="grid gap-4" noValidate onSubmit={(e) => void onSubmit(e)}>
        {formError ? <Alert variant="destructive">{formError}</Alert> : null}
        <LocalizedFields register={form.register} errors={form.formState.errors} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('pricing:discounts.type')}>
            <NativeSelect {...form.register('type')}>
              {(['PERCENTAGE', 'FIXED'] as DiscountType[]).map((value) => (
                <option key={value} value={value}>
                  {t(`pricing:discounts.${value}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field
            label={
              type === 'PERCENTAGE'
                ? `${t('pricing:discounts.value')} (%)`
                : `${t('pricing:discounts.value')} (${currency})`
            }
            hint={
              type === 'PERCENTAGE'
                ? t('pricing:discounts.percentHint')
                : t('pricing:discounts.fixedHint')
            }
            error={valueError ? tKey(t, valueError) : undefined}
          >
            <Input inputMode="decimal" dir="ltr" {...form.register('value')} />
          </Field>
        </div>
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

export function DiscountsPage() {
  const { t } = useTranslation(['pricing', 'common', 'menu']);
  const locale = useCurrentLocale();
  const tid = useTenantId();
  const { can } = usePermissions();
  const { currency, format } = useMoney();
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Discount | 'new' | null>(null);
  const query = useDiscounts(showArchived);
  const archive = useCatalogMutation((id: string) => api.menu.discounts.archive(tid, id));
  const restore = useCatalogMutation((id: string) => api.menu.discounts.restore(tid, id));
  const canManage = can('settings.manage');

  return (
    <>
      <PageHeader
        title={t('pricing:discounts.title')}
        description={t('pricing:discounts.description')}
        actions={
          canManage && currency ? (
            <Button
              onClick={() => {
                setEditing('new');
              }}
            >
              <Plus aria-hidden />
              {t('pricing:discounts.new')}
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
          title: t('pricing:discounts.empty'),
          description: t('pricing:discounts.emptyHint'),
        }}
      >
        {(rows) => (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('menu:fields.name')}</TableHead>
                  <TableHead className="w-40">{t('pricing:discounts.type')}</TableHead>
                  <TableHead className="w-32">{t('pricing:discounts.value')}</TableHead>
                  <TableHead className="w-28">{t('menu:fields.status')}</TableHead>
                  <TableHead className="w-56 text-end">{t('menu:fields.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      {pickLocalized(row, 'name', locale)}
                    </TableCell>
                    <TableCell>{t(`pricing:discounts.${row.type}`)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {row.type === 'PERCENTAGE' ? (
                        <span className="ltr-nums">{formatBpsAsPercent(row.value)}%</span>
                      ) : (
                        format(row.value)
                      )}
                    </TableCell>
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
        {editing !== null && currency ? (
          <DiscountDialog
            key={editing === 'new' ? 'new' : editing.id}
            discount={editing === 'new' ? null : editing}
            currency={currency}
            onClose={() => {
              setEditing(null);
            }}
          />
        ) : null}
      </Dialog>
    </>
  );
}
