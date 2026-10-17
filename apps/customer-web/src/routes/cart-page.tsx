import { QueryState, tKey } from '@pos/app-kit';
import {
  Alert,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  buttonVariants,
  cn,
} from '@pos/ui';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { CartLines } from '../components/cart-lines';
import { OrderTotals } from '../components/order-totals';
import { OrderingNotice } from '../components/ordering-status';
import { useLocation, useMenu } from '../lib/queries';
import { useCartQuote } from '../lib/quote';
import { useCart } from '../stores/cart';

/** The cart with a price preview; checkout needs a valid cart and an open branch. */
export function CartPage() {
  const { t } = useTranslation(['customer', 'common', 'errors']);
  const { locationId = '' } = useParams();
  const location = useLocation(locationId);
  const menu = useMenu(locationId);
  const { lines, fulfillment, ensureLocation } = useCart();
  useEffect(() => {
    ensureLocation(locationId);
  }, [ensureLocation, locationId]);
  const { quote, error } = useCartQuote(
    menu.data,
    lines,
    fulfillment,
    location.data?.deliveryFee ?? 0,
  );

  return (
    <QueryState query={menu}>
      {(m) =>
        lines.length === 0 ? (
          <EmptyState
            title={t('customer:cart.empty')}
            description={t('customer:cart.emptyHint')}
            action={
              <Link to={`/l/${locationId}`} className={buttonVariants()}>
                {t('customer:cart.browse')}
              </Link>
            }
          />
        ) : (
          <div className="grid gap-4">
            <h1 className="text-2xl font-semibold">{t('customer:cart.title')}</h1>
            {location.data ? <OrderingNotice status={location.data.status} /> : null}
            <Card>
              <CardContent className="pt-2">
                <CartLines
                  menu={m}
                  quote={quote}
                  problemLineId={(error?.details.lineId as string | undefined) ?? null}
                />
              </CardContent>
            </Card>
            {error ? (
              <Alert variant="destructive" title={t('customer:cart.unavailable')}>
                {tKey(t, `errors:${error.code}`)}
              </Alert>
            ) : null}
            {quote ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('customer:checkout.summary')}</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <OrderTotals
                    currency={m.currencyCode}
                    taxInclusive={m.taxInclusive}
                    totals={quote.pricing}
                  />
                  <p className="text-xs text-muted-foreground">{t('customer:cart.previewNote')}</p>
                </CardContent>
              </Card>
            ) : null}
            <div className="flex flex-wrap justify-between gap-3">
              <Link to={`/l/${locationId}`} className={buttonVariants({ variant: 'outline' })}>
                {t('customer:cart.browse')}
              </Link>
              <Link
                to={`/l/${locationId}/checkout`}
                aria-disabled={error !== null}
                className={cn(
                  buttonVariants({ size: 'lg' }),
                  error !== null && 'pointer-events-none opacity-50',
                )}
              >
                {t('customer:cart.checkout')}
              </Link>
            </div>
          </div>
        )
      }
    </QueryState>
  );
}
