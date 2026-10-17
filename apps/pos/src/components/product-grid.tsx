import { useCurrentLocale, useMoneyFormat } from '@pos/app-kit';
import { pickLocalized } from '@pos/i18n';
import type { PublishedMenu, PublishedMenuProduct } from '@pos/validation';
import { Badge, EmptyState, Input, cn } from '@pos/ui';
import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export const FOCUS_SEARCH_EVENT = 'pos:focus-search';

interface ProductGridProps {
  menu: PublishedMenu;
  onSelect: (product: PublishedMenuProduct) => void;
}

/** Category tabs, quick search and large product tiles (touch-first). */
export function ProductGrid({ menu, onSelect }: ProductGridProps) {
  const { t } = useTranslation('pos');
  const locale = useCurrentLocale();
  const { format } = useMoneyFormat(menu.currencyCode);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focus = () => searchRef.current?.focus();
    window.addEventListener(FOCUS_SEARCH_EVENT, focus);
    return () => {
      window.removeEventListener(FOCUS_SEARCH_EVENT, focus);
    };
  }, []);

  const products = useMemo(() => {
    const term = search.trim().toLowerCase();
    return menu.categories
      .filter((c) => term !== '' || categoryId === null || c.id === categoryId)
      .flatMap((c) => c.products)
      .filter(
        (p) =>
          term === '' ||
          p.nameEn.toLowerCase().includes(term) ||
          p.nameAr.includes(term) ||
          (p.sku?.toLowerCase().includes(term) ?? false),
      );
  }, [menu, categoryId, search]);

  const tab = (active: boolean) =>
    cn(
      'h-12 shrink-0 rounded-full px-5 text-base font-medium transition-colors',
      active
        ? 'bg-primary text-primary-foreground'
        : 'bg-card text-foreground hover:bg-muted border',
    );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          ref={searchRef}
          type="search"
          className="h-12 ps-11 text-base"
          aria-label={t('menu.search')}
          placeholder={`${t('menu.search')}  /`}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setSearch('');
            if (e.key === 'Enter' && products[0]?.isAvailable) onSelect(products[0]);
          }}
        />
      </div>
      <div role="tablist" className="flex gap-2 overflow-x-auto pb-1">
        <button
          type="button"
          role="tab"
          aria-selected={categoryId === null}
          className={tab(categoryId === null)}
          onClick={() => {
            setCategoryId(null);
          }}
        >
          {t('menu.all')}
        </button>
        {menu.categories.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={categoryId === c.id}
            className={tab(categoryId === c.id)}
            onClick={() => {
              setCategoryId(c.id);
            }}
          >
            {pickLocalized(c, 'name', locale)}
          </button>
        ))}
      </div>
      {products.length === 0 ? (
        <EmptyState title={t('menu.noResults')} />
      ) : (
        <ul className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-3 overflow-y-auto pb-2 md:grid-cols-3 xl:grid-cols-4">
          {products.map((p) => {
            const minVariant =
              p.variants.length > 0 ? Math.min(...p.variants.map((v) => v.price)) : null;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={!p.isAvailable}
                  onClick={() => {
                    onSelect(p);
                  }}
                  className="flex h-full min-h-28 w-full flex-col justify-between gap-2 rounded-xl border-2 bg-card p-4 text-start shadow-sm transition-colors hover:border-primary active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="text-lg font-semibold leading-snug">
                    {pickLocalized(p, 'name', locale)}
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    <span className="whitespace-nowrap text-base text-muted-foreground">
                      {format(minVariant ?? p.price)}
                    </span>
                    {p.isAvailable ? null : (
                      <Badge variant="destructive">{t('menu.soldOut')}</Badge>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
