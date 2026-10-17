import { useMoneyFormat } from '@pos/app-kit';
import { useTranslation } from 'react-i18next';

export interface Totals {
  subtotal: number;
  discount: number;
  tax: number;
  fees: number;
  total: number;
}

/** Subtotal, discount, tax, delivery fee and total, with the tax shown as included when it is. */
export function OrderTotals({
  totals,
  currency,
  taxInclusive,
}: {
  totals: Totals;
  currency: string;
  taxInclusive: boolean;
}) {
  const { t } = useTranslation(['orders', 'customer']);
  const { format } = useMoneyFormat(currency);
  const row = (label: string, amount: number, testId: string) => (
    <div className="flex justify-between gap-4" data-testid={testId}>
      <dt>{label}</dt>
      <dd className="ltr-nums">{format(amount)}</dd>
    </div>
  );
  return (
    <dl className="grid gap-1.5 text-sm">
      {row(t('orders:totals.subtotal'), totals.subtotal, 'total-subtotal')}
      {totals.discount > 0
        ? row(t('orders:totals.discount'), -totals.discount, 'total-discount')
        : null}
      {row(
        taxInclusive ? t('orders:totals.taxIncluded') : t('orders:totals.tax'),
        totals.tax,
        'total-tax',
      )}
      {totals.fees > 0 ? row(t('customer:checkout.deliveryFee'), totals.fees, 'total-fees') : null}
      <div
        className="mt-1 flex justify-between gap-4 border-t pt-2 text-base font-semibold"
        data-testid="total"
      >
        <dt>{t('orders:totals.total')}</dt>
        <dd className="ltr-nums">{format(totals.total)}</dd>
      </div>
    </dl>
  );
}
