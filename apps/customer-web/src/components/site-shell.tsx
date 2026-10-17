import { LanguageSwitcher, useCurrentLocale } from '@pos/app-kit';
import { pickLocalized } from '@pos/i18n';
import { Badge, cn } from '@pos/ui';
import { ShoppingBag, Store } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, Outlet, useMatch } from 'react-router';
import { useRestaurant } from '../lib/queries';
import { cartCount, useCart } from '../stores/cart';
import { usePreferences } from '../stores/preferences';

/** Header (restaurant, language, cart) and page frame of every screen. */
export function SiteShell() {
  const { t } = useTranslation(['customer', 'common']);
  const locale = useCurrentLocale();
  const restaurant = useRestaurant();
  const setLocale = usePreferences((s) => s.setLocale);
  const { lines, locationId } = useCart();
  const count = cartCount(lines);
  const inBranch = useMatch('/l/:locationId/*');
  const cartLocation = inBranch?.params.locationId ?? locationId;

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-4 focus:py-2"
      >
        {t('customer:skipToContent')}
      </a>
      <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4">
          <Link to="/" className="flex min-w-0 items-center gap-2 font-semibold">
            <Store aria-hidden className="size-5 shrink-0 text-primary" />
            <span className="truncate">
              {restaurant.data
                ? pickLocalized(restaurant.data, 'name', locale)
                : t('customer:brand')}
            </span>
          </Link>
          <div className="ms-auto flex items-center gap-2">
            <LanguageSwitcher onLocaleChange={setLocale} />
            {cartLocation ? (
              <Link
                to={`/l/${cartLocation}/cart`}
                className={cn(
                  'relative inline-flex h-10 items-center gap-2 rounded-md border bg-card px-3 text-sm font-medium hover:bg-muted',
                )}
                aria-label={`${t('customer:nav.cart')} · ${t('customer:cart.items', { count })}`}
              >
                <ShoppingBag aria-hidden className="size-4" />
                <span className="hidden sm:inline">{t('customer:nav.cart')}</span>
                {count > 0 ? (
                  <Badge className="ltr-nums" aria-hidden>
                    {count}
                  </Badge>
                ) : null}
              </Link>
            ) : null}
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
