import { useCurrentLocale, useMoneyFormat } from '@pos/app-kit';
import { pickLocalized } from '@pos/i18n';
import { SectionAlignment, type WebsiteSectionType } from '@pos/shared-types';
import { Badge, cn } from '@pos/ui';
import type { PublicLocation, PublishedMenuProduct, WebsiteSectionOf } from '@pos/validation';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ProductPicture } from '../components/product-picture';
import { Link } from 'react-router';
import { useMenu } from '../lib/queries';
import { SectionFrame, useLocalizedText, useSiteContext } from './section-kit';

type Props<T extends WebsiteSectionType> = { section: WebsiteSectionOf<T> };

/** Products shown when the tenant picked none. */
const DEFAULT_FEATURED = 6;

/** The branch whose menu a section shows: the one it names, else the first open, else the first. */
function useSectionLocation(locationId: string | null): PublicLocation | null {
  const { locations } = useSiteContext();
  return (
    (locationId ? locations.find((l) => l.id === locationId) : undefined) ??
    locations.find((l) => l.status.state === 'OPEN') ??
    locations[0] ??
    null
  );
}

const fromPrice = (p: PublishedMenuProduct) =>
  p.variants.length > 0 ? Math.min(...p.variants.map((v) => v.price)) : p.price;

function FeaturedProducts({
  location,
  products,
}: {
  location: PublicLocation;
  products: readonly PublishedMenuProduct[];
}) {
  const { t } = useTranslation('customer');
  const locale = useCurrentLocale();
  const { format } = useMoneyFormat(location.currencyCode);
  return (
    <ul className="grid gap-3 text-start sm:grid-cols-2 lg:grid-cols-3">
      {products.map((product) => {
        const name = pickLocalized(product, 'name', locale);
        const description = pickLocalized(product, 'description', locale);
        return (
          <li key={product.id}>
            <Link
              to={`/l/${location.id}`}
              className="grid h-full content-start gap-1 overflow-hidden rounded-lg border bg-card p-4 text-card-foreground hover:border-primary"
              data-testid="featured-product"
            >
              <ProductPicture
                fileId={product.imageFileId}
                className="-mx-4 -mt-4 mb-2 aspect-[4/3] w-[calc(100%+2rem)] max-w-none"
              />
              <span className="font-semibold">{name}</span>
              {description ? (
                <span className="line-clamp-2 text-sm text-muted-foreground">{description}</span>
              ) : null}
              <span className="flex items-center justify-between gap-2 text-sm font-medium">
                <span className="ltr-nums">
                  {product.variants.length > 0
                    ? t('menu.from', { price: format(fromPrice(product)) })
                    : format(product.price)}
                </span>
                {product.isAvailable ? null : (
                  <Badge variant="secondary">{t('menu.soldOut')}</Badge>
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Shown once the branch's menu is known, and only with products to show. */
export function FeaturedProductsSection({ section }: Props<'FEATURED_PRODUCTS'>) {
  const text = useLocalizedText();
  const location = useSectionLocation(section.content.locationId);
  const menu = useMenu(location?.id ?? '', location !== null);
  if (!location || !menu.data) return null;
  const all = menu.data.categories.flatMap((c) => c.products);
  const { productIds } = section.content;
  const products =
    productIds.length > 0
      ? productIds.flatMap((id) => all.filter((p) => p.id === id))
      : all.filter((p) => p.isAvailable).slice(0, DEFAULT_FEATURED);
  if (products.length === 0) return null;
  return (
    <SectionFrame section={section} title={text(section.content.title)}>
      <FeaturedProducts location={location} products={products} />
    </SectionFrame>
  );
}

/** The menu's categories, each opening the branch's menu at that category. */
export function CategoriesSection({ section }: Props<'CATEGORIES'>) {
  const text = useLocalizedText();
  const locale = useCurrentLocale();
  const location = useSectionLocation(null);
  const menu = useMenu(location?.id ?? '', location !== null);
  if (!location || !menu.data) return null;
  const chosen = section.content.categoryIds;
  const categories = menu.data.categories.filter(
    (c) => c.products.length > 0 && (chosen.length === 0 || chosen.includes(c.id)),
  );
  if (categories.length === 0) return null;
  return (
    <SectionFrame section={section} title={text(section.content.title)}>
      <ul
        className={cn(
          'flex flex-wrap gap-2',
          section.appearance.alignment === SectionAlignment.CENTER && 'justify-center',
        )}
      >
        {categories.map((category) => (
          <li key={category.id}>
            <Link
              to={`/l/${location.id}#cat-${category.id}`}
              className="inline-flex items-center gap-1 rounded-full border bg-card px-4 py-2 text-sm font-medium text-card-foreground hover:border-primary"
            >
              {pickLocalized(category, 'name', locale)}
              <ChevronRight aria-hidden className="size-4 rtl:rotate-180" />
            </Link>
          </li>
        ))}
      </ul>
    </SectionFrame>
  );
}
