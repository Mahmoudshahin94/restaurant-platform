import { zodResolver } from '@hookform/resolvers/zod';
import { QueryState, tKey, useCurrentLocale } from '@pos/app-kit';
import { pickLocalized } from '@pos/i18n';
import { TENDER_TYPE_OF } from '@pos/shared-types';
import type { PaymentMethodAdmin, PaymentProviderAccount } from '@pos/validation';
import {
  Alert,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  NativeSelect,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@pos/ui';
import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { ArchiveAction } from '../../components/archive-action';
import { LocalizedFields } from '../../components/localized-fields';
import { ArchivedBadge } from '../../components/status-badge';
import { useAdminErrorText } from '../../lib/admin-errors';
import { api } from '../../lib/api';
import { usePermissions } from '../../lib/permissions';
import { keys, useAdminMutation, useTenantId } from '../../lib/queries';

const TYPES = ['CASH', 'CARD', 'ONLINE'] as const;
const required = 'common:validation.required';
const methodForm = z.object({
  type: z.enum(TYPES),
  nameEn: z.string().trim().min(1, required).max(120, 'common:validation.tooLong'),
  nameAr: z.string().trim().min(1, required).max(120, 'common:validation.tooLong'),
  sortOrder: z.coerce
    .number<string>()
    .int('common:validation.invalid')
    .min(0, 'common:validation.invalid'),
  /** '' = no account: whichever provider takes the type (ADR 0024). */
  providerAccountId: z.string(),
});
type FormInput = z.input<typeof methodForm>;
type FormOutput = z.output<typeof methodForm>;
const AFFECTS = ['payment-methods', 'payment-providers'];

/** The provider accounts a tender of this type can be linked to (ADR 0024). */
function useLinkableAccounts() {
  const tid = useTenantId();
  const query = useQuery({
    queryKey: keys.paymentProviders(tid),
    queryFn: () => api.admin.paymentProviders.overview(tid),
  });
  return (type: PaymentMethodAdmin['type']): PaymentProviderAccount[] =>
    (query.data?.accounts ?? []).filter((a) => TENDER_TYPE_OF[a.method] === type);
}

function useAccountName() {
  const { t } = useTranslation('admin');
  return (account: PaymentProviderAccount) =>
    `${t(`paymentProviders.providers.${account.providerKey}`, account.providerKey)} · ${t(
      `paymentProviders.methods.${account.method}`,
    )}`;
}

function MethodDialog({
  method,
  onClose,
}: {
  method: PaymentMethodAdmin | null;
  onClose: () => void;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const tid = useTenantId();
  const errorText = useAdminErrorText();
  const [formError, setFormError] = useState<string | null>(null);
  const linkable = useLinkableAccounts();
  const accountName = useAccountName();
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(methodForm),
    defaultValues: {
      type: method?.type ?? 'CARD',
      nameEn: method?.nameEn ?? '',
      nameAr: method?.nameAr ?? '',
      sortOrder: String(method?.sortOrder ?? 0),
      providerAccountId: method?.providerAccountId ?? '',
    },
  });
  const type = form.watch('type');
  const save = useAdminMutation(({ type, providerAccountId, ...values }: FormOutput) => {
    const link = { ...values, providerAccountId: providerAccountId || null };
    return method
      ? api.admin.paymentMethods.update(tid, method.id, link)
      : api.admin.paymentMethods.create(tid, { type, ...link });
  }, AFFECTS);
  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await save.mutateAsync(values);
      onClose();
    } catch (error) {
      setFormError(errorText(error));
    }
  });
  const sortError = form.formState.errors.sortOrder?.message;
  return (
    <DialogContent closeLabel={t('common:actions.close')}>
      <DialogHeader>
        <DialogTitle>
          {method ? t('admin:paymentMethods.edit') : t('admin:paymentMethods.new')}
        </DialogTitle>
      </DialogHeader>
      <form className="grid gap-4" noValidate onSubmit={(e) => void onSubmit(e)}>
        {formError ? <Alert variant="destructive">{formError}</Alert> : null}
        <Field label={t('admin:paymentMethods.type')} hint={t('admin:paymentMethods.typeHint')}>
          <NativeSelect disabled={method !== null} {...form.register('type')}>
            {TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`admin:paymentMethods.types.${type}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <LocalizedFields register={form.register} errors={form.formState.errors} />
        <Field
          label={t('admin:paymentMethods.providerAccount')}
          hint={t('admin:paymentMethods.providerAccountHint')}
        >
          <NativeSelect {...form.register('providerAccountId')}>
            <option value="">{t('admin:paymentMethods.anyProvider')}</option>
            {linkable(type).map((account) => (
              <option key={account.id} value={account.id}>
                {accountName(account)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field
          label={t('admin:paymentMethods.sortOrder')}
          error={sortError ? tKey(t, sortError) : undefined}
        >
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

export function PaymentMethodsPage() {
  const { t } = useTranslation(['admin', 'common', 'menu']);
  const locale = useCurrentLocale();
  const tid = useTenantId();
  const errorText = useAdminErrorText();
  const { can } = usePermissions();
  const canManage = can('settings.manage');
  const [editing, setEditing] = useState<PaymentMethodAdmin | 'new' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: keys.paymentMethods(tid),
    queryFn: () => api.admin.paymentMethods.list(tid),
  });
  const archive = useAdminMutation(
    (id: string) => api.admin.paymentMethods.archive(tid, id),
    AFFECTS,
  );
  const restore = useAdminMutation(
    (id: string) => api.admin.paymentMethods.restore(tid, id),
    AFFECTS,
  );
  const guarded = (fn: () => Promise<unknown>) => () =>
    fn().catch((error: unknown) => {
      setActionError(errorText(error));
    });

  return (
    <>
      <PageHeader
        title={t('admin:paymentMethods.title')}
        description={t('admin:paymentMethods.description')}
        actions={
          canManage ? (
            <Button
              onClick={() => {
                setEditing('new');
              }}
            >
              <Plus aria-hidden />
              {t('admin:paymentMethods.new')}
            </Button>
          ) : null
        }
      />
      {actionError ? (
        <Alert variant="destructive" className="mb-4">
          {actionError}
        </Alert>
      ) : null}
      <QueryState
        query={query}
        isEmpty={(rows) => rows.length === 0}
        empty={{ title: t('admin:paymentMethods.empty') }}
      >
        {(rows) => (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('menu:fields.name')}</TableHead>
                  <TableHead>{t('admin:paymentMethods.type')}</TableHead>
                  <TableHead>{t('admin:paymentMethods.sortOrder')}</TableHead>
                  <TableHead>{t('admin:shared.status')}</TableHead>
                  <TableHead className="text-end">{t('admin:shared.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      {pickLocalized(row, 'name', locale)}
                    </TableCell>
                    <TableCell>{t(`admin:paymentMethods.types.${row.type}`)}</TableCell>
                    <TableCell className="ltr-nums">{row.sortOrder}</TableCell>
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
                          onArchive={guarded(() => archive.mutateAsync(row.id))}
                          onRestore={guarded(() => restore.mutateAsync(row.id))}
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
          <MethodDialog
            key={editing === 'new' ? 'new' : editing.id}
            method={editing === 'new' ? null : editing}
            onClose={() => {
              setEditing(null);
            }}
          />
        ) : null}
      </Dialog>
    </>
  );
}
