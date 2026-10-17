import { zodResolver } from '@hookform/resolvers/zod';
import { QueryState, applyServerValidation, tKey } from '@pos/app-kit';
import type { Restaurant } from '@pos/validation';
import { Alert, Button, Card, CardContent, Field, Input, NativeSelect, PageHeader } from '@pos/ui';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { LocalizedFields } from '../../components/localized-fields';
import { useAdminErrorText } from '../../lib/admin-errors';
import { api } from '../../lib/api';
import { usePermissions } from '../../lib/permissions';
import { useAdminMutation, useRestaurant } from '../../lib/queries';

const required = 'common:validation.required';
const restaurantForm = z.object({
  nameEn: z.string().trim().min(1, required).max(120, 'common:validation.tooLong'),
  nameAr: z.string().trim().min(1, required).max(120, 'common:validation.tooLong'),
  defaultLocale: z.enum(['en', 'ar']),
  timezone: z.string().trim().min(1, required),
});
type FormValues = z.infer<typeof restaurantForm>;

function RestaurantForm({ restaurant }: { restaurant: Restaurant }) {
  const { t } = useTranslation(['admin', 'common']);
  const errorText = useAdminErrorText();
  const { can } = usePermissions();
  const canManage = can('settings.manage');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(restaurantForm),
    defaultValues: {
      nameEn: restaurant.nameEn,
      nameAr: restaurant.nameAr,
      defaultLocale: restaurant.defaultLocale,
      timezone: restaurant.timezone,
    },
  });
  const save = useAdminMutation(
    (values: FormValues) => api.restaurants.update(restaurant.id, values),
    ['restaurant'],
  );
  const onSubmit = form.handleSubmit(async (values) => {
    setMessage(null);
    try {
      await save.mutateAsync(values);
      setMessage({ ok: true, text: t('admin:shared.saved') });
    } catch (error) {
      if (!applyServerValidation(error, form.setError, ['timezone', 'nameEn', 'nameAr'])) {
        setMessage({ ok: false, text: errorText(error) });
      }
    }
  });
  const tzError = form.formState.errors.timezone?.message;
  return (
    <Card>
      <CardContent className="pt-6">
        <form className="grid max-w-2xl gap-4" noValidate onSubmit={(e) => void onSubmit(e)}>
          {message ? (
            <Alert variant={message.ok ? 'info' : 'destructive'}>{message.text}</Alert>
          ) : null}
          <fieldset disabled={!canManage} className="grid gap-4">
            <LocalizedFields register={form.register} errors={form.formState.errors} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('admin:restaurant.defaultLocale')}>
                <NativeSelect {...form.register('defaultLocale')}>
                  <option value="en">{t('common:language.en')}</option>
                  <option value="ar">{t('common:language.ar')}</option>
                </NativeSelect>
              </Field>
              <Field
                label={t('admin:restaurant.timezone')}
                hint={t('admin:restaurant.timezoneHint')}
                error={tzError ? tKey(t, tzError) : undefined}
              >
                <Input dir="ltr" autoComplete="off" {...form.register('timezone')} />
              </Field>
              <Field
                label={t('admin:restaurant.currency')}
                hint={t('admin:restaurant.currencyHint')}
              >
                <Input dir="ltr" value={restaurant.currencyCode} readOnly />
              </Field>
              <Field label={t('admin:restaurant.slug')}>
                <Input dir="ltr" value={restaurant.slug} readOnly />
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

export function RestaurantPage() {
  const { t } = useTranslation('admin');
  const restaurant = useRestaurant();
  return (
    <>
      <PageHeader title={t('restaurant.title')} description={t('restaurant.description')} />
      <QueryState query={restaurant}>
        {(data) => <RestaurantForm key={data.updatedAt} restaurant={data} />}
      </QueryState>
    </>
  );
}
