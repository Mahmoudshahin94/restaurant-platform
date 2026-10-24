import { FeatureGate, useMoneyFormat } from '@pos/app-kit';
import { Feature } from '@pos/shared-types';
import type { Order } from '@pos/validation';
import { Button } from '@pos/ui';
import { useQuery } from '@tanstack/react-query';
import { MonitorSmartphone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useLocationId } from '../lib/queries';
import { api } from '../lib/session';

/**
 * Kiosk orders the customer chose to pay at the counter (ADR 0022): PLACED and unpaid until a
 * cashier takes the money and confirms them, oldest first.
 */
function useKioskOrdersToCollect(locationId: string) {
  return useQuery({
    queryKey: ['orders', locationId, 'kiosk-to-collect'],
    queryFn: () => api.orders.list(locationId, { status: ['PLACED'], limit: 50 }),
    select: (orders: Order[]) =>
      orders
        .filter((o) => o.channel === 'KIOSK' && o.paymentStatus === 'UNPAID')
        .sort((a, b) => (a.placedAt ?? '').localeCompare(b.placedAt ?? '')),
    // Realtime `order.*` events refresh it at once; polling is the fallback.
    refetchInterval: 15_000,
  });
}

function KioskOrdersBanner() {
  const { t } = useTranslation('pos');
  const locationId = useLocationId();
  const navigate = useNavigate();
  const orders = useKioskOrdersToCollect(locationId).data ?? [];
  const { format } = useMoneyFormat(orders[0]?.currencyCode ?? null);
  if (orders.length === 0) return null;
  return (
    <section
      role="status"
      aria-label={t('kiosk.listLabel')}
      className="mb-3 grid gap-2 rounded-lg border-2 border-primary bg-primary/10 px-4 py-2"
      data-testid="kiosk-orders-banner"
    >
      <p className="flex items-center gap-2 font-semibold">
        <MonitorSmartphone aria-hidden className="size-5" />
        {t('kiosk.banner', { count: orders.length })}
      </p>
      <ul className="flex flex-wrap gap-2">
        {orders.slice(0, 6).map((o) => (
          <li key={o.id}>
            <Button
              variant="outline"
              onClick={() => void navigate(`/orders?order=${o.id}`)}
              aria-label={`${t('kiosk.collect')} ${o.orderNumber}`}
            >
              <span className="ltr-nums font-semibold">{o.orderNumber}</span>
              <span>{o.customerName ?? t('kiosk.noName')}</span>
              <bdi className="ltr-nums text-muted-foreground">{format(o.total)}</bdi>
              <span className="font-semibold text-primary">{t('kiosk.collect')}</span>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Shown wherever this location runs self-service kiosks (SELF_CHECKOUT). */
export function KioskOrdersPrompt() {
  return (
    <FeatureGate feature={Feature.SELF_CHECKOUT}>
      <KioskOrdersBanner />
    </FeatureGate>
  );
}
