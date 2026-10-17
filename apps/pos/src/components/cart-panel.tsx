import { isApiError } from '@pos/api-client';
import {
  tKey,
  useCurrentLocale,
  useErrorText,
  useMoneyFormat,
  usePermissionChecks,
} from '@pos/app-kit';
import { findMenuProduct } from '@pos/domain';
import { pickLocalized } from '@pos/i18n';
import type {
  Discount,
  Order,
  PublishedMenu,
  PublishedMenuProduct,
  TableSection,
} from '@pos/validation';
import { Alert, Button, Input, NativeSelect, cn } from '@pos/ui';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOrderMutation } from '../lib/queries';
import { OrderPaymentDialogs } from '../routes/orders-page';
import { useCartQuote } from '../lib/quote';
import { api, useSession } from '../lib/session';
import { STAFF_CHANNELS, cartToRequest, useCart } from '../stores/cart';

export const PLACE_ORDER_EVENT = 'pos:place-order';

interface CartPanelProps {
  locationId: string;
  menu: PublishedMenu;
  discounts: Discount[];
  floor: TableSection[];
  onEditLine: (lineId: string, product: PublishedMenuProduct) => void;
}

export function CartPanel({ locationId, menu, discounts, floor, onEditLine }: CartPanelProps) {
  const { t } = useTranslation(['pos', 'orders', 'common', 'payments']);
  const locale = useCurrentLocale();
  const errorText = useErrorText();
  const { format } = useMoneyFormat(menu.currencyCode);
  const user = useSession((s) => s.user);
  const { canAt } = usePermissionChecks(user);
  const cart = useCart();
  const { quote, error: quoteError } = useCartQuote(menu, cart.lines, cart.discountIds, discounts);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [placed, setPlaced] = useState<Order | null>(null);
  const [paying, setPaying] = useState<'pay' | 'receipt' | null>(null);

  const submit = useOrderMutation(async () => {
    const body = cartToRequest(cart);
    if (cart.editing) {
      return {
        order: await api.orders.update(locationId, cart.editing.orderId, {
          ...body,
          version: cart.editing.version,
        }),
        edited: true,
      };
    }
    return {
      // Orders entered at the POS are accepted at once and go straight to the kitchen.
      order: await api.orders.create(locationId, {
        ...body,
        id: cart.draftId,
        status: 'CONFIRMED',
      }),
      edited: false,
    };
  });

  const place = async () => {
    if (!quote || submit.isPending) return;
    setMessage(null);
    try {
      const { order, edited } = await submit.mutateAsync(undefined);
      cart.clear();
      setPlaced(order);
      setMessage({
        kind: 'ok',
        text: t(edited ? 'pos:cart.saved' : 'pos:cart.placed', { number: order.orderNumber }),
      });
    } catch (error) {
      const reason = isApiError(error) ? (error.details.reason as string | undefined) : undefined;
      if (reason === 'STALE_VERSION' && cart.editing) {
        // Someone else changed the order: reload it so the cashier edits the latest version.
        const latest = await api.orders.get(locationId, cart.editing.orderId);
        cart.loadOrder(latest);
      }
      setMessage({
        kind: 'error',
        text: reason ? tKey(t, `orders:reasons.${reason}`) : errorText(error),
      });
    }
  };

  useEffect(() => {
    const handler = () => void place();
    window.addEventListener(PLACE_ORDER_EVENT, handler);
    return () => {
      window.removeEventListener(PLACE_ORDER_EVENT, handler);
    };
  });

  const tables = floor.flatMap((s) =>
    s.tables.map((table) => ({ ...table, section: pickLocalized(s, 'name', locale) })),
  );
  const needsTable = cart.channel === 'DINE_IN' && !cart.tableId;
  const needsCustomer =
    (cart.channel === 'PHONE' || cart.channel === 'DELIVERY') &&
    !cart.customerName.trim() &&
    !cart.customerPhone.trim();
  const canDiscount = canAt(locationId, 'orders.discount');
  const canPlace = quote !== null && !needsTable && !needsCustomer && !submit.isPending;
  const invalidLineId =
    typeof quoteError?.details.lineId === 'string' ? quoteError.details.lineId : null;

  return (
    <section
      aria-label={t('pos:cart.title')}
      className="flex h-full min-h-0 flex-col rounded-xl border bg-card"
    >
      <header className="flex items-center justify-between gap-2 border-b p-3">
        <h2 className="text-lg font-semibold">
          {cart.editing
            ? t('pos:cart.editing', { number: cart.editing.orderNumber })
            : t('pos:cart.title')}
        </h2>
        {cart.lines.length > 0 || cart.editing ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              cart.clear();
              setMessage(null);
            }}
          >
            {t('orders:actions.clear')}
          </Button>
        ) : null}
      </header>

      <div className="grid gap-3 border-b p-3">
        <div
          role="radiogroup"
          aria-label={t('orders:fields.channel')}
          className="grid grid-cols-4 gap-1"
        >
          {STAFF_CHANNELS.map((channel) => (
            <button
              key={channel}
              type="button"
              role="radio"
              aria-checked={cart.channel === channel}
              onClick={() => {
                cart.setChannel(channel);
              }}
              className={cn(
                'h-12 rounded-lg border text-sm font-medium',
                cart.channel === channel
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'bg-card hover:bg-muted',
              )}
            >
              {t(`orders:channel.${channel}`)}
            </button>
          ))}
        </div>
        {cart.channel === 'DINE_IN' ? (
          <div className="grid grid-cols-[1fr_6rem] gap-2">
            <NativeSelect
              aria-label={t('orders:fields.table')}
              className="h-12 text-base"
              value={cart.tableId ?? ''}
              onChange={(e) => {
                cart.setTable(e.target.value || null);
              }}
            >
              <option value="">{t('pos:cart.chooseTable')}</option>
              {tables.map((table) => (
                <option key={table.id} value={table.id}>
                  {table.label} · {table.section}
                </option>
              ))}
            </NativeSelect>
            <Input
              aria-label={t('orders:fields.guestCount')}
              placeholder={t('orders:fields.guestCount')}
              type="number"
              inputMode="numeric"
              min={1}
              dir="ltr"
              className="h-12 text-base"
              value={cart.guestCount ?? ''}
              onChange={(e) => {
                cart.setDetails({
                  guestCount: e.target.value ? Math.max(1, Number(e.target.value)) : null,
                });
              }}
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Input
              aria-label={t('orders:fields.customerName')}
              placeholder={t('orders:fields.customerName')}
              className="h-12 text-base"
              value={cart.customerName}
              onChange={(e) => {
                cart.setDetails({ customerName: e.target.value });
              }}
            />
            <Input
              aria-label={t('orders:fields.customerPhone')}
              placeholder={t('orders:fields.customerPhone')}
              type="tel"
              dir="ltr"
              className="h-12 text-base"
              value={cart.customerPhone}
              onChange={(e) => {
                cart.setDetails({ customerPhone: e.target.value });
              }}
            />
          </div>
        )}
      </div>

      <ol className="min-h-0 flex-1 overflow-y-auto">
        {cart.lines.length === 0 ? (
          <li className="p-8 text-center text-muted-foreground">{t('pos:cart.empty')}</li>
        ) : null}
        {cart.lines.map((line) => {
          const product = findMenuProduct(menu, line.productId);
          const priced = quote?.lines.find((l) => l.lineId === line.id);
          const name = product ? pickLocalized(product, 'name', locale) : '—';
          const variant = product?.variants.find((v) => v.id === line.variantId);
          const modifiers =
            product?.modifierGroups
              .flatMap((g) => g.modifiers)
              .filter((m) => line.modifierIds.includes(m.id)) ?? [];
          return (
            <li
              key={line.id}
              className={cn(
                'grid gap-2 border-b p-3',
                invalidLineId === line.id && 'bg-destructive/10',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  className="grid flex-1 text-start"
                  aria-label={t('pos:cart.editLine', { name })}
                  disabled={!product}
                  onClick={() => {
                    if (product) onEditLine(line.id, product);
                  }}
                >
                  <span className="font-medium">
                    {name}
                    {variant ? ` · ${pickLocalized(variant, 'name', locale)}` : ''}
                  </span>
                  {modifiers.length > 0 ? (
                    <span className="text-sm text-muted-foreground">
                      {modifiers.map((m) => pickLocalized(m, 'name', locale)).join('، ')}
                    </span>
                  ) : null}
                  {line.notes ? (
                    <span className="text-sm italic text-muted-foreground">{line.notes}</span>
                  ) : null}
                </button>
                <span className="whitespace-nowrap font-medium">
                  {priced ? format(priced.gross) : ''}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  className="size-11"
                  aria-label={t('pos:cart.decrease', { name })}
                  onClick={() => {
                    cart.setQuantity(line.id, line.quantity - 1);
                  }}
                >
                  <Minus aria-hidden />
                </Button>
                <span
                  className="ltr-nums min-w-8 text-center text-lg font-semibold"
                  aria-live="polite"
                >
                  {line.quantity}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-11"
                  aria-label={t('pos:cart.increase', { name })}
                  onClick={() => {
                    cart.setQuantity(line.id, line.quantity + 1);
                  }}
                >
                  <Plus aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="ms-auto size-11"
                  aria-label={t('pos:cart.remove', { name })}
                  onClick={() => {
                    cart.removeLine(line.id);
                  }}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            </li>
          );
        })}
      </ol>

      <footer className="grid gap-3 border-t p-3">
        {canDiscount && discounts.length > 0 ? (
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('pos:cart.discounts')}>
            {discounts.map((d) => {
              const active = cart.discountIds.includes(d.id);
              return (
                <button
                  key={d.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    cart.toggleDiscount(d.id);
                  }}
                  className={cn(
                    'h-10 rounded-full border px-4 text-sm',
                    active ? 'border-primary bg-primary/10 font-semibold' : 'hover:bg-muted',
                  )}
                >
                  {pickLocalized(d, 'name', locale)}
                </button>
              );
            })}
          </div>
        ) : null}
        <Input
          aria-label={t('orders:fields.notes')}
          placeholder={t('orders:fields.notes')}
          className="h-11"
          value={cart.notes}
          onChange={(e) => {
            cart.setDetails({ notes: e.target.value });
          }}
        />
        {quoteError ? <Alert variant="destructive">{errorText(quoteError)}</Alert> : null}
        {message ? (
          <Alert
            variant={message.kind === 'error' ? 'destructive' : 'info'}
            aria-live="polite"
            action={
              message.kind === 'ok' &&
              placed &&
              placed.balanceDue > 0 &&
              canAt(locationId, 'payments.create') ? (
                <Button
                  size="sm"
                  onClick={() => {
                    setPaying('pay');
                  }}
                >
                  {t('payments:takePayment')}
                </Button>
              ) : null
            }
          >
            {message.text}
          </Alert>
        ) : null}
        {placed ? (
          <OrderPaymentDialogs
            order={placed}
            dialog={paying}
            setDialog={(d) => {
              setPaying(d === 'pay' || d === 'receipt' ? d : null);
            }}
          />
        ) : null}
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
          <dt>{t('orders:totals.subtotal')}</dt>
          <dd className="text-end">{format(quote?.pricing.subtotal ?? 0)}</dd>
          {quote && quote.pricing.discount > 0 ? (
            <>
              <dt>{t('orders:totals.discount')}</dt>
              <dd className="text-end">{format(-quote.pricing.discount)}</dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">
            {menu.taxInclusive ? t('orders:totals.taxIncluded') : t('orders:totals.tax')}
          </dt>
          <dd className="text-end text-muted-foreground">{format(quote?.pricing.tax ?? 0)}</dd>
          <dt className="text-xl font-bold">{t('orders:totals.total')}</dt>
          <dd className="text-end text-xl font-bold" data-testid="cart-total">
            {format(quote?.pricing.total ?? 0)}
          </dd>
        </dl>
        <Button
          size="touch"
          className="w-full text-xl"
          disabled={!canPlace}
          onClick={() => void place()}
        >
          {cart.editing ? t('orders:actions.saveChanges') : t('orders:actions.place')}
        </Button>
        <p className="text-center text-xs text-muted-foreground">{t('pos:cart.previewNote')}</p>
      </footer>
    </section>
  );
}
