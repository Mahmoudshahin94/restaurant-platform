import { QueryState, useFeature } from '@pos/app-kit';
import { Feature } from '@pos/shared-types';
import type { PublishedMenuProduct } from '@pos/validation';
import { Dialog } from '@pos/ui';
import { useEffect, useState } from 'react';
import { CartPanel } from '../components/cart-panel';
import { OptionsDialog, type OptionsResult } from '../components/options-dialog';
import { ProductGrid } from '../components/product-grid';
import { useDiscounts, useFloor, useLocationId, useLocationMenu } from '../lib/queries';
import { useCart } from '../stores/cart';

type Picking = { product: PublishedMenuProduct; lineId: string | null };

/** Fast order entry: menu on the start side, the current order on the end side. */
export function OrderPage() {
  const locationId = useLocationId();
  const menu = useLocationMenu(locationId);
  const discounts = useDiscounts();
  const tablesOn = useFeature(Feature.TABLES);
  const modifiersOn = useFeature(Feature.MODIFIERS);
  const floor = useFloor(locationId, tablesOn);
  const cart = useCart();
  const [picking, setPicking] = useState<Picking | null>(null);

  useEffect(() => {
    cart.ensureLocation(locationId);
  }, [cart, locationId]);

  const select = (product: PublishedMenuProduct) => {
    const groups = modifiersOn ? product.modifierGroups : [];
    if (product.variants.length === 0 && groups.length === 0) {
      cart.addLine({ productId: product.id, variantId: null, modifierIds: [] });
    } else {
      setPicking({ product, lineId: null });
    }
  };

  const confirm = (result: OptionsResult) => {
    if (!picking) return;
    if (picking.lineId) {
      cart.updateLine(picking.lineId, result);
    } else {
      const { notes, ...config } = result;
      cart.addLine({ productId: picking.product.id, ...config });
      if (notes) {
        const added = useCart.getState().lines.at(-1);
        if (added) cart.updateLine(added.id, { notes });
      }
    }
    setPicking(null);
  };

  const editingLine = picking?.lineId ? cart.lines.find((l) => l.id === picking.lineId) : undefined;

  return (
    <QueryState query={menu}>
      {(data) => (
        <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)] gap-3">
          <ProductGrid menu={data} onSelect={select} />
          <CartPanel
            locationId={locationId}
            menu={data}
            discounts={discounts.data ?? []}
            floor={floor.data ?? []}
            onEditLine={(lineId, product) => {
              setPicking({ product, lineId });
            }}
          />
          <Dialog
            open={picking !== null}
            onOpenChange={(open) => {
              if (!open) setPicking(null);
            }}
          >
            {picking ? (
              <OptionsDialog
                key={picking.lineId ?? picking.product.id}
                product={picking.product}
                currency={data.currencyCode}
                mode={picking.lineId ? 'update' : 'add'}
                initial={
                  editingLine
                    ? {
                        variantId: editingLine.variantId,
                        modifierIds: editingLine.modifierIds,
                        notes: editingLine.notes,
                      }
                    : undefined
                }
                onConfirm={confirm}
              />
            ) : null}
          </Dialog>
        </div>
      )}
    </QueryState>
  );
}
