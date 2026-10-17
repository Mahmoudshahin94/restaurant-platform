import { LanguageSwitcher, RealtimeIndicator, useCurrentLocale, useRealtime } from '@pos/app-kit';
import { pickLocalized } from '@pos/i18n';
import { Button, cn } from '@pos/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BellRing,
  ClipboardList,
  Grid3x3,
  LogOut,
  MapPin,
  Settings,
  ShoppingBasket,
  Wallet,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { appInfo, isTauri } from '../lib/device';
import { ORDER_QUERY_ROOTS, useLocations } from '../lib/queries';
import { session, useSession } from '../lib/session';
import { usePreferences } from '../stores/preferences';
import { FOCUS_SEARCH_EVENT } from './product-grid';
import { PLACE_ORDER_EVENT } from './cart-panel';

const NAV = [
  { to: '/order', key: 'nav.order', icon: ShoppingBasket, shortcut: 'F2' },
  { to: '/orders', key: 'nav.orders', icon: ClipboardList, shortcut: 'F4' },
  { to: '/tables', key: 'nav.tables', icon: Grid3x3, shortcut: 'F6' },
  { to: '/shift', key: 'nav.shift', icon: Wallet, shortcut: 'F8' },
] as const;

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

/**
 * Keyboard shortcuts for fast entry: F2 order, F4 orders, F6 tables, "/" search the menu,
 * Ctrl/⌘+Enter place the order.
 */
function useShortcuts(): void {
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const route = NAV.find((n) => n.shortcut === e.key);
      if (route) {
        e.preventDefault();
        void navigate(route.to);
      } else if (e.key === '/' && !isTyping(e.target)) {
        e.preventDefault();
        void navigate('/order');
        window.setTimeout(() => window.dispatchEvent(new Event(FOCUS_SEARCH_EVENT)), 0);
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        window.dispatchEvent(new Event(PLACE_ORDER_EVENT));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [navigate]);
}

export function PosShell() {
  const { t } = useTranslation(['pos', 'common', 'orders']);
  const locale = useCurrentLocale();
  const user = useSession((s) => s.user);
  const { locationId, setLocale } = usePreferences();
  const locations = useLocations();
  const location = locations.data?.find((l) => l.id === locationId);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const info = useQuery({ queryKey: ['app-info'], queryFn: appInfo, staleTime: Infinity });
  useShortcuts();
  const [readyNotice, setReadyNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!readyNotice) return;
    const id = setTimeout(() => {
      setReadyNotice(null);
    }, 10_000);
    return () => {
      clearTimeout(id);
    };
  }, [readyNotice]);

  // Live order changes from other terminals and the kitchen; polling remains as a fallback.
  const realtime = useRealtime(session, locationId, (event) => {
    if (!event.type.startsWith('order.')) return;
    void queryClient.invalidateQueries({
      predicate: (q) => ORDER_QUERY_ROOTS.includes(String(q.queryKey[0])),
    });
    if (event.type === 'order.updated' && 'status' in event.payload) {
      if (event.payload.status === 'READY') setReadyNotice(event.payload.orderNumber);
    }
  });

  const signOut = async () => {
    await session.signOut();
    queryClient.clear();
    void navigate('/login', { replace: true });
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b bg-card px-3">
        <nav aria-label={t('pos:nav.main')} className="flex gap-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex h-12 items-center gap-2 rounded-lg px-4 text-base font-semibold',
                  isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
                )
              }
            >
              <item.icon aria-hidden className="size-5" />
              {t(`pos:${item.key}`)}
              <kbd className="hidden text-xs opacity-60 lg:inline">{item.shortcut}</kbd>
            </NavLink>
          ))}
        </nav>
        <div className="ms-auto flex items-center gap-3">
          {location ? (
            <Button variant="ghost" onClick={() => void navigate('/location')}>
              <MapPin aria-hidden />
              {pickLocalized(location, 'name', locale)}
            </Button>
          ) : null}
          <LanguageSwitcher className="h-10 w-auto" onLocaleChange={setLocale} />
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('pos:nav.settings')}
            onClick={() => void navigate('/settings')}
          >
            <Settings aria-hidden />
          </Button>
          <span className="hidden text-sm text-muted-foreground md:inline">
            {user?.displayName}
          </span>
          <Button variant="outline" onClick={() => void signOut()}>
            <LogOut aria-hidden className="rtl:-scale-x-100" />
            {t('common:actions.signOut')}
          </Button>
        </div>
      </header>
      <main className="relative min-h-0 flex-1 p-3">
        {readyNotice ? (
          <div
            role="status"
            className="absolute end-4 top-4 z-10 flex items-center gap-2 rounded-lg bg-success px-4 py-3 text-lg font-semibold text-success-foreground shadow-lg"
          >
            <BellRing aria-hidden className="size-5" />
            {t('orders:kitchen.ready', { number: readyNotice })}
          </div>
        ) : null}
        <Outlet />
      </main>
      <footer className="flex h-7 shrink-0 items-center justify-between border-t px-3 text-xs text-muted-foreground">
        <RealtimeIndicator status={realtime} />
        {isTauri() && info.data
          ? t('pos:device.version', { version: info.data.version })
          : t('pos:device.browser')}
      </footer>
    </div>
  );
}
