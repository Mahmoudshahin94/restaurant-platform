import {
  QueryState,
  type ScanEvent,
  useBarcodeScanner,
  useCurrentLocale,
  useFeature,
} from '@pos/app-kit';
import { lookupCode } from '@pos/domain';
import { pickLocalized } from '@pos/i18n';
import { Feature } from '@pos/shared-types';
import type { PublishedMenu, PublishedMenuProduct } from '@pos/validation';
import { Dialog } from '@pos/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BarcodeEntryDialog } from '../components/barcode-entry-dialog';
import { CartPanel } from '../components/cart-panel';
import { OptionsDialog, type OptionsResult } from '../components/options-dialog';
import { ProductGrid } from '../components/product-grid';
import { type ScanNotice, ScanToast } from '../components/scan-toast';
import { useDiscounts, useFloor, useLocationId, useLocationMenu } from '../lib/queries';
import { api } from '../lib/session';
import { useCart } from '../stores/cart';
import { usePreferences } from '../stores/preferences';

type Picking = {
  product: PublishedMenuProduct;
  lineId: string | null;
  /** A scanned variant the dialog starts from, and the code that was scanned. */
  variantId?: string | null;
  barcode?: string;
};

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
  const { t } = useTranslation('pos');
  const locale = useCurrentLocale();
  const barcodesOn = useFeature(Feature.BARCODE);
  const showPictures = usePreferences((p) => p.showPictures);
  const [entering, setEntering] = useState(false);
  const [notice, setNotice] = useState<ScanNotice | null>(null);
  const noticeKey = useRef(0);
  const notify = (kind: ScanNotice['kind'], text: string) => {
    noticeKey.current += 1;
    setNotice({ kind, text, key: noticeKey.current });
  };
  const dismissNotice = useCallback(() => {
    setNotice(null);
  }, []);

  useEffect(() => {
    cart.ensureLocation(locationId);
  }, [cart, locationId]);

  /**
   * A scanned or typed code (ADR 0021), looked up in this till's copy of the menu, so scanning
   * works with the hub's link to the cloud down. The item goes straight into the cart with its
   * default options, unless it has a choice to make first (a required modifier group).
   */
  const scan = (menu: PublishedMenu | undefined, { code }: ScanEvent) => {
    if (!menu) return;
    const match = lookupCode(menu, code);
    if (!match) {
      notify('error', t('scan.unknown', { code }));
      return;
    }
    const { product, variant } = match;
    const name = [product, ...(variant ? [variant] : [])]
      .map((item) => pickLocalized(item, 'name', locale))
      .join(' · ');
    if (!product.isAvailable) {
      notify('error', t('scan.soldOut', { name }));
      return;
    }
    const barcode = match.matchedBy === 'BARCODE' ? match.code : null;
    const variantId = variant?.id ?? null;
    const groups = modifiersOn ? product.modifierGroups : [];
    // Scanning keeps the till moving: only a choice the item needs stops it.
    if (groups.some((g) => g.minSelect > 0) || (product.variants.length > 0 && !variant)) {
      setPicking({ product, lineId: null, variantId, ...(barcode ? { barcode } : {}) });
      return;
    }
    const modifierIds = groups.flatMap((g) =>
      g.modifiers.filter((m) => m.isDefault).map((m) => m.id),
    );
    cart.addLine({ productId: product.id, variantId, modifierIds, barcode });
    notify('ok', t('scan.added', { name }));
  };
  const scanner = useBarcodeScanner(
    (event) => {
      scan(menu.data, event);
    },
    { enabled: barcodesOn && picking === null && !entering },
  );

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
      // A scanned code stays with its line unless another variant was chosen.
      const barcode =
        picking.barcode && config.variantId === picking.variantId ? picking.barcode : null;
      const lineId = cart.addLine({ productId: picking.product.id, ...config, barcode });
      if (notes) cart.updateLine(lineId, { notes });
    }
    setPicking(null);
  };

  const editingLine = picking?.lineId ? cart.lines.find((l) => l.id === picking.lineId) : undefined;

  return (
    <QueryState query={menu}>
      {(data) => (
        <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)] gap-3">
          <ProductGrid
            menu={data}
            onSelect={select}
            pictureUrl={showPictures ? api.hub.mediaUrl : undefined}
            {...(barcodesOn
              ? {
                  onEnterCode: () => {
                    setEntering(true);
                  },
                }
              : {})}
          />
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
                    : picking.variantId
                      ? { variantId: picking.variantId }
                      : undefined
                }
                onConfirm={confirm}
              />
            ) : null}
          </Dialog>
          <Dialog open={entering} onOpenChange={setEntering}>
            {entering ? (
              <BarcodeEntryDialog
                onSubmit={(code) => {
                  setEntering(false);
                  return scanner.submit(code);
                }}
              />
            ) : null}
          </Dialog>
          <ScanToast key={notice?.key} notice={notice} onDismiss={dismissNotice} />
        </div>
      )}
    </QueryState>
  );
}
