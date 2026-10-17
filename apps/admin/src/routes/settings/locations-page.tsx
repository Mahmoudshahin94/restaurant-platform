import { zodResolver } from '@hookform/resolvers/zod';
import { QueryState, applyServerValidation, tKey, useCurrentLocale } from '@pos/app-kit';
import { pickLocalized } from '@pos/i18n';
import type { Location } from '@pos/validation';
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
import { LocalizedFields } from '../../components/localized-fields';
import { useAdminErrorText } from '../../lib/admin-errors';
import { api } from '../../lib/api';
import { optionalMoneyField, useMoney } from '../../lib/money';
import { usePermissions } from '../../lib/permissions';
import { useAdminMutation, useLocations, useRestaurant, useRestaurantId } from '../../lib/queries';

const required = 'common:validation.required';
const minutes = (min: number, max: number) =>
  z.coerce
    .number<string>()
    .int('common:validation.invalid')
    .min(min, 'common:validation.invalid')
    .max(max, 'common:validation.invalid');

function locationForm(currency: string) {
  return z
    .object({
      code: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z0-9]{2,10}$/, 'common:validation.invalid'),
      nameEn: z.string().trim().min(1, required).max(120, 'common:validation.tooLong'),
      nameAr: z.string().trim().min(1, required).max(120, 'common:validation.tooLong'),
      timezone: z.string().trim().min(1, required),
      addressLine: z.string().trim().max(300, 'common:validation.tooLong'),
      phone: z.string().trim().max(30, 'common:validation.tooLong'),
      taxInclusive: z.boolean(),
      isActive: z.boolean(),
      cashRoundingIncrement: optionalMoneyField(currency).refine((v) => v === null || v >= 1, {
        message: 'common:validation.invalidAmount',
      }),
      kdsWarnMinutes: minutes(1, 240),
      kdsLateMinutes: minutes(2, 480),
    })
    .refine((v) => v.kdsLateMinutes > v.kdsWarnMinutes, {
      message: 'admin:locations.lateAboveWarn',
      path: ['kdsLateMinutes'],
    });
}
type FormInput = z.input<ReturnType<typeof locationForm>>;
type FormOutput = z.output<ReturnType<typeof locationForm>>;

function LocationDialog({ location, onClose }: { location: Location | null; onClose: () => void }) {
  const { t } = useTranslation(['admin', 'common']);
  const rid = useRestaurantId();
  const errorText = useAdminErrorText();
  const { currency, toInput } = useMoney();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(locationForm(currency ?? 'SAR')),
    defaultValues: {
      code: location?.code ?? '',
      nameEn: location?.nameEn ?? '',
      nameAr: location?.nameAr ?? '',
      timezone: location?.timezone ?? 'Asia/Riyadh',
      addressLine: location?.addressLine ?? '',
      phone: location?.phone ?? '',
      taxInclusive: location?.taxInclusive ?? true,
      isActive: location?.isActive ?? true,
      cashRoundingIncrement: toInput(location?.cashRoundingIncrement ?? null),
      kdsWarnMinutes: String(location?.kdsWarnMinutes ?? 8),
      kdsLateMinutes: String(location?.kdsLateMinutes ?? 15),
    },
  });
  const save = useAdminMutation(
    async ({
      code,
      isActive,
      cashRoundingIncrement,
      kdsWarnMinutes,
      kdsLateMinutes,
      ...v
    }: FormOutput) => {
      const base = { ...v, addressLine: v.addressLine || null, phone: v.phone || null };
      if (location) {
        return api.locations.update(location.id, {
          ...base,
          isActive,
          cashRoundingIncrement,
          kdsWarnMinutes,
          kdsLateMinutes,
        });
      }
      const created = await api.locations.create(rid, { ...base, code });
      return api.locations.update(created.id, {
        cashRoundingIncrement,
        kdsWarnMinutes,
        kdsLateMinutes,
      });
    },
    ['locations', 'dashboard', 'online-ordering'],
  );
  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await save.mutateAsync(values);
      onClose();
    } catch (error) {
      const fields = ['code', 'timezone', 'kdsLateMinutes', 'cashRoundingIncrement'] as const;
      if (!applyServerValidation(error, form.setError, fields)) setFormError(errorText(error));
    }
  });
  const errors = form.formState.errors;
  const msg = (m?: string) => (m ? tKey(t, m) : undefined);
  const check = (name: 'taxInclusive' | 'isActive', label: string, hint?: string) => (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <div className="flex items-start gap-2">
          <Checkbox
            id={`location-${name}`}
            checked={field.value}
            onCheckedChange={(v) => {
              field.onChange(v === true);
            }}
          />
          <div className="grid gap-0.5">
            <Label htmlFor={`location-${name}`}>{label}</Label>
            {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
          </div>
        </div>
      )}
    />
  );

  return (
    <DialogContent closeLabel={t('common:actions.close')} className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>{location ? t('admin:locations.edit') : t('admin:locations.new')}</DialogTitle>
      </DialogHeader>
      <form className="grid gap-4" noValidate onSubmit={(e) => void onSubmit(e)}>
        {formError ? <Alert variant="destructive">{formError}</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('admin:locations.code')}
            hint={t('admin:locations.codeHint')}
            error={msg(errors.code?.message)}
          >
            <Input
              dir="ltr"
              autoComplete="off"
              readOnly={location !== null}
              {...form.register('code')}
            />
          </Field>
          <Field
            label={t('admin:locations.timezone')}
            hint={t('admin:restaurant.timezoneHint')}
            error={msg(errors.timezone?.message)}
          >
            <Input dir="ltr" autoComplete="off" {...form.register('timezone')} />
          </Field>
        </div>
        <LocalizedFields register={form.register} errors={errors} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('admin:locations.address')} hint={t('common:states.optional')}>
            <Input {...form.register('addressLine')} />
          </Field>
          <Field label={t('admin:locations.phone')} hint={t('common:states.optional')}>
            <Input dir="ltr" inputMode="tel" {...form.register('phone')} />
          </Field>
        </div>
        {check(
          'taxInclusive',
          t('admin:locations.taxInclusive'),
          t('admin:locations.taxInclusiveHint'),
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label={`${t('admin:locations.cashRounding')} (${currency ?? ''})`}
            hint={t('admin:locations.cashRoundingHint')}
            error={msg(errors.cashRoundingIncrement?.message)}
          >
            <Input inputMode="decimal" dir="ltr" {...form.register('cashRoundingIncrement')} />
          </Field>
          <Field
            label={t('admin:locations.kdsWarn')}
            hint={t('admin:locations.kdsHint')}
            error={msg(errors.kdsWarnMinutes?.message)}
          >
            <Input
              type="number"
              inputMode="numeric"
              dir="ltr"
              {...form.register('kdsWarnMinutes')}
            />
          </Field>
          <Field label={t('admin:locations.kdsLate')} error={msg(errors.kdsLateMinutes?.message)}>
            <Input
              type="number"
              inputMode="numeric"
              dir="ltr"
              {...form.register('kdsLateMinutes')}
            />
          </Field>
        </div>
        {location ? check('isActive', t('admin:locations.active')) : null}
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

export function LocationsPage() {
  const { t } = useTranslation(['admin', 'common', 'menu']);
  const locale = useCurrentLocale();
  const { can, canAt } = usePermissions();
  const { format } = useMoney();
  const query = useLocations();
  const restaurant = useRestaurant();
  const [editing, setEditing] = useState<Location | 'new' | null>(null);
  return (
    <>
      <PageHeader
        title={t('admin:locations.title')}
        description={t('admin:locations.description')}
        actions={
          can('settings.manage') ? (
            <Button
              onClick={() => {
                setEditing('new');
              }}
            >
              <Plus aria-hidden />
              {t('admin:locations.new')}
            </Button>
          ) : null
        }
      />
      <QueryState
        query={query}
        isEmpty={(rows) => rows.length === 0}
        empty={{ title: t('admin:locations.empty') }}
      >
        {(rows) => (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin:locations.code')}</TableHead>
                  <TableHead>{t('menu:fields.name')}</TableHead>
                  <TableHead>{t('admin:locations.timezone')}</TableHead>
                  <TableHead>{t('admin:locations.taxes')}</TableHead>
                  <TableHead>{t('admin:locations.cashRounding')}</TableHead>
                  <TableHead>{t('admin:locations.kitchen')}</TableHead>
                  <TableHead>{t('admin:shared.status')}</TableHead>
                  <TableHead className="text-end">{t('admin:shared.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="ltr-nums font-medium">{row.code}</TableCell>
                    <TableCell>{pickLocalized(row, 'name', locale)}</TableCell>
                    <TableCell className="ltr-nums">{row.timezone}</TableCell>
                    <TableCell>
                      {row.taxInclusive
                        ? t('admin:locations.inclusive')
                        : t('admin:locations.exclusive')}
                    </TableCell>
                    <TableCell className="ltr-nums">
                      {row.cashRoundingIncrement === null || !restaurant.data
                        ? t('admin:locations.noRounding')
                        : format(row.cashRoundingIncrement)}
                    </TableCell>
                    <TableCell className="ltr-nums">
                      {row.kdsWarnMinutes} / {row.kdsLateMinutes}
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.isActive ? 'success' : 'secondary'}>
                        {row.isActive ? t('common:states.active') : t('common:states.inactive')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-end">
                      {canAt(row.id, 'settings.manage') ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`${t('common:actions.edit')} ${row.code}`}
                          onClick={() => {
                            setEditing(row);
                          }}
                        >
                          <Pencil aria-hidden />
                          {t('common:actions.edit')}
                        </Button>
                      ) : null}
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
        {/* Money fields need the restaurant's currency. */}
        {editing !== null && restaurant.data ? (
          <LocationDialog
            key={editing === 'new' ? 'new' : editing.id}
            location={editing === 'new' ? null : editing}
            onClose={() => {
              setEditing(null);
            }}
          />
        ) : null}
      </Dialog>
    </>
  );
}
