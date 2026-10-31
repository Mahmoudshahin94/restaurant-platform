import { useCurrentLocale, useMoneyFormat } from '@pos/app-kit';
import type { OrderQuote } from '@pos/domain';
import { findMenuProduct } from '@pos/domain';
import { pickLocalized } from '@pos/i18n';
import type { PublishedMenu } from '@pos/validation';
import { Button, Dialog } from '@pos/ui';
import { Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type CartLine, useCart } from '../stores/cart';
import { joinNames } from '../lib/format';
import { ProductDialog } from './product-dialog';
import { QuantityStepper } from './quantity-stepper';

/** The cart's lines with their options, quantity and (previewed) line total. */
export function CartLines({
  menu,
  quote,
  problemLineId,
  editable = true,
}: {
  menu: PublishedMenu;
  quote: OrderQuote | null;
  /** A line the domain refused (e.g. sold out since it was added). */
  problemLineId?: string | null;
  editable?: boolean;
}) {
  const { t } = useTranslation(['customer']);
  const locale = useCurrentLocale();
  const { format } = useMoneyFormat(menu.currencyCode);
  const { lines, setQuantity, removeLine, updateLine } = useCart();
  const [editing, setEditing] = useState<CartLine | null>(null);
  const menuLike = { categories: menu.categories, taxes: menu.taxes };

  return (
    <ul className="divide-y">
      {lines.map((line) => {
        const product = findMenuProduct(menuLike, line.productId);
        const name = product ? pickLocalized(product, 'name', locale) : '';
        const variant = product?.variants.find((v) => v.id === line.variantId);
        const options = product?.modifierGroups
          .flatMap((g) => g.modifiers)
          .filter((m) => line.modifierIds.includes(m.id))
          .map((m) => pickLocalized(m, 'name', locale));
        const priced = quote?.lines.find((l) => l.lineId === line.id);
        const problem = problemLineId === line.id || !product?.isAvailable;
        return (
          <li
            key={line.id}
            className="flex flex-wrap items-start gap-3 py-3"
            data-testid="cart-line"
          >
            <div className="grid min-w-0 flex-1 gap-0.5">
              <p className="font-medium">
                {name}
                {variant ? (
                  <span className="text-muted-foreground">
                    {' '}
                    · {pickLocalized(variant, 'name', locale)}
                  </span>
                ) : null}
              </p>
              {options && options.length > 0 ? (
                <p className="text-sm text-muted-foreground">{joinNames(options, locale)}</p>
              ) : null}
              {line.notes ? (
                <p className="text-sm italic text-muted-foreground">{line.notes}</p>
              ) : null}
              {problem ? (
                <p className="text-sm font-medium text-destructive">{t('customer:menu.soldOut')}</p>
              ) : null}
            </div>
            {editable ? (
              <div className="flex items-center gap-1">
                <QuantityStepper
                  value={line.quantity}
                  min={0}
                  label={name}
                  onChange={(q) => {
                    setQuantity(line.id, q);
                  }}
                />
                {product && product.isAvailable ? (
                  <Button
                    variant="ghost"
                    size="icon-md"
                    aria-label={t('customer:cart.edit', { name })}
                    onClick={() => {
                      setEditing(line);
                    }}
                  >
                    <Pencil aria-hidden />
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="icon-md"
                  aria-label={t('customer:cart.remove', { name })}
                  onClick={() => {
                    removeLine(line.id);
                  }}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            ) : (
              <span className="ltr-nums text-sm text-muted-foreground">× {line.quantity}</span>
            )}
            <p className="ltr-nums w-24 text-end font-medium">
              {priced ? format(priced.total) : ''}
            </p>
          </li>
        );
      })}
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        {editing
          ? (() => {
              const product = findMenuProduct(menuLike, editing.productId);
              return product ? (
                <ProductDialog
                  product={product}
                  currency={menu.currencyCode}
                  initial={editing}
                  onConfirm={(line) => {
                    updateLine(editing.id, line);
                    setEditing(null);
                  }}
                />
              ) : null;
            })()
          : null}
      </Dialog>
    </ul>
  );
}
