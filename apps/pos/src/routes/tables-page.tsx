import { QueryState, useCurrentLocale } from '@pos/app-kit';
import { pickLocalized } from '@pos/i18n';
import { Badge, cn } from '@pos/ui';
import { Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useFloor, useLocationId } from '../lib/queries';
import { useCart } from '../stores/cart';

/** Floor view: free tables start a dine-in order, occupied tables open their order. */
export function TablesPage() {
  const { t } = useTranslation(['floor', 'pos']);
  const locale = useCurrentLocale();
  const locationId = useLocationId();
  const floor = useFloor(locationId);
  const cart = useCart();
  const navigate = useNavigate();

  return (
    <QueryState query={floor} isEmpty={(s) => s.length === 0} empty={{ title: t('floor:empty') }}>
      {(sections) => (
        <div className="grid h-full content-start gap-6 overflow-y-auto">
          {sections.map((section) => (
            <section key={section.id} aria-label={pickLocalized(section, 'name', locale)}>
              <h2 className="mb-3 text-lg font-semibold">
                {pickLocalized(section, 'name', locale)}
              </h2>
              <ul className="grid grid-cols-3 gap-3 md:grid-cols-5 xl:grid-cols-7">
                {section.tables.map((table) => {
                  const order = table.openOrders[0];
                  return (
                    <li key={table.id}>
                      <button
                        type="button"
                        aria-label={
                          order
                            ? `${table.label} · ${order.orderNumber}`
                            : t('pos:tables.startOrder', { table: table.label })
                        }
                        onClick={() => {
                          if (order) {
                            void navigate(`/orders?order=${order.id}`);
                          } else {
                            if (cart.editing) cart.clear();
                            cart.setTable(table.id);
                            void navigate('/order');
                          }
                        }}
                        className={cn(
                          'grid h-32 w-full content-between rounded-xl border-2 p-3 text-start',
                          order
                            ? 'border-warning bg-warning/15'
                            : 'border-success/60 bg-card hover:bg-muted',
                        )}
                      >
                        <span className="ltr-nums text-3xl font-bold">{table.label}</span>
                        <span className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Users aria-hidden className="size-4" />
                            <span className="ltr-nums">{table.seats}</span>
                          </span>
                          <Badge variant={order ? 'warning' : 'success'}>
                            {order ? order.orderNumber : t('floor:free')}
                          </Badge>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </QueryState>
  );
}
