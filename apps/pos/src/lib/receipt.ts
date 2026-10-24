import { useCurrentLocale, useFormatOptions, useLocalization } from '@pos/app-kit';
import { type ReceiptDocument, buildReceipt } from '@pos/receipts';
import type { Order } from '@pos/validation';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocationId, useLocations, useTenant } from './queries';
import { useSession } from './session';

/**
 * Builds receipts in the terminal's current language from the order and venue details, with the
 * tenant's currency display and digits (ADR 0020).
 */
export function useReceiptBuilder(): ((order: Order) => ReceiptDocument) | null {
  const { i18n } = useTranslation();
  const locale = useCurrentLocale();
  const { digits } = useFormatOptions();
  const currency = useLocalization().currency;
  const locationId = useLocationId();
  const tenant = useTenant().data;
  const location = useLocations().data?.find((l) => l.id === locationId);
  const user = useSession((s) => s.user);

  const build = useCallback(
    (order: Order) => {
      if (!tenant || !location) throw new Error('Venue details not loaded');
      const t = i18n.getFixedT(locale);
      return buildReceipt({
        order,
        tenant,
        location,
        cashierName: user?.displayName ?? null,
        locale,
        currency,
        digits,
        printedAt: new Date().toISOString(),
        t: (key, options) => t(key as never, options as never) as unknown as string,
      });
    },
    [i18n, locale, currency, digits, tenant, location, user],
  );
  return tenant && location ? build : null;
}
