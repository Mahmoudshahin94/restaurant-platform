import { useCurrentLocale, useFeature, useMoneyFormat } from '@pos/app-kit';
import { isDomainError, validateSelection } from '@pos/domain';
import { pickLocalized } from '@pos/i18n';
import { Feature } from '@pos/shared-types';
import type { PublishedMenuProduct } from '@pos/validation';
import {
  Button,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
  cn,
} from '@pos/ui';
import { Check } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface OptionsResult {
  variantId: string | null;
  modifierIds: string[];
  notes: string | null;
}

interface OptionsDialogProps {
  product: PublishedMenuProduct;
  currency: string;
  /** The line being edited, or a scanned variant to start from. */
  initial?: Partial<OptionsResult>;
  mode: 'add' | 'update';
  onConfirm: (result: OptionsResult) => void;
}

/**
 * Size and option picker. Validity and price come from the domain's validateSelection, the same
 * rule the server enforces, so the cashier cannot submit a selection the server would reject.
 */
export function OptionsDialog({
  product: menuProduct,
  currency,
  initial,
  mode,
  onConfirm,
}: OptionsDialogProps) {
  const { t } = useTranslation(['pos', 'common', 'orders']);
  // Without the MODIFIERS module the product is sold plain (the hub's menu has no groups then).
  const modifiersOn = useFeature(Feature.MODIFIERS);
  const product = useMemo(
    () => (modifiersOn ? menuProduct : { ...menuProduct, modifierGroups: [] }),
    [menuProduct, modifiersOn],
  );
  const locale = useCurrentLocale();
  const { format } = useMoneyFormat(currency);
  const [variantId, setVariantId] = useState<string | null>(
    initial?.variantId ?? product.variants[0]?.id ?? null,
  );
  const [modifierIds, setModifierIds] = useState<string[]>(
    initial?.modifierIds ??
      product.modifierGroups.flatMap((g) =>
        g.modifiers.filter((m) => m.isDefault).map((m) => m.id),
      ),
  );
  const [notes, setNotes] = useState(initial?.notes ?? '');

  const priced = useMemo(() => {
    try {
      return {
        ok: true as const,
        selection: validateSelection(product, { productId: product.id, variantId, modifierIds }),
      };
    } catch (error) {
      if (isDomainError(error)) return { ok: false as const };
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
      const selectedInGroup = current.filter((id) => inGroup.has(id)).length;
      if (group.maxSelect !== null && selectedInGroup >= group.maxSelect) return current;
      return [...current, modifierId];
    });
  };

  const ruleText = (min: number, max: number | null) => {
    if (min > 0 && max === min) return t('pos:options.required', { count: min });
    if (min > 0)
      return max === null
        ? t('pos:options.required', { count: min })
        : t('pos:options.between', { min, max });
    return max === null ? t('pos:options.any') : t('pos:options.upTo', { count: max });
  };

  const tile = (selected: boolean) =>
    cn(
      'flex min-h-14 items-center justify-between gap-2 rounded-lg border-2 px-4 py-2 text-start text-base font-medium transition-colors',
      selected ? 'border-primary bg-primary/10' : 'border-border bg-card hover:bg-muted',
    );

  return (
    <DialogContent closeLabel={t('common:actions.close')} className="max-w-2xl">
      <DialogHeader>
        <DialogTitle className="text-2xl">{pickLocalized(product, 'name', locale)}</DialogTitle>
      </DialogHeader>
      <div className="grid gap-5">
        {product.variants.length > 0 ? (
          <fieldset className="grid gap-2">
            <legend className="mb-2 font-semibold">{t('pos:options.size')}</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
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
                  <span className="text-sm text-muted-foreground">{format(v.price)}</span>
                </button>
              ))}
            </div>
          </fieldset>
        ) : null}
        {product.modifierGroups.map((group) => {
          const single = group.maxSelect === 1;
          return (
            <fieldset key={group.id} className="grid gap-2">
              <legend className="mb-2 flex flex-wrap items-baseline gap-2">
                <span className="font-semibold">{pickLocalized(group, 'name', locale)}</span>
                <span className="text-sm text-muted-foreground">
                  {ruleText(group.minSelect, group.maxSelect)}
                </span>
              </legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
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
                        {selected ? <Check aria-hidden className="size-4 text-primary" /> : null}
                        {pickLocalized(m, 'name', locale)}
                      </span>
                      {m.priceDelta > 0 ? (
                        <bdi className="text-sm text-muted-foreground">
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
        <label className="grid gap-1.5">
          <span className="font-semibold">{t('orders:fields.itemNotes')}</span>
          <Textarea
            rows={2}
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
            }}
          />
        </label>
      </div>
      <DialogFooter>
        <Button
          size="xl"
          className="w-full sm:w-auto"
          disabled={!priced.ok}
          onClick={() => {
            onConfirm({ variantId, modifierIds, notes: notes.trim() || null });
          }}
        >
          {priced.ok
            ? t(mode === 'add' ? 'pos:options.add' : 'pos:options.update', {
                price: format(priced.selection.unitPrice),
              })
            : t('pos:options.incomplete')}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
