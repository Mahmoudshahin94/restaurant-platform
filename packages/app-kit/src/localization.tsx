import { selectLocale } from '@pos/domain';
import type { FormatOptions } from '@pos/i18n';
import {
  type CurrencyConfiguration,
  LOCALES,
  type Locale,
  type LocaleConfiguration,
} from '@pos/shared-types';
import { type ReactNode, createContext, useContext, useLayoutEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

/** A tenant's currency display and languages (ADR 0020), as far as the screen knows them. */
export interface LocalizationSettings {
  /** Null: no tenant yet (a sign-in screen): amounts use MADAR's display of their currency. */
  currency: CurrencyConfiguration | null;
  /** Null: no tenant yet: every platform locale is offered, in Latin digits. */
  locales: LocaleConfiguration | null;
}

const LocalizationContext = createContext<LocalizationSettings>({ currency: null, locales: null });

/**
 * Provides a tenant's currency display and languages to the money formatting, the number
 * formatting and the language switcher below. `TenantProvider` provides the tenant context's;
 * the customer website and the hub's sign-in screens provide their public ones.
 */
export function LocalizationProvider({
  currency = null,
  locales = null,
  children,
}: {
  currency?: CurrencyConfiguration | null;
  locales?: LocaleConfiguration | null;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ currency, locales }), [currency, locales]);
  return <LocalizationContext.Provider value={value}>{children}</LocalizationContext.Provider>;
}

export function useLocalization(): LocalizationSettings {
  return useContext(LocalizationContext);
}

/** Options for `formatNumber`, `formatDateTime`, …: the tenant's digit style (Arabic only). */
export function useFormatOptions(): FormatOptions {
  const digits = useLocalization().locales?.digits ?? 'latn';
  return useMemo(() => ({ digits }), [digits]);
}

/** The languages a screen offers: the tenant's, or every platform locale before there is one. */
export function useSupportedLocales(): readonly Locale[] {
  return useLocalization().locales?.supported ?? LOCALES;
}

/**
 * Switches the screen to the language the rule picks (ADR 0020) once the tenant's languages are
 * known, and again whenever an input changes: the device's stored choice if the tenant offers
 * it, else the signed-in user's preferred locale, else the tenant's default. Only the language
 * switcher stores a choice; this never does. Runs before paint, so the screen does not flash the
 * previous language.
 */
export function useLocaleSelection(
  locales: LocaleConfiguration | null | undefined,
  choice: { stored: Locale | null; preferred?: Locale | null },
): void {
  const { i18n } = useTranslation();
  const target = locales
    ? selectLocale({
        stored: choice.stored,
        preferred: choice.preferred ?? null,
        supported: locales.supported,
        fallback: locales.default,
      })
    : null;
  useLayoutEffect(() => {
    if (target && i18n.language !== target) void i18n.changeLanguage(target);
  }, [target, i18n]);
}
