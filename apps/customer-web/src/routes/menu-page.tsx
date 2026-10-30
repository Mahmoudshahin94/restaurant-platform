import { QueryState, useCurrentLocale, useMoneyFormat } from '@pos/app-kit';
import { pickLocalized } from '@pos/i18n';
import type { PublicLocation, PublishedMenu, PublishedMenuProduct } from '@pos/validation';
import { Badge, Button, Dialog, buttonVariants, cn } from '@pos/ui';
import { ChevronLeft, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { OrderingBadge, OrderingNotice } from '../components/ordering-status';
import { ProductDialog } from '../components/product-dialog';
import { ProductPicture } from '../components/product-picture';
import { useLocation, useMenu } from '../lib/queries';
import { useCartQuote } from '../lib/quote';
import { cartCount, useCart } from '../stores/cart';

/** Lowest price a product can be ordered at (its cheapest size). */
const fromPrice = (p: PublishedMenuProduct) =>
  p.variants.length > 0 ? Math.min(...p.variants.map((v) => v.price)) : p.price;

function ProductCard({
  product,
  currency,
  onChoose,
}: {
  product: PublishedMenuProduct;
  currency: string;
  onChoose: () => void;
}) {
  const { t } = useTranslation('customer');
  const locale = useCurrentLocale();
  const { format } = useMoneyFormat(currency);
  const name = pickLocalized(product, 'name', locale);
  const description = pickLocalized(product, 'description', locale);
  return (
    <li className="flex gap-3 rounded-lg border bg-card p-4" data-testid="product-card">
      <ProductPicture fileId={product.imageFileId} className="size-24 shrink-0 rounded-md" />
      <div className="grid min-w-0 flex-1 gap-1">
        <h3 className="font-semibold">{name}</h3>
        {description ? (
          <p className="line-clamp-2 text-sm text-muted-foreground">{description}</p>
        ) : null}
        <p className="ltr-nums text-sm font-medium">
          {product.variants.length > 0
            ? t('menu.from', { price: format(fromPrice(product)) })
            : format(product.price)}
        </p>
      </div>
      <div className="flex flex-col items-end justify-between">
        {product.isAvailable ? (
          <Button size="icon" aria-label={t('menu.add', { name })} onClick={onChoose}>
            <Plus aria-hidden />
          </Button>
        ) : (
          <Badge variant="secondary">{t('menu.soldOut')}</Badge>
        )}
      </div>
    </li>
  );
}

function Menu({ menu, location }: { menu: PublishedMenu; location: PublicLocation }) {
  const { t } = useTranslation(['customer', 'common']);
  const locale = useCurrentLocale();
  const { format } = useMoneyFormat(menu.currencyCode);
  const { lines, fulfillment, addLine } = useCart();
  const [chosen, setChosen] = useState<PublishedMenuProduct | null>(null);
  const { quote } = useCartQuote(menu, lines, fulfillment, location.deliveryFee);
  const categories = menu.categories.filter((c) => c.products.length > 0);
  const count = cartCount(lines);

  if (categories.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center">
        <p className="font-medium">{t('customer:menu.empty')}</p>
        <p className="text-sm text-muted-foreground">{t('customer:menu.emptyHint')}</p>
      </div>
    );
  }
  return (
    <>
      <nav
        aria-label={t('customer:menu.categories')}
        className="sticky top-16 z-30 -mx-4 mb-4 flex gap-2 overflow-x-auto border-b bg-background/95 px-4 py-2 backdrop-blur"
      >
        {categories.map((c) => (
          <a
            key={c.id}
            href={`#cat-${c.id}`}
            className="shrink-0 rounded-full border px-3 py-1 text-sm hover:bg-muted"
          >
            {pickLocalized(c, 'name', locale)}
          </a>
        ))}
      </nav>
      <div className="grid gap-8 pb-24">
        {categories.map((c) => (
          <section key={c.id} id={`cat-${c.id}`} data-category-anchor aria-labelledby={`h-${c.id}`}>
            <h2 id={`h-${c.id}`} className="mb-3 text-lg font-semibold">
              {pickLocalized(c, 'name', locale)}
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {c.products.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  currency={menu.currencyCode}
                  onChoose={() => {
                    setChosen(p);
                  }}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
      {count > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 p-3 backdrop-blur">
          <div className="mx-auto max-w-5xl">
            <Link
              to={`/l/${location.id}/cart`}
              className={cn(buttonVariants({ size: 'lg' }), 'w-full')}
            >
              {t('customer:cart.view', { total: quote ? format(quote.pricing.total) : '' })}
              <span className="text-primary-foreground/80">
                · {t('customer:cart.items', { count })}
              </span>
            </Link>
          </div>
        </div>
      ) : null}
      <Dialog
        open={chosen !== null}
        onOpenChange={(open) => {
          if (!open) setChosen(null);
        }}
      >
        {chosen ? (
          <ProductDialog
            product={chosen}
            currency={menu.currencyCode}
            onConfirm={(line) => {
              addLine(line);
              setChosen(null);
            }}
          />
        ) : null}
      </Dialog>
    </>
  );
}

/** A branch's menu by category; products open the options dialog and go to the cart. */
export function MenuPage() {
  const { t } = useTranslation(['customer', 'common']);
  const locale = useCurrentLocale();
  const { locationId = '' } = useParams();
  const location = useLocation(locationId);
  const menu = useMenu(locationId);
  const ensureLocation = useCart((s) => s.ensureLocation);
  useEffect(() => {
    ensureLocation(locationId);
  }, [ensureLocation, locationId]);

  return (
    <QueryState query={location}>
      {(loc) => (
        <>
          <div className="mb-4 grid gap-3">
            <Link to="/" className="flex w-fit items-center gap-1 text-sm text-muted-foreground">
              <ChevronLeft aria-hidden className="size-4 rtl:-scale-x-100" />
              {t('customer:nav.home')}
            </Link>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold">{pickLocalized(loc, 'name', locale)}</h1>
              <OrderingBadge status={loc.status} />
            </div>
            <OrderingNotice status={loc.status} />
          </div>
          <QueryState query={menu}>{(m) => <Menu menu={m} location={loc} />}</QueryState>
        </>
      )}
    </QueryState>
  );
}
