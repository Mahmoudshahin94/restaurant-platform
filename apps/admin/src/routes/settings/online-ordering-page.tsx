import { zodResolver } from '@hookform/resolvers/zod';
import { QueryState, tKey, useCurrentLocale } from '@pos/app-kit';
import { formatDateTime } from '@pos/i18n';
import type { OnlineOrderingOverview } from '@pos/validation';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Field,
  Input,
  Label,
  NativeSelect,
  PageHeader,
} from '@pos/ui';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { LocationRequired } from '../../components/location-required';
import { useAdminErrorText } from '../../lib/admin-errors';
import { api } from '../../lib/api';
import { useLocationLookup } from '../../lib/format';
import { moneyField, useMoney } from '../../lib/money';
import { usePermissions } from '../../lib/permissions';
import { keys, useAdminMutation, useRestaurant } from '../../lib/queries';

const STATES = ['OPEN', 'PAUSED', 'CLOSED'] as const;
const DAYS = ['0', '1', '2', '3', '4', '5', '6'] as const;
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'common:validation.invalid');

function onlineForm(currency: string) {
  return z.object({
    state: z.enum(STATES),
    openingHours: z.array(z.object({ day: z.enum(DAYS), open: time, close: time })).max(28),
    acceptMinutes: z.coerce
      .number<string>()
      .int('common:validation.invalid')
      .min(1, 'common:validation.invalid')
      .max(240, 'common:validation.invalid'),
    pickupEnabled: z.boolean(),
    deliveryEnabled: z.boolean(),
    deliveryFee: moneyField(currency),
  });
}
type FormInput = z.input<ReturnType<typeof onlineForm>>;
type FormOutput = z.output<ReturnType<typeof onlineForm>>;

function OnlineForm({ locationId, data }: { locationId: string; data: OnlineOrderingOverview }) {
  const { t } = useTranslation(['admin', 'common']);
  const locale = useCurrentLocale();
  const errorText = useAdminErrorText();
  const { currency, toInput } = useMoney();
  const { canAt } = usePermissions();
  const { timeZone } = useLocationLookup();
  const canManage = canAt(locationId, 'online_ordering.manage');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(onlineForm(currency ?? 'SAR')),
    defaultValues: {
      state: data.state,
      openingHours: data.openingHours.map((w) => ({
        ...w,
        day: String(w.day) as FormInput['openingHours'][number]['day'],
      })),
      acceptMinutes: String(data.acceptMinutes),
      pickupEnabled: data.pickupEnabled,
      deliveryEnabled: data.deliveryEnabled,
      deliveryFee: toInput(data.deliveryFee),
    },
  });
  const hours = useFieldArray({ control: form.control, name: 'openingHours' });
  const save = useAdminMutation(
    (v: FormOutput) =>
      api.onlineOrdering.update(locationId, {
        ...v,
        openingHours: v.openingHours.map((w) => ({ ...w, day: Number(w.day) })),
      }),
    ['online-ordering', 'dashboard'],
  );
  const onSubmit = form.handleSubmit(async (values) => {
    setMessage(null);
    try {
      await save.mutateAsync(values);
      setMessage({ ok: true, text: t('admin:shared.saved') });
    } catch (error) {
      setMessage({ ok: false, text: errorText(error) });
    }
  });
  const errors = form.formState.errors;
  const msg = (m?: string) => (m ? tKey(t, m) : undefined);
  const toggle = (name: 'pickupEnabled' | 'deliveryEnabled', label: string) => (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <div className="flex items-center gap-2">
          <Checkbox
            id={`online-${name}`}
            checked={field.value}
            onCheckedChange={(v) => {
              field.onChange(v === true);
            }}
          />
          <Label htmlFor={`online-${name}`}>{label}</Label>
        </div>
      )}
    />
  );

  return (
    <form className="grid gap-6" noValidate onSubmit={(e) => void onSubmit(e)}>
      <Card>
        <CardHeader>
          <CardTitle>{t('admin:online.customersSee')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3 text-sm">
          <Badge variant={data.status.state === 'OPEN' ? 'success' : 'secondary'}>
            {t(`admin:onlineState.${data.status.state}`)}
          </Badge>
          {data.status.reason ? <span>{t(`admin:onlineReason.${data.status.reason}`)}</span> : null}
          <span className="text-muted-foreground">
            {t('admin:online.hubLastSeen', {
              time: data.hubLastSeenAt
                ? formatDateTime(data.hubLastSeenAt, timeZone(locationId), locale)
                : t('admin:shared.never'),
            })}
          </span>
        </CardContent>
      </Card>
      {message ? <Alert variant={message.ok ? 'info' : 'destructive'}>{message.text}</Alert> : null}
      <fieldset disabled={!canManage} className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('admin:online.state')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Controller
              control={form.control}
              name="state"
              render={({ field }) => (
                <div
                  role="radiogroup"
                  aria-label={t('admin:online.state')}
                  className="flex flex-wrap gap-2"
                >
                  {STATES.map((state) => (
                    <Button
                      key={state}
                      role="radio"
                      aria-checked={field.value === state}
                      variant={field.value === state ? 'default' : 'outline'}
                      onClick={() => {
                        field.onChange(state);
                      }}
                    >
                      {t(`admin:onlineState.${state}`)}
                    </Button>
                  ))}
                </div>
              )}
            />
            <p className="text-xs text-muted-foreground">{t('admin:online.stateHint')}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('admin:online.hours')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <p className="text-xs text-muted-foreground">{t('admin:online.hoursHint')}</p>
            {hours.fields.length === 0 ? (
              <p className="text-sm">{t('admin:online.noHours')}</p>
            ) : null}
            {hours.fields.map((row, index) => (
              <div
                key={row.id}
                className="grid gap-3 rounded-md border p-3 sm:grid-cols-[1fr_9rem_9rem_auto] sm:items-end"
              >
                <Field label={t('admin:online.day')}>
                  <NativeSelect {...form.register(`openingHours.${index}.day`)}>
                    {DAYS.map((d) => (
                      <option key={d} value={d}>
                        {t(`admin:online.days.${d}`)}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field
                  label={t('admin:online.opens')}
                  error={msg(errors.openingHours?.[index]?.open?.message)}
                >
                  <Input type="time" dir="ltr" {...form.register(`openingHours.${index}.open`)} />
                </Field>
                <Field
                  label={t('admin:online.closes')}
                  error={msg(errors.openingHours?.[index]?.close?.message)}
                >
                  <Input type="time" dir="ltr" {...form.register(`openingHours.${index}.close`)} />
                </Field>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('common:actions.remove')}
                  onClick={() => {
                    hours.remove(index);
                  }}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            ))}
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  hours.append({ day: '0', open: '10:00', close: '22:00' });
                }}
              >
                <Plus aria-hidden />
                {t('admin:online.addWindow')}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('admin:online.fulfillment')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="flex flex-wrap gap-6">
              {toggle('pickupEnabled', t('admin:online.pickup'))}
              {toggle('deliveryEnabled', t('admin:online.delivery'))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={`${t('admin:online.deliveryFee')} (${currency ?? ''})`}
                error={msg(errors.deliveryFee?.message)}
              >
                <Input inputMode="decimal" dir="ltr" {...form.register('deliveryFee')} />
              </Field>
              <Field
                label={t('admin:online.acceptMinutes')}
                hint={t('admin:online.acceptMinutesHint')}
                error={msg(errors.acceptMinutes?.message)}
              >
                <Input
                  type="number"
                  inputMode="numeric"
                  dir="ltr"
                  {...form.register('acceptMinutes')}
                />
              </Field>
            </div>
          </CardContent>
        </Card>
      </fieldset>
      {canManage ? (
        <div>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? t('common:states.saving') : t('common:actions.save')}
          </Button>
        </div>
      ) : null}
    </form>
  );
}

function OnlineOrdering({ locationId }: { locationId: string }) {
  const restaurant = useRestaurant();
  const query = useQuery({
    queryKey: keys.onlineOrdering(locationId),
    queryFn: () => api.onlineOrdering.get(locationId),
  });
  // The form shows money in the restaurant's currency: it waits for the restaurant too.
  return (
    <QueryState query={restaurant}>
      {() => (
        <QueryState query={query}>
          {(data) => (
            <OnlineForm
              key={`${locationId}:${JSON.stringify([data.state, data.openingHours, data.deliveryFee])}`}
              locationId={locationId}
              data={data}
            />
          )}
        </QueryState>
      )}
    </QueryState>
  );
}

export function OnlineOrderingPage() {
  const { t } = useTranslation('admin');
  return (
    <>
      <PageHeader title={t('online.title')} description={t('online.description')} />
      <LocationRequired>
        {(locationId) => <OnlineOrdering locationId={locationId} />}
      </LocationRequired>
    </>
  );
}
