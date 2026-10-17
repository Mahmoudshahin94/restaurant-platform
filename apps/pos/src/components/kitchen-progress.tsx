import { useCurrentLocale } from '@pos/app-kit';
import { pickLocalized } from '@pos/i18n';
import type { KitchenTicketStatus } from '@pos/shared-types';
import { Badge, Button } from '@pos/ui';
import type { Order } from '@pos/validation';
import {
  Check,
  CheckCircle2,
  CircleDot,
  Flame,
  type LucideIcon,
  OctagonX,
  Zap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

const TICKET: Record<
  KitchenTicketStatus,
  { icon: LucideIcon; variant: 'secondary' | 'warning' | 'success' | 'outline' | 'destructive' }
> = {
  NEW: { icon: CircleDot, variant: 'secondary' },
  PREPARING: { icon: Flame, variant: 'warning' },
  READY: { icon: CheckCircle2, variant: 'success' },
  COMPLETED: { icon: Check, variant: 'outline' },
  CANCELLED: { icon: OctagonX, variant: 'destructive' },
};

export const hasLiveTickets = (order: Order): boolean =>
  order.tickets.some((t) => t.status === 'NEW' || t.status === 'PREPARING' || t.status === 'READY');

/** Where each station is with this order; the cashier can rush it everywhere at once. */
export function KitchenProgress({
  order,
  canRush,
  rushing,
  onRush,
}: {
  order: Order;
  canRush: boolean;
  rushing: boolean;
  onRush: (priority: 'RUSH' | 'NORMAL') => void;
}) {
  const { t } = useTranslation('orders');
  const locale = useCurrentLocale();
  if (order.status === 'DRAFT' || order.status === 'PLACED') return null;
  const rushed = order.tickets.some((ticket) => ticket.priority === 'RUSH');

  return (
    <section className="mt-4" aria-labelledby={`kitchen-${order.id}`}>
      <div className="mb-2 flex items-center gap-2">
        <h3 id={`kitchen-${order.id}`} className="font-semibold">
          {t('kitchen.title')}
        </h3>
        {rushed ? (
          <Badge variant="destructive">
            <Zap aria-hidden className="size-3" />
            {t('kitchen.rushed')}
          </Badge>
        ) : null}
        {canRush && hasLiveTickets(order) ? (
          <Button
            variant="outline"
            size="sm"
            className="ms-auto"
            disabled={rushing}
            aria-pressed={rushed}
            onClick={() => {
              onRush(rushed ? 'NORMAL' : 'RUSH');
            }}
          >
            <Zap aria-hidden />
            {rushed ? t('kitchen.unrush') : t('kitchen.rush')}
          </Button>
        ) : null}
      </div>
      {order.tickets.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('kitchen.none')}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {order.tickets.map((ticket) => {
            const { icon: Icon, variant } = TICKET[ticket.status];
            return (
              <li key={ticket.id}>
                <Badge variant={variant} className="gap-1.5 px-2.5 py-1 text-sm">
                  <Icon aria-hidden className="size-4" />
                  {pickLocalized(ticket, 'stationName', locale)} ·{' '}
                  {t(`kitchen.ticket.${ticket.status}`)}
                </Badge>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
