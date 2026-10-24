import {
  type BrandingFileSource,
  LanguageSwitcher,
  LocalizationProvider,
  PlatformFooter,
  TenantLogo,
  ThemeSwitcher,
  useApplyBranding,
  useCurrentLocale,
  useLocaleSelection,
} from '@pos/app-kit';
import { pickLocalized } from '@pos/i18n';
import { Badge, Button, EmptyState, Spinner, cn } from '@pos/ui';
import type { PublicSite } from '@pos/validation';
import { Eye, ShoppingBag, Store } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Outlet, useMatch } from 'react-router';
import { storefront } from '../lib/api';
import { endPreview } from '../lib/preview';
import { useSite } from '../lib/queries';
import { SiteContext, SiteLink, useLocalizedText } from '../sections/section-kit';
import { cartCount, useCart } from '../stores/cart';
import { usePreferences } from '../stores/preferences';

/** The tenant's logo and favicon: public files of its site (ADR 0019, ADR 0023). */
const siteFiles: BrandingFileSource = (fileId) => storefront.fileUrl(fileId);

/** The page title and description search engines and link previews read (the website's SEO). */
function useSeo(site: PublicSite | undefined): void {
  const text = useLocalizedText();
  const locale = useCurrentLocale();
  useEffect(() => {
    if (!site) return undefined;
    const title = text(site.website.seo.title);
    if (title) document.title = title;
    const description = text(site.website.seo.description);
    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'description';
      document.head.append(meta);
    }
    meta.content = description;
    return undefined;
  }, [site, text, locale]);
}

/** Shown on the admin's preview link: this is the draft, not what visitors see. */
function PreviewBanner() {
  const { t } = useTranslation('customer');
  return (
    <div role="status" className="bg-accent text-accent-foreground">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
        <span className="flex items-center gap-2 font-medium">
          <Eye aria-hidden className="size-4" />
          {t('site.preview')}
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            endPreview();
            window.location.reload();
          }}
        >
          {t('site.endPreview')}
        </Button>
      </div>
    </div>
  );
}

function SiteNavigation({ site }: { site: PublicSite }) {
  const { t } = useTranslation('customer');
  if (site.website.navigation.length === 0) return null;
  return (
    <nav aria-label={t('site.navigation')} className="hidden md:block">
      <ul className="flex items-center gap-4 text-sm font-medium">
        {site.website.navigation.map((link) => (
          <li key={link.href}>
            <SiteLink link={link} className="text-muted-foreground hover:text-foreground" />
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Header (tenant, navigation, language, cart) and page frame of every screen. The site is the
 * tenant's whose domain this is (ADR 0023); nothing renders until it is known, so its branding,
 * currency display and languages (ADR 0019, ADR 0020) apply before the first paint of its pages:
 * the visitor's choice of language if the store offers it, else the store's default.
 */
export function SiteShell() {
  const { t } = useTranslation(['customer', 'common']);
  const locale = useCurrentLocale();
  const site = useSite();
  const setLocale = usePreferences((s) => s.setLocale);
  const storedLocale = usePreferences((s) => s.locale);
  const { lines, locationId } = useCart();
  const count = cartCount(lines);
  const inBranch = useMatch('/l/:locationId/*');
  const cartLocation = inBranch?.params.locationId ?? locationId;
  useApplyBranding(site.data?.branding, siteFiles);
  useLocaleSelection(site.data?.locales, { stored: storedLocale });
  useSeo(site.data);

  return (
    <LocalizationProvider currency={site.data?.currency} locales={site.data?.locales}>
      <SiteContext.Provider value={site.data ?? null}>
        <div className="flex min-h-dvh flex-col bg-background text-foreground">
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-4 focus:py-2"
          >
            {t('customer:skipToContent')}
          </a>
          {site.data?.preview ? <PreviewBanner /> : null}
          <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur">
            <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4">
              <Link to="/" className="flex min-w-0 items-center gap-2 font-semibold">
                <TenantLogo
                  fallback={
                    <>
                      <Store aria-hidden className="size-5 shrink-0 text-primary" />
                      <span className="truncate">
                        {site.data ? pickLocalized(site.data, 'name', locale) : t('customer:brand')}
                      </span>
                    </>
                  }
                />
              </Link>
              {site.data ? <SiteNavigation site={site.data} /> : null}
              <div className="ms-auto flex items-center gap-2">
                <LanguageSwitcher onLocaleChange={setLocale} />
                <ThemeSwitcher className="hidden h-9 w-auto sm:block" />
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
            {site.data ? (
              <Outlet />
            ) : site.isError ? (
              <EmptyState
                title={t('customer:site.notFound')}
                description={t('customer:site.notFoundHint')}
              />
            ) : (
              <div className="flex justify-center py-12">
                <Spinner label={t('common:states.loading')} />
              </div>
            )}
          </main>
          <footer className="mx-auto w-full max-w-5xl px-4 pb-6">
            <PlatformFooter app="website" className="text-center" />
          </footer>
        </div>
      </SiteContext.Provider>
    </LocalizationProvider>
  );
}
