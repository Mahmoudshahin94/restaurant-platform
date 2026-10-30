import { useCurrentLocale, useMoneyFormat } from '@pos/app-kit';
import { pickLocalized } from '@pos/i18n';
import type { PublishedMenuProduct } from '@pos/validation';
import { cn } from '@pos/ui';
import { useTranslation } from 'react-i18next';
import { ProductPicture } from './product-picture';

/**
 * One item of the menu, as a large button: its picture (when it has one), name, price (or "from"
 * price) and availability.
 */
export function ProductCard({
  product,
  currency,
  onSelect,
}: {
  product: PublishedMenuProduct;
  currency: string;
  onSelect: (product: PublishedMenuProduct) => void;
}) {
  const { t } = useTranslation('kiosk');
  const locale = useCurrentLocale();
  const { format } = useMoneyFormat(currency);
  const prices = product.variants.map((v) => v.price);
  const price =
    prices.length > 0
      ? t('menu.from', { price: format(Math.min(...prices)) })
      : format(product.price);
  const description = pickLocalized(product, 'description', locale);
  return (
    <button
      type="button"
      aria-disabled={!product.isAvailable}
      onClick={() => {
        if (product.isAvailable) onSelect(product);
      }}
      className={cn(
        'surface flex min-h-40 flex-col justify-between gap-3 overflow-hidden rounded-2xl border-2 p-5 text-start transition-transform outline-offset-2 focus-visible:outline-4 active:scale-[0.98]',
        product.isAvailable ? 'border-border' : 'cursor-not-allowed opacity-60',
      )}
    >
      <ProductPicture
        fileId={product.imageFileId}
        className="-mx-5 -mt-5 aspect-[4/3] w-[calc(100%+2.5rem)] max-w-none"
      />
      <span className="grid gap-1">
        <span className="text-2xl leading-tight font-semibold">
          {pickLocalized(product, 'name', locale)}
        </span>
        {description ? (
          <span className="line-clamp-2 text-base text-muted-foreground">{description}</span>
        ) : null}
      </span>
      <span className="flex items-center justify-between gap-2">
        <bdi className="ltr-nums text-xl font-bold">{price}</bdi>
        {!product.isAvailable ? (
          <span className="rounded-full bg-muted px-3 py-1 text-sm font-semibold">
            {t('menu.soldOut')}
          </span>
        ) : null}
      </span>
    </button>
  );
}
