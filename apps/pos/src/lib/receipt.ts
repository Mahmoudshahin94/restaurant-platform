import { useCurrentLocale } from '@pos/app-kit';
import { type ReceiptDocument, buildReceipt } from '@pos/receipts';
import type { Order } from '@pos/validation';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocationId, useLocations, useRestaurant } from './queries';
import { useSession } from './session';

/** Builds receipts in the terminal's current language from the order and venue details. */
export function useReceiptBuilder(): ((order: Order) => ReceiptDocument) | null {
  const { i18n } = useTranslation();
  const locale = useCurrentLocale();
  const locationId = useLocationId();
  const restaurant = useRestaurant().data;
  const location = useLocations().data?.find((l) => l.id === locationId);
  const user = useSession((s) => s.user);

  const build = useCallback(
    (order: Order) => {
      if (!restaurant || !location) throw new Error('Venue details not loaded');
      const t = i18n.getFixedT(locale);
      return buildReceipt({
        order,
        restaurant,
        location,
        cashierName: user?.displayName ?? null,
        locale,
        printedAt: new Date().toISOString(),
        t: (key, options) => t(key as never, options as never) as unknown as string,
      });
    },
    [i18n, locale, restaurant, location, user],
  );
  return restaurant && location ? build : null;
}
