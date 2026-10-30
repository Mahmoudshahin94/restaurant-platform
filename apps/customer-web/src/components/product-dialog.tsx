import { useCurrentLocale, useMoneyFormat } from '@pos/app-kit';
import { isDomainError, multiplyMinor, validateSelection } from '@pos/domain';
import { pickLocalized } from '@pos/i18n';
import type { PublishedMenuProduct } from '@pos/validation';
import {
  Button,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
  cn,
} from '@pos/ui';
import { Check } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NewLine } from '../stores/cart';
import { ProductPicture } from './product-picture';
import { QuantityStepper } from './quantity-stepper';

interface ProductDialogProps {
  product: PublishedMenuProduct;
  currency: string;
  /** When editing a cart line. */
  initial?: NewLine;
  onConfirm: (line: NewLine) => void;
}

/**
 * Size, options, quantity and notes for one product. Whether the choice is complete and what it
 * costs come from the domain's `validateSelection`, the rule the cloud enforces, so the customer
 * cannot send a selection the tenant would refuse.
 */
export function ProductDialog({ product, currency, initial, onConfirm }: ProductDialogProps) {
  const { t } = useTranslation(['customer', 'common']);
  const locale = useCurrentLocale();
  const { format } = useMoneyFormat(currency);
  const notesId = useId();
  const [variantId, setVariantId] = useState<string | null>(
    initial?.variantId ?? product.variants[0]?.id ?? null,
  );
  const [modifierIds, setModifierIds] = useState<string[]>(
    initial?.modifierIds ??
      product.modifierGroups.flatMap((g) =>
        g.modifiers.filter((m) => m.isDefault).map((m) => m.id),
      ),
  );
  const [quantity, setQuantity] = useState(initial?.quantity ?? 1);
  const [notes, setNotes] = useState(initial?.notes ?? '');

  const unitPrice = useMemo(() => {
    try {
      return validateSelection(product, { productId: product.id, variantId, modifierIds })
        .unitPrice;
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
    if (min > 0 && max === min) return t('customer:product.choose', { n: min });
    if (min > 0 && max !== null) return t('customer:product.between', { min, max });
    if (min > 0) return t('customer:product.choose', { n: min });
    return max === null ? t('customer:product.optional') : t('customer:product.upTo', { max });
  };

  const option = (selected: boolean) =>
    cn(
      'flex min-h-12 items-center justify-between gap-3 rounded-lg border-2 px-4 py-2 text-start transition-colors',
      selected ? 'border-primary bg-primary/10' : 'border-border bg-card hover:bg-muted',
    );
  const description = pickLocalized(product, 'description', locale);
  // The chosen variant's own picture (a colour, a size), else the product's cover.
  const picture =
    product.variants.find((v) => v.id === variantId)?.imageFileId ?? product.imageFileId;

  return (
    <DialogContent closeLabel={t('common:actions.close')} className="max-w-xl">
      <ProductPicture fileId={picture} className="aspect-[16/9] w-full rounded-lg" />
      <DialogHeader>
        <DialogTitle className="text-xl">{pickLocalized(product, 'name', locale)}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
      </DialogHeader>
      <div className="grid gap-5">
        {product.variants.length > 0 ? (
          <fieldset className="grid gap-2">
            <legend className="mb-1 font-semibold">{t('customer:product.size')}</legend>
            {product.variants.map((v) => (
              <button
                key={v.id}
                type="button"
                role="radio"
                aria-checked={variantId === v.id}
                className={option(variantId === v.id)}
                onClick={() => {
                  setVariantId(v.id);
                }}
              >
                <span>{pickLocalized(v, 'name', locale)}</span>
                <bdi className="text-sm text-muted-foreground">{format(v.price)}</bdi>
              </button>
            ))}
          </fieldset>
        ) : null}
        {product.modifierGroups.map((group) => {
          const single = group.maxSelect === 1;
          return (
            <fieldset key={group.id} className="grid gap-2">
              <legend className="mb-1 flex flex-wrap items-baseline gap-2">
                <span className="font-semibold">{pickLocalized(group, 'name', locale)}</span>
                <span className="text-sm text-muted-foreground">
                  {rule(group.minSelect, group.maxSelect)}
                </span>
              </legend>
              {group.modifiers.map((m) => {
                const selected = modifierIds.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    role={single ? 'radio' : 'checkbox'}
                    aria-checked={selected}
                    className={option(selected)}
                    onClick={() => {
                      toggle(group.id, m.id, single);
                    }}
                  >
                    <span className="flex items-center gap-2">
                      {selected ? <Check aria-hidden className="size-4 text-primary" /> : null}
                      {pickLocalized(m, 'name', locale)}
                    </span>
                    {m.priceDelta !== 0 ? (
                      <bdi className="text-sm text-muted-foreground">
                        {format(m.priceDelta, { sign: 'exceptZero' })}
                      </bdi>
                    ) : null}
                  </button>
                );
              })}
            </fieldset>
          );
        })}
        <div className="grid gap-1.5">
          <label htmlFor={notesId} className="font-semibold">
            {t('customer:product.notes')}
          </label>
          <Textarea
            id={notesId}
            rows={2}
            maxLength={500}
            placeholder={t('customer:product.notesPlaceholder')}
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
            }}
          />
        </div>
      </div>
      <DialogFooter className="items-center gap-3 sm:justify-between">
        <QuantityStepper value={quantity} onChange={setQuantity} />
        <Button
          size="lg"
          className="w-full sm:w-auto"
          disabled={unitPrice === null}
          onClick={() => {
            onConfirm({
              productId: product.id,
              variantId,
              modifierIds,
              quantity,
              notes: notes.trim() || null,
            });
          }}
        >
          {unitPrice === null
            ? t('customer:product.incomplete')
            : t(initial ? 'customer:product.update' : 'customer:product.add', {
                price: format(multiplyMinor(unitPrice, quantity)),
              })}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
