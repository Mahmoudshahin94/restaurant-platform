import { useCurrentLocale, useMoneyFormat } from '@pos/app-kit';
import { isDomainError, validateSelection } from '@pos/domain';
import { pickLocalized } from '@pos/i18n';
import type { PublishedMenuProduct } from '@pos/validation';
import {
  Button,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  cn,
} from '@pos/ui';
import { Check, Minus, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ProductPicture } from './product-picture';
import { useTranslation } from 'react-i18next';

export interface OptionsChoice {
  variantId: string | null;
  modifierIds: string[];
  quantity: number;
}

/**
 * Size and options of one item, as large touch targets. What can be added and at what price comes
 * from the domain's `validateSelection`, the rule the server applies to the order.
 */
export function OptionsDialog({
  product,
  currency,
  initialVariantId = null,
  onConfirm,
}: {
  product: PublishedMenuProduct;
  currency: string;
  initialVariantId?: string | null;
  onConfirm: (choice: OptionsChoice) => void;
}) {
  const { t } = useTranslation(['kiosk', 'common']);
  const locale = useCurrentLocale();
  const { format } = useMoneyFormat(currency);
  const [variantId, setVariantId] = useState<string | null>(
    initialVariantId ?? product.variants[0]?.id ?? null,
  );
  const [modifierIds, setModifierIds] = useState<string[]>(() =>
    product.modifierGroups.flatMap((g) => g.modifiers.filter((m) => m.isDefault).map((m) => m.id)),
  );
  const [quantity, setQuantity] = useState(1);

  const priced = useMemo(() => {
    try {
      return validateSelection(product, { productId: product.id, variantId, modifierIds });
    } catch (error) {
      if (isDomainError(error)) return null;
      throw error;
    }
  }, [product, variantId, modifierIds]);

  const toggle = (groupId: string, modifierId: string, single: boolean) => {
    const group = product.modifierGroups.find((g) => g.id === groupId);
    if (!group) return;
    const inGroup = new Set(group.modifiers.map((m) => m.id));
    setModifierIds((current) => {
      if (current.includes(modifierId)) return current.filter((id) => id !== modifierId);
      if (single) return [...current.filter((id) => !inGroup.has(id)), modifierId];
      const chosen = current.filter((id) => inGroup.has(id)).length;
      if (group.maxSelect !== null && chosen >= group.maxSelect) return current;
      return [...current, modifierId];
    });
  };

  const rule = (min: number, max: number | null) => {
    if (min > 0 && max === min) return t('kiosk:options.required', { count: min });
    if (min > 0) {
      return max === null
        ? t('kiosk:options.required', { count: min })
        : t('kiosk:options.between', { min, max });
    }
    return max === null ? t('kiosk:options.any') : t('kiosk:options.upTo', { count: max });
  };
  const tile = (selected: boolean) =>
    cn(
      'flex min-h-16 items-center justify-between gap-3 rounded-xl border-2 px-5 py-3 text-start text-lg font-medium',
      selected ? 'border-primary bg-primary/10' : 'border-border bg-card',
    );
  const description = pickLocalized(product, 'description', locale);
  // The chosen variant's own picture (a colour, a size), else the product's cover.
  const picture =
    product.variants.find((v) => v.id === variantId)?.imageFileId ?? product.imageFileId;

  return (
    <DialogContent
      closeLabel={t('common:actions.close')}
      className="max-h-[90vh] max-w-3xl overflow-y-auto"
    >
      <ProductPicture fileId={picture} className="aspect-[16/9] w-full rounded-xl" />
      <DialogHeader>
        <DialogTitle className="text-3xl">{pickLocalized(product, 'name', locale)}</DialogTitle>
        {description ? (
          <DialogDescription className="text-lg">{description}</DialogDescription>
        ) : null}
      </DialogHeader>
      <div className="grid gap-6">
        {product.variants.length > 0 ? (
          <fieldset className="grid gap-3">
            <legend className="mb-2 text-xl font-semibold">{t('kiosk:options.choose')}</legend>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {product.variants.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  role="radio"
                  aria-checked={variantId === v.id}
                  className={tile(variantId === v.id)}
                  onClick={() => {
                    setVariantId(v.id);
                  }}
                >
                  <span>{pickLocalized(v, 'name', locale)}</span>
                  <bdi className="text-base text-muted-foreground">{format(v.price)}</bdi>
                </button>
              ))}
            </div>
          </fieldset>
        ) : null}
        {product.modifierGroups.map((group) => {
          const single = group.maxSelect === 1;
          return (
            <fieldset key={group.id} className="grid gap-3">
              <legend className="mb-2 flex flex-wrap items-baseline gap-3">
                <span className="text-xl font-semibold">
                  {pickLocalized(group, 'name', locale)}
                </span>
                <span className="text-muted-foreground">
                  {rule(group.minSelect, group.maxSelect)}
                </span>
              </legend>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                {group.modifiers.map((m) => {
                  const selected = modifierIds.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      role={single ? 'radio' : 'checkbox'}
                      aria-checked={selected}
                      className={tile(selected)}
                      onClick={() => {
                        toggle(group.id, m.id, single);
                      }}
                    >
                      <span className="flex items-center gap-2">
                        {selected ? <Check aria-hidden className="size-5 text-primary" /> : null}
                        {pickLocalized(m, 'name', locale)}
                      </span>
                      {m.priceDelta > 0 ? (
                        <bdi className="text-base text-muted-foreground">
                          {format(m.priceDelta, { sign: 'exceptZero' })}
                        </bdi>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          );
        })}
        <div
          className="flex items-center justify-center gap-6"
          role="group"
          aria-label={t('kiosk:options.quantity')}
        >
          <Button
            type="button"
            variant="outline"
            size="xl"
            aria-label={t('kiosk:cart.decrease', { name: pickLocalized(product, 'name', locale) })}
            disabled={quantity <= 1}
            onClick={() => {
              setQuantity((q) => Math.max(1, q - 1));
            }}
          >
            <Minus aria-hidden className="size-6" />
          </Button>
          <output className="ltr-nums min-w-12 text-center text-3xl font-bold" aria-live="polite">
            {quantity}
          </output>
          <Button
            type="button"
            variant="outline"
            size="xl"
            aria-label={t('kiosk:cart.increase', { name: pickLocalized(product, 'name', locale) })}
            disabled={quantity >= 99}
            onClick={() => {
              setQuantity((q) => Math.min(99, q + 1));
            }}
          >
            <Plus aria-hidden className="size-6" />
          </Button>
        </div>
      </div>
      <DialogFooter>
        <Button
          type="button"
          size="xl"
          className="h-16 w-full text-xl"
          disabled={!priced}
          onClick={() => {
            onConfirm({ variantId, modifierIds, quantity });
          }}
        >
          {priced
            ? t('kiosk:options.add', { price: format(priced.unitPrice * quantity) })
            : t('kiosk:options.incomplete')}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
