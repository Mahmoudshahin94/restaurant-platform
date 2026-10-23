import { zodResolver } from '@hookform/resolvers/zod';
import { QueryState, applyServerValidation, tKey } from '@pos/app-kit';
import type { Tenant } from '@pos/validation';
import { Alert, Button, Card, CardContent, Field, Input, NativeSelect, PageHeader } from '@pos/ui';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { LocalizedFields } from '../../components/localized-fields';
import { useAdminErrorText } from '../../lib/admin-errors';
import { api } from '../../lib/api';
import { usePermissions } from '../../lib/permissions';
import { useAdminMutation, useTenant } from '../../lib/queries';

const required = 'common:validation.required';
const tenantForm = z.object({
  nameEn: z.string().trim().min(1, required).max(120, 'common:validation.tooLong'),
  nameAr: z.string().trim().min(1, required).max(120, 'common:validation.tooLong'),
  legalName: z.string().trim().max(200, 'common:validation.tooLong'),
  defaultLocale: z.enum(['en', 'ar']),
  timezone: z.string().trim().min(1, required),
});
type FormValues = z.infer<typeof tenantForm>;

function TenantForm({ tenant }: { tenant: Tenant }) {
  const { t } = useTranslation(['admin', 'common']);
  const errorText = useAdminErrorText();
  const { can } = usePermissions();
  const canManage = can('settings.manage');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(tenantForm),
    defaultValues: {
      nameEn: tenant.nameEn,
      nameAr: tenant.nameAr,
      legalName: tenant.legalName ?? '',
      defaultLocale: tenant.defaultLocale,
      timezone: tenant.timezone,
    },
  });
  const save = useAdminMutation(
    ({ legalName, ...values }: FormValues) =>
      api.tenants.update(tenant.id, { ...values, legalName: legalName === '' ? null : legalName }),
    ['tenant'],
  );
  const onSubmit = form.handleSubmit(async (values) => {
    setMessage(null);
    try {
      await save.mutateAsync(values);
      setMessage({ ok: true, text: t('admin:shared.saved') });
    } catch (error) {
      if (
        !applyServerValidation(error, form.setError, ['timezone', 'nameEn', 'nameAr', 'legalName'])
      ) {
        setMessage({ ok: false, text: errorText(error) });
      }
    }
  });
  const tzError = form.formState.errors.timezone?.message;
  const legalNameError = form.formState.errors.legalName?.message;
  return (
    <Card>
      <CardContent className="pt-6">
        <form className="grid max-w-2xl gap-4" noValidate onSubmit={(e) => void onSubmit(e)}>
          {message ? (
            <Alert variant={message.ok ? 'info' : 'destructive'}>{message.text}</Alert>
          ) : null}
          <fieldset disabled={!canManage} className="grid gap-4">
            <LocalizedFields register={form.register} errors={form.formState.errors} />
            <Field
              label={t('admin:tenant.legalName')}
              hint={t('admin:tenant.legalNameHint')}
              error={legalNameError ? tKey(t, legalNameError) : undefined}
            >
              <Input autoComplete="organization" {...form.register('legalName')} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('admin:tenant.defaultLocale')}>
                <NativeSelect {...form.register('defaultLocale')}>
                  <option value="en">{t('common:language.en')}</option>
                  <option value="ar">{t('common:language.ar')}</option>
                </NativeSelect>
              </Field>
              <Field
                label={t('admin:tenant.timezone')}
                hint={t('admin:tenant.timezoneHint')}
                error={tzError ? tKey(t, tzError) : undefined}
              >
                <Input dir="ltr" autoComplete="off" {...form.register('timezone')} />
              </Field>
              <Field label={t('admin:tenant.currency')} hint={t('admin:tenant.currencyHint')}>
                <Input dir="ltr" value={tenant.currencyCode} readOnly />
              </Field>
              <Field label={t('admin:tenant.slug')}>
                <Input dir="ltr" value={tenant.slug} readOnly />
              </Field>
              <Field
                label={t('admin:tenant.businessType')}
                hint={t('admin:tenant.businessTypeHint')}
              >
                <Input value={t(`admin:tenant.businessTypes.${tenant.businessType}`)} readOnly />
              </Field>
            </div>
          </fieldset>
          {canManage ? (
            <div>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? t('common:states.saving') : t('common:actions.save')}
              </Button>
            </div>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}

export function TenantPage() {
  const { t } = useTranslation('admin');
  const tenant = useTenant();
  return (
    <>
      <PageHeader title={t('tenant.title')} description={t('tenant.description')} />
      <QueryState query={tenant}>
        {(data) => <TenantForm key={data.updatedAt} tenant={data} />}
      </QueryState>
    </>
  );
}
