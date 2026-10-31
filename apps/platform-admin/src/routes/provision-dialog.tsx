import { useCurrentLocale } from '@pos/app-kit';
import { PLATFORM_FEATURE_DEFAULTS, SUPPORTED_CURRENCIES, businessTypeDefaults } from '@pos/domain';
import { pickLocalized } from '@pos/i18n';
import {
  BusinessType,
  DEFAULT_TENANT_CURRENCY,
  FEATURES,
  type Feature,
  LOCALES,
  type Locale,
  enumValues,
} from '@pos/shared-types';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Label,
  NativeSelect,
  Switch,
} from '@pos/ui';
import {
  type ProvisionTenantRequest,
  type ProvisionedTenantDto,
  provisionTenantSchema,
} from '@pos/validation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api } from '../lib/api';
import { usePlatformErrorText } from '../lib/errors';

type Entitlements = Record<Feature, { entitled: boolean; tenantConfigurable: boolean }>;

/** What a new business of this type is allowed: the platform's and its type's defaults. */
export function defaultEntitlements(businessType: string): Entitlements {
  const typeDefaults = businessTypeDefaults(businessType);
  return Object.fromEntries(
    FEATURES.map((f) => [
      f,
      {
        entitled: PLATFORM_FEATURE_DEFAULTS[f] || typeDefaults[f] === true,
        tenantConfigurable: true,
      },
    ]),
  ) as Entitlements;
}

interface FormState {
  slug: string;
  nameEn: string;
  nameAr: string;
  legalName: string;
  businessType: BusinessType;
  currencyCode: string;
  defaultLocale: Locale;
  supportedLocales: Locale[];
  timezone: string;
  locationCode: string;
  locationNameEn: string;
  locationNameAr: string;
  taxInclusive: boolean;
  ownerEmail: string;
  ownerName: string;
  ownerLocale: Locale;
  entitlements: Entitlements;
}

const initial = (): FormState => ({
  slug: '',
  nameEn: '',
  nameAr: '',
  legalName: '',
  businessType: 'RESTAURANT',
  currencyCode: DEFAULT_TENANT_CURRENCY,
  defaultLocale: 'ar',
  supportedLocales: ['ar', 'en'],
  timezone: 'Asia/Hebron',
  locationCode: 'MAIN',
  locationNameEn: 'Main branch',
  locationNameAr: 'الفرع الرئيسي',
  taxInclusive: true,
  ownerEmail: '',
  ownerName: '',
  ownerLocale: 'ar',
  entitlements: defaultEntitlements('RESTAURANT'),
});

function toRequest(form: FormState): ProvisionTenantRequest {
  return {
    tenant: {
      slug: form.slug,
      nameEn: form.nameEn,
      nameAr: form.nameAr,
      legalName: form.legalName.trim() === '' ? null : form.legalName,
      businessType: form.businessType,
      currencyCode: form.currencyCode,
      defaultLocale: form.defaultLocale,
      supportedLocales: form.supportedLocales,
      timezone: form.timezone,
    },
    location: {
      code: form.locationCode,
      nameEn: form.locationNameEn,
      nameAr: form.locationNameAr,
      taxInclusive: form.taxInclusive,
    },
    owner: {
      email: form.ownerEmail,
      displayName: form.ownerName,
      preferredLocale: form.ownerLocale,
    },
    entitlements: form.entitlements,
  };
}

/** The one-time temporary password, with a copy button. */
function ProvisionResult({ result }: { result: ProvisionedTenantDto }) {
  const { t } = useTranslation('platform');
  const locale = useCurrentLocale();
  const [copied, setCopied] = useState(false);
  const tenant = result.tenant.tenant;
  // A brand created into an organization has no owner of its own (its members are the owners).
  const owner = result.owner;
  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{t('provision.doneTitle')}</DialogTitle>
        <DialogDescription>
          {t('provision.doneDescription', { name: pickLocalized(tenant, 'name', locale) })}
        </DialogDescription>
      </DialogHeader>
      {owner ? (
        <>
          <Field label={t('provision.ownerEmail')}>
            <Input readOnly dir="ltr" value={owner.email} />
          </Field>
          <Field label={t('provision.temporaryPassword')}>
            <div className="flex gap-2">
              <Input
                readOnly
                dir="ltr"
                className="font-mono"
                data-testid="temporary-password"
                value={owner.temporaryPassword}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(owner.temporaryPassword);
                  setCopied(true);
                }}
              >
                <Copy aria-hidden />
                {copied ? t('shared.copied') : t('shared.copy')}
              </Button>
            </div>
          </Field>
          <Alert variant="destructive">
            <KeyRound aria-hidden className="me-1 inline size-4" />
            {t('provision.passwordWarning')}
          </Alert>
        </>
      ) : null}
      <DialogFooter>
        <Button asChild>
          <Link to={`/tenants/${tenant.id}`}>{t('provision.openTenant')}</Link>
        </Button>
      </DialogFooter>
    </div>
  );
}

/** Creates a business with its first location, owner, web address and modules (ADR 0025). */
export function ProvisionDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation(['platform', 'admin', 'common']);
  const errorText = usePlatformErrorText();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(initial);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProvisionedTenantDto | null>(null);
  const provision = useMutation({ mutationFn: api.tenants.provision });

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const close = (next: boolean) => {
    if (!next) {
      setForm(initial());
      setError(null);
      setResult(null);
    }
    onOpenChange(next);
  };

  const submit = async () => {
    setError(null);
    const request = toRequest(form);
    if (!provisionTenantSchema.safeParse(request).success) {
      setError(t('common:validation.invalid'));
      return;
    }
    try {
      const created = await provision.mutateAsync(request);
      setResult(created);
      await queryClient.invalidateQueries({ queryKey: ['tenants'] });
    } catch (e) {
      setError(errorText(e));
    }
  };

  const text = (
    key: keyof FormState,
    label: string,
    props: { dir?: 'ltr' | 'rtl'; hint?: string } = {},
  ) => (
    <Field label={label} hint={props.hint}>
      <Input
        dir={props.dir}
        value={form[key] as string}
        onChange={(e) => {
          set(key, e.target.value as never);
        }}
      />
    </Field>
  );

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent closeLabel={t('common:actions.close')} className="max-w-2xl">
        {result ? (
          <ProvisionResult result={result} />
        ) : (
          <form
            className="grid gap-5"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <DialogHeader>
              <DialogTitle>{t('platform:provision.title')}</DialogTitle>
              <DialogDescription>{t('platform:provision.description')}</DialogDescription>
            </DialogHeader>
            {error ? <Alert variant="destructive">{error}</Alert> : null}

            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="mb-2 font-medium">{t('platform:provision.business')}</legend>
              {text('slug', t('platform:provision.slug'), {
                dir: 'ltr',
                hint: t('platform:provision.slugHint', { domain: 'madar.app' }),
              })}
              <Field label={t('platform:provision.businessType')}>
                <NativeSelect
                  value={form.businessType}
                  onChange={(e) => {
                    const businessType = e.target.value as BusinessType;
                    setForm((f) => ({
                      ...f,
                      businessType,
                      entitlements: defaultEntitlements(businessType),
                    }));
                  }}
                >
                  {enumValues(BusinessType).map((b) => (
                    <option key={b} value={b}>
                      {t(`admin:tenant.businessTypes.${b}`)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              {text('nameEn', t('platform:provision.nameEn'), { dir: 'ltr' })}
              {text('nameAr', t('platform:provision.nameAr'), { dir: 'rtl' })}
              {text('legalName', t('platform:provision.legalName'))}
              <Field
                label={t('platform:provision.currency')}
                hint={t('platform:provision.currencyHint')}
              >
                <NativeSelect
                  value={form.currencyCode}
                  onChange={(e) => {
                    set('currencyCode', e.target.value);
                  }}
                >
                  {SUPPORTED_CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label={t('platform:provision.defaultLocale')}>
                <NativeSelect
                  value={form.defaultLocale}
                  onChange={(e) => {
                    const defaultLocale = e.target.value as Locale;
                    setForm((f) => ({
                      ...f,
                      defaultLocale,
                      supportedLocales: f.supportedLocales.includes(defaultLocale)
                        ? f.supportedLocales
                        : [...f.supportedLocales, defaultLocale],
                    }));
                  }}
                >
                  {LOCALES.map((l) => (
                    <option key={l} value={l}>
                      {t(`common:language.${l}`)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label={t('platform:provision.supportedLocales')}>
                <div className="flex gap-4 pt-2">
                  {LOCALES.map((l) => (
                    <Label key={l} className="flex items-center gap-2 font-normal">
                      <Checkbox
                        checked={form.supportedLocales.includes(l)}
                        disabled={l === form.defaultLocale}
                        onCheckedChange={(checked) => {
                          set(
                            'supportedLocales',
                            checked === true
                              ? [...form.supportedLocales, l]
                              : form.supportedLocales.filter((x) => x !== l),
                          );
                        }}
                      />
                      {t(`common:language.${l}`)}
                    </Label>
                  ))}
                </div>
              </Field>
              {text('timezone', t('platform:provision.timezone'), { dir: 'ltr' })}
            </fieldset>

            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="mb-2 font-medium">{t('platform:provision.location')}</legend>
              {text('locationCode', t('platform:provision.locationCode'), {
                dir: 'ltr',
                hint: t('platform:provision.locationCodeHint'),
              })}
              <Label className="flex items-center gap-2 self-end pb-2 font-normal">
                <Switch
                  checked={form.taxInclusive}
                  onCheckedChange={(checked) => {
                    set('taxInclusive', checked);
                  }}
                />
                {t('platform:provision.taxInclusive')}
              </Label>
              {text('locationNameEn', t('platform:provision.nameEn'), { dir: 'ltr' })}
              {text('locationNameAr', t('platform:provision.nameAr'), { dir: 'rtl' })}
            </fieldset>

            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="mb-2 font-medium">{t('platform:provision.owner')}</legend>
              {text('ownerEmail', t('platform:provision.ownerEmail'), { dir: 'ltr' })}
              {text('ownerName', t('platform:provision.ownerName'))}
              <Field label={t('platform:provision.ownerLocale')}>
                <NativeSelect
                  value={form.ownerLocale}
                  onChange={(e) => {
                    set('ownerLocale', e.target.value as Locale);
                  }}
                >
                  {LOCALES.map((l) => (
                    <option key={l} value={l}>
                      {t(`common:language.${l}`)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </fieldset>

            <fieldset className="grid gap-2">
              <legend className="mb-1 font-medium">{t('platform:provision.modules')}</legend>
              <p className="text-sm text-muted-foreground">{t('platform:provision.modulesHint')}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {FEATURES.map((feature) => {
                  const value = form.entitlements[feature];
                  const update = (patch: Partial<typeof value>) => {
                    set('entitlements', {
                      ...form.entitlements,
                      [feature]: { ...value, ...patch },
                    });
                  };
                  return (
                    <div
                      key={feature}
                      className="flex items-center justify-between gap-2 rounded-md border p-2"
                    >
                      <Label className="flex items-center gap-2 font-normal">
                        <Checkbox
                          checked={value.entitled}
                          onCheckedChange={(checked) => {
                            update({ entitled: checked === true });
                          }}
                        />
                        {t(`admin:modules.features.${feature}.name`)}
                      </Label>
                      <Label className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
                        <Switch
                          checked={value.tenantConfigurable}
                          disabled={!value.entitled}
                          aria-label={`${t(`admin:modules.features.${feature}.name`)}: ${t('platform:provision.configurable')}`}
                          onCheckedChange={(checked) => {
                            update({ tenantConfigurable: checked });
                          }}
                        />
                        {t('platform:provision.configurable')}
                      </Label>
                    </div>
                  );
                })}
              </div>
            </fieldset>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  close(false);
                }}
              >
                {t('common:actions.cancel')}
              </Button>
              <Button type="submit" disabled={provision.isPending}>
                {provision.isPending
                  ? t('platform:provision.submitting')
                  : t('platform:provision.submit')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
