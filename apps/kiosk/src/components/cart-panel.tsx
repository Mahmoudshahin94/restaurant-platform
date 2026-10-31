import { useCurrentLocale, useMoneyFormat } from '@pos/app-kit';
import type { OrderQuote } from '@pos/domain';
import { pickLocalized } from '@pos/i18n';
import type { PublishedMenu } from '@pos/validation';
import { Alert, Button, cn } from '@pos/ui';
import { Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CartLine } from '../stores/session';

export interface CartActions {
  setQuantity: (id: string, quantity: number) => void;
  removeLine: (id: string) => void;
}

/** What a line is called on the menu: the item, its size and options. */
export function lineName(
  menu: PublishedMenu | undefined,
  line: Pick<CartLine, 'productId' | 'variantId' | 'modifierIds'>,
  locale: 'en' | 'ar',
): { name: string; detail: string } {
  const product = menu?.categories.flatMap((c) => c.products).find((p) => p.id === line.productId);
  if (!product) return { name: '', detail: '' };
  const variant = product.variants.find((v) => v.id === line.variantId);
  const modifiers = product.modifierGroups
    .flatMap((g) => g.modifiers)
    .filter((m) => line.modifierIds.includes(m.id));
  return {
    name: pickLocalized(product, 'name', locale),
    detail: [variant, ...modifiers]
      .flatMap((item) => (item ? [pickLocalized(item, 'name', locale)] : []))
      .join(locale === 'ar' ? '، ' : ', '),
  };
}

/** The customer's order beside the menu: lines with their quantities, and the total. */
export function CartPanel({
  menu,
  lines,
  quote,
  problem,
  actions,
  onCheckout,
  editable = true,
  className,
}: {
  menu: PublishedMenu | undefined;
  lines: readonly CartLine[];
  quote: OrderQuote | null;
  problem: boolean;
  actions: CartActions;
  onCheckout?: () => void;
  editable?: boolean;
  className?: string;
}) {
  const { t } = useTranslation('kiosk');
  const locale = useCurrentLocale();
  const { format } = useMoneyFormat(menu?.currencyCode);
  const count = lines.reduce((sum, l) => sum + l.quantity, 0);
  const totals = quote?.pricing;
  return (
    <section
      aria-labelledby="cart-title"
      className={cn('surface flex min-h-0 flex-col border-s', className)}
    >
      <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
        <h2 id="cart-title" className="flex items-center gap-2 text-2xl font-bold">
          <ShoppingBag aria-hidden className="size-6" />
          {t('cart.title')}
        </h2>
        <span className="text-muted-foreground">{t('cart.items', { count })}</span>
      </div>
      <ul className="min-h-0 flex-1 divide-y overflow-y-auto" data-testid="cart-lines">
        {lines.length === 0 ? (
          <li className="p-6 text-center text-lg text-muted-foreground">{t('cart.empty')}</li>
        ) : null}
        {lines.map((line) => {
          const { name, detail } = lineName(menu, line, locale);
          const priced = quote?.lines.find((l) => l.lineId === line.id);
          return (
            <li key={line.id} className="grid gap-2 px-5 py-4">
              <div className="flex justify-between gap-3">
                <span className="grid">
                  <span className="text-lg font-semibold">{name}</span>
                  {detail ? <span className="text-muted-foreground">{detail}</span> : null}
                </span>
                <bdi className="ltr-nums shrink-0 text-lg font-semibold">
                  {priced ? format(priced.total) : ''}
                </bdi>
              </div>
              {editable ? (
                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="xl"
                    aria-label={t('cart.decrease', { name })}
                    onClick={() => {
                      actions.setQuantity(line.id, line.quantity - 1);
                    }}
                  >
                    <Minus aria-hidden className="size-5" />
                  </Button>
                  <span className="ltr-nums min-w-8 text-center text-xl font-bold">
                    {line.quantity}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="xl"
                    aria-label={t('cart.increase', { name })}
                    onClick={() => {
                      actions.setQuantity(line.id, line.quantity + 1);
                    }}
                  >
                    <Plus aria-hidden className="size-5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xl"
                    className="ms-auto"
                    aria-label={t('cart.remove', { name })}
                    onClick={() => {
                      actions.removeLine(line.id);
                    }}
                  >
                    <Trash2 aria-hidden className="size-5" />
                  </Button>
                </div>
              ) : (
                <span className="text-muted-foreground ltr-nums">× {line.quantity}</span>
              )}
            </li>
          );
        })}
      </ul>
      <div className="grid gap-3 border-t px-5 py-4">
        {problem ? <Alert variant="destructive">{t('cart.unavailable')}</Alert> : null}
        {totals ? (
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-lg">
            <dt className="text-muted-foreground">
              {menu?.taxInclusive ? t('cart.taxIncluded') : t('cart.tax')}
            </dt>
            <dd className="ltr-nums text-end text-muted-foreground">{format(totals.tax)}</dd>
            <dt className="text-2xl font-bold">{t('cart.total')}</dt>
            <dd className="ltr-nums text-end text-2xl font-bold" data-testid="cart-total">
              {format(totals.total)}
            </dd>
          </dl>
        ) : null}
        {onCheckout ? (
          <Button
            type="button"
            size="xl"
            className="h-16 text-xl"
            disabled={lines.length === 0 || problem || !quote}
            onClick={onCheckout}
          >
            {t('cart.checkout')}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
