import { useCurrentLocale } from '@pos/app-kit';
import { pickLocalized } from '@pos/i18n';
import type { PublishedMenu, PublishedMenuProduct } from '@pos/validation';
import { EmptyState, cn } from '@pos/ui';
import { Keyboard, ScanBarcode } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFocusOnMount } from '../lib/focus';
import { ProductCard } from './product-card';

/** The menu by category, as large tiles; with BARCODE, a reminder that items can be scanned. */
export function MenuScreen({
  menu,
  scanning,
  onSelect,
  onTypeCode,
}: {
  menu: PublishedMenu;
  scanning: boolean;
  onSelect: (product: PublishedMenuProduct) => void;
  onTypeCode: () => void;
}) {
  const { t } = useTranslation('kiosk');
  const locale = useCurrentLocale();
  const heading = useFocusOnMount<HTMLHeadingElement>();
  const categories = menu.categories.filter((c) => c.products.length > 0);
  const [categoryId, setCategoryId] = useState<string | null>(categories[0]?.id ?? null);
  const current = categories.find((c) => c.id === categoryId) ?? categories[0];
  return (
    <section aria-labelledby="menu-title" className="flex min-h-0 flex-1 flex-col">
      <h1 id="menu-title" ref={heading} tabIndex={-1} className="sr-only">
        {t('title')}
      </h1>
      {scanning ? (
        <div className="flex flex-wrap items-center gap-3 border-b bg-muted/40 px-5 py-3 text-lg">
          <ScanBarcode aria-hidden className="size-7 text-primary" />
          <span>{t('menu.scanHint')}</span>
          <button
            type="button"
            className="inline-flex min-h-12 items-center gap-2 rounded-lg px-3 font-semibold text-primary underline-offset-4 hover:underline"
            onClick={onTypeCode}
          >
            <Keyboard aria-hidden className="size-5" />
            {t('menu.typeCode')}
          </button>
        </div>
      ) : null}
      {categories.length === 0 ? (
        <EmptyState title={t('menu.empty')} />
      ) : (
        <div className="flex min-h-0 flex-1">
          <nav
            aria-label={t('menu.categories')}
            className="w-56 shrink-0 overflow-y-auto border-e p-3"
          >
            <ul className="grid gap-2">
              {categories.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    aria-current={c.id === current?.id ? 'true' : undefined}
                    className={cn(
                      'min-h-16 w-full rounded-xl px-4 py-3 text-start text-xl font-semibold',
                      c.id === current?.id
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-muted',
                    )}
                    onClick={() => {
                      setCategoryId(c.id);
                    }}
                  >
                    {pickLocalized(c, 'name', locale)}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {current ? (
              <>
                <h2 className="mb-4 text-3xl font-bold">
                  {pickLocalized(current, 'name', locale)}
                </h2>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-4">
                  {current.products.map((p) => (
                    <ProductCard
                      key={p.id}
                      product={p}
                      currency={menu.currencyCode}
                      onSelect={onSelect}
                    />
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
