import { QueryState, useCurrentLocale } from '@pos/app-kit';
import { PLATFORM_CURRENCY_DISPLAY, resolveCurrency, resolveLocales } from '@pos/domain';
import { formatMoney, formatNumber } from '@pos/i18n';
import {
  CURRENCY_DISPLAYS,
  type CurrencyDisplay,
  DIGIT_STYLES,
  type DigitStyle,
  FORMAT_LOCALES,
  type FormatLocale,
  LOCALES,
  type Locale,
} from '@pos/shared-types';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Field,
  Input,
  Label,
  NativeSelect,
  PageHeader,
} from '@pos/ui';
import {
  type TenantLocalizationDto,
  type UpdateLocalizationRequest,
  currencySymbolSchema,
} from '@pos/validation';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAdminErrorText } from '../../lib/admin-errors';
import { api } from '../../lib/api';
import { keys, useAdminMutation, useTenantId } from '../../lib/queries';

/** The page's draft: every setting, the symbol as typed. */
interface Draft {
  defaultLocale: Locale;
  supportedLocales: Locale[];
  digits: DigitStyle | null;
  currencySymbol: string;
  currencyDisplay: CurrencyDisplay | null;
  currencyFormatLocale: FormatLocale | null;
}

/** An amount and a count for the preview: 1,234.56 (or 123.456 in a three-decimal currency). */
const SAMPLE_MINOR = 123_456;
const SAMPLE_NUMBER = 1_234_567;

function draftOf(data: TenantLocalizationDto): Draft {
  return { ...data.settings, currencySymbol: data.settings.currencySymbol ?? '' };
}

function requestOf(draft: Draft): UpdateLocalizationRequest {
  const symbol = draft.currencySymbol.trim();
  return { ...draft, currencySymbol: symbol === '' ? null : symbol };
}

/**
 * The tenant's languages and how its amounts look (ADR 0020): which languages its screens offer
 * (one language hides the switcher), the default, Arabic-Indic digits, and the currency's
 * symbol, display and format locale. The currency itself and its decimal places are shown, never
 * changed. A preview shows an amount in each language as every screen will.
 */
export function LocalizationPage() {
  const { t } = useTranslation(['admin']);
  const tid = useTenantId();
  const localization = useQuery({
    queryKey: keys.localization(tid),
    queryFn: () => api.tenants.localization(tid),
  });
  const [saved, setSaved] = useState(false);
  return (
    <div className="grid max-w-5xl gap-6">
      <PageHeader
        title={t('admin:localization.title')}
        description={t('admin:localization.description')}
      />
      <QueryState query={localization}>
        {(data) => (
          <LocalizationForm key={data.updatedAt} initial={data} saved={saved} onSaved={setSaved} />
        )}
      </QueryState>
    </div>
  );
}

function LocalizationForm({
  initial,
  saved,
  onSaved,
}: {
  initial: TenantLocalizationDto;
  saved: boolean;
  onSaved: (saved: boolean) => void;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const locale = useCurrentLocale();
  const errorText = useAdminErrorText();
  const tid = useTenantId();
  const [draft, setDraft] = useState<Draft>(() => draftOf(initial));
  const [error, setError] = useState<string | null>(null);
  const save = useAdminMutation(
    (body: UpdateLocalizationRequest) => api.tenants.updateLocalization(tid, body),
    ['localization', 'tenant-context', 'tenant'],
  );

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    onSaved(false);
    setDraft((d) => ({ ...d, [key]: value }));
  };
  const toggleLocale = (l: Locale, on: boolean) => {
    onSaved(false);
    setDraft((d) => {
      const supported = LOCALES.filter((x) => (x === l ? on : d.supportedLocales.includes(x)));
      const defaultLocale = supported.includes(d.defaultLocale) ? d.defaultLocale : supported[0];
      return { ...d, supportedLocales: supported, defaultLocale: defaultLocale ?? d.defaultLocale };
    });
  };

  const symbol = draft.currencySymbol.trim();
  const symbolInvalid = symbol !== '' && !currencySymbolSchema.safeParse(symbol).success;
  const code = initial.currency.code;
  const platformSymbol = resolveCurrency(code).symbol;
  const preview = useMemo(
    () => ({
      currency: resolveCurrency(code, {
        symbol: symbol === '' || symbolInvalid ? null : symbol,
        display: draft.currencyDisplay,
        formatLocale: draft.currencyFormatLocale,
      }),
      locales: resolveLocales({
        defaultLocale: draft.defaultLocale,
        supportedLocales: draft.supportedLocales,
        digits: draft.digits,
      }),
    }),
    [code, symbol, symbolInvalid, draft],
  );
  const localeName = useMemo(() => new Intl.DisplayNames([locale], { type: 'language' }), [locale]);
  const inherit = (value: string) => t('admin:localization.inherit', { value });

  // The save refetches the settings, which re-keys (remounts) this form; `mutate`'s own
  // callbacks are dropped once it unmounts, so the outcome is read from the promise.
  const submit = () => {
    setError(null);
    save.mutateAsync(requestOf(draft)).then(
      () => {
        onSaved(true);
      },
      (e: unknown) => {
        setError(errorText(e));
      },
    );
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('admin:localization.languages')}</CardTitle>
            <CardDescription>{t('admin:localization.languagesHint')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <fieldset className="grid gap-2">
              <legend className="mb-2 text-sm font-medium">
                {t('admin:localization.supported')}
              </legend>
              {LOCALES.map((l) => {
                const id = `locale-${l}`;
                const checked = draft.supportedLocales.includes(l);
                return (
                  <div key={l} className="flex items-center gap-2">
                    <Checkbox
                      id={id}
                      checked={checked}
                      // A business offers at least one language.
                      disabled={checked && draft.supportedLocales.length === 1}
                      onCheckedChange={(v) => {
                        toggleLocale(l, v === true);
                      }}
                    />
                    <Label htmlFor={id} lang={l} className="font-normal">
                      {t(`common:language.${l}`)}
                    </Label>
                  </div>
                );
              })}
            </fieldset>
            {draft.supportedLocales.length === 1 ? (
              <Alert>{t('admin:localization.singleLocale')}</Alert>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={t('admin:localization.defaultLocale')}
                hint={t('admin:localization.defaultLocaleHint')}
              >
                <NativeSelect
                  value={draft.defaultLocale}
                  onChange={(e) => {
                    set('defaultLocale', e.target.value as Locale);
                  }}
                >
                  {draft.supportedLocales.map((l) => (
                    <option key={l} value={l} lang={l}>
                      {t(`common:language.${l}`)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field
                label={t('admin:localization.digits')}
                hint={t('admin:localization.digitsHint')}
              >
                <NativeSelect
                  value={draft.digits ?? ''}
                  onChange={(e) => {
                    set('digits', e.target.value === '' ? null : (e.target.value as DigitStyle));
                  }}
                >
                  <option value="">{inherit(t('admin:localization.digitStyles.latn'))}</option>
                  {DIGIT_STYLES.map((d) => (
                    <option key={d} value={d}>
                      {t(`admin:localization.digitStyles.${d}`)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('admin:localization.currency')}</CardTitle>
            <CardDescription>{t('admin:localization.currencyHint')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label={t('admin:localization.currencyCode')}>
              <Input dir="ltr" value={code} readOnly />
            </Field>
            <Field
              label={t('admin:localization.decimalPlaces')}
              hint={t('admin:localization.decimalPlacesHint')}
            >
              <Input
                dir="ltr"
                className="ltr-nums"
                value={formatNumber(initial.currency.decimalPlaces, locale)}
                readOnly
              />
            </Field>
            <Field
              label={t('admin:localization.symbol')}
              hint={
                platformSymbol
                  ? t('admin:localization.symbolHintDefault', { symbol: platformSymbol })
                  : t('admin:localization.symbolHint')
              }
              error={symbolInvalid ? t('admin:localization.symbolInvalid') : undefined}
            >
              <Input
                value={draft.currencySymbol}
                placeholder={platformSymbol ?? code}
                maxLength={16}
                onChange={(e) => {
                  set('currencySymbol', e.target.value);
                }}
              />
            </Field>
            <Field
              label={t('admin:localization.display')}
              hint={t('admin:localization.displayHint')}
            >
              <NativeSelect
                value={draft.currencyDisplay ?? ''}
                onChange={(e) => {
                  set(
                    'currencyDisplay',
                    e.target.value === '' ? null : (e.target.value as CurrencyDisplay),
                  );
                }}
              >
                <option value="">
                  {inherit(t(`admin:localization.displays.${PLATFORM_CURRENCY_DISPLAY.display}`))}
                </option>
                {CURRENCY_DISPLAYS.map((d) => (
                  <option key={d} value={d}>
                    {t(`admin:localization.displays.${d}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field
              className="sm:col-span-2"
              label={t('admin:localization.formatLocale')}
              hint={t('admin:localization.formatLocaleHint')}
            >
              <NativeSelect
                value={draft.currencyFormatLocale ?? ''}
                onChange={(e) => {
                  set(
                    'currencyFormatLocale',
                    e.target.value === '' ? null : (e.target.value as FormatLocale),
                  );
                }}
              >
                <option value="">{t('admin:localization.formatLocaleInherit')}</option>
                {FORMAT_LOCALES.map((f) => (
                  <option key={f} value={f}>
                    {localeName.of(f) ?? f}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:sticky lg:top-4">
        <Card>
          <CardHeader>
            <CardTitle>{t('admin:localization.preview')}</CardTitle>
            <CardDescription>{t('admin:localization.previewHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3" aria-label={t('admin:localization.preview')}>
              {preview.locales.supported.map((l) => (
                <div key={l} lang={l} dir={l === 'ar' ? 'rtl' : 'ltr'} className="grid gap-1">
                  <dt className="text-xs text-muted-foreground">{t(`common:language.${l}`)}</dt>
                  <dd className="text-lg font-semibold" data-testid={`preview-${l}`}>
                    {formatMoney(SAMPLE_MINOR, preview.currency, l, {
                      digits: preview.locales.digits,
                    })}
                  </dd>
                  <dd className="text-sm text-muted-foreground">
                    {formatNumber(SAMPLE_NUMBER, l, { digits: preview.locales.digits })}
                  </dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        {saved ? <Alert>{t('admin:localization.saved')}</Alert> : null}
        <Button size="lg" disabled={save.isPending || symbolInvalid} onClick={submit}>
          {save.isPending ? t('common:states.saving') : t('common:actions.save')}
        </Button>
      </div>
    </div>
  );
}
