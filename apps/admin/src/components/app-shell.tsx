import { pickLocalized } from '@pos/i18n';
import type { Permission } from '@pos/shared-types';
import { Button, NativeSelect, cn } from '@pos/ui';
import { useQueryClient } from '@tanstack/react-query';
import {
  ChefHat,
  FolderTree,
  LayoutDashboard,
  ListChecks,
  LogOut,
  ToggleRight,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { api } from '../lib/api';
import { useCurrentLocale } from '../lib/locale';
import { usePermissions } from '../lib/permissions';
import { useLocations } from '../lib/queries';
import { usePreferences } from '../stores/preferences';
import { useSession } from '../stores/session';
import { LanguageSwitcher } from './language-switcher';

interface NavItem {
  to: string;
  labelKey:
    | 'nav.dashboard'
    | 'nav.categories'
    | 'nav.products'
    | 'nav.modifierGroups'
    | 'nav.kitchenStations'
    | 'nav.availability';
  icon: LucideIcon;
  permission?: Permission;
}

const NAV: NavItem[] = [
  { to: '/', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  {
    to: '/menu/categories',
    labelKey: 'nav.categories',
    icon: FolderTree,
    permission: 'products.view',
  },
  {
    to: '/menu/products',
    labelKey: 'nav.products',
    icon: UtensilsCrossed,
    permission: 'products.view',
  },
  {
    to: '/menu/modifier-groups',
    labelKey: 'nav.modifierGroups',
    icon: ListChecks,
    permission: 'products.view',
  },
  {
    to: '/menu/kitchen-stations',
    labelKey: 'nav.kitchenStations',
    icon: ChefHat,
    permission: 'products.view',
  },
  {
    to: '/menu/availability',
    labelKey: 'nav.availability',
    icon: ToggleRight,
    permission: 'products.view',
  },
];

function LocationPicker() {
  const { t } = useTranslation('admin');
  const locale = useCurrentLocale();
  const locations = useLocations();
  const { locationId, setLocationId } = usePreferences();
  const list = locations.data;

  // Default to the first accessible location; drop a remembered one that is no longer reachable.
  useEffect(() => {
    if (!list || list.length === 0) return;
    if (!locationId || !list.some((l) => l.id === locationId)) setLocationId(list[0]?.id ?? null);
  }, [list, locationId, setLocationId]);

  if (!list || list.length === 0) return null;
  return (
    <NativeSelect
      aria-label={t('header.location')}
      className="h-9 w-auto max-w-56"
      value={locationId ?? ''}
      onChange={(e) => {
        setLocationId(e.target.value);
      }}
    >
      {list.map((l) => (
        <option key={l.id} value={l.id}>
          {pickLocalized(l, 'name', locale)}
        </option>
      ))}
    </NativeSelect>
  );
}

export function AppShell() {
  const { t } = useTranslation(['admin', 'common']);
  const user = useSession((s) => s.user);
  const clear = useSession((s) => s.clear);
  const { canAnywhere } = usePermissions();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const signOut = async () => {
    try {
      await api.auth.logout();
    } finally {
      clear();
      queryClient.clear();
      void navigate('/login', { replace: true });
    }
  };

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b bg-card md:w-64 md:shrink-0 md:border-e md:border-b-0">
        <div className="flex h-14 items-center px-4 font-semibold">{t('common:appName')}</div>
        <nav
          aria-label={t('admin:nav.mainNavigation')}
          className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:pb-4"
        >
          {NAV.filter((item) => !item.permission || canAnywhere(item.permission)).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground hover:bg-muted',
                )
              }
            >
              <item.icon aria-hidden className="size-4" />
              {t(`admin:${item.labelKey}`)}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 flex-wrap items-center justify-end gap-3 border-b bg-card px-4">
          <LocationPicker />
          <LanguageSwitcher />
          <span className="hidden text-sm text-muted-foreground sm:inline">
            {t('admin:header.signedInAs', { name: user?.displayName ?? '' })}
          </span>
          <Button variant="ghost" size="sm" onClick={() => void signOut()}>
            <LogOut aria-hidden className="rtl:-scale-x-100" />
            {t('common:actions.signOut')}
          </Button>
        </header>
        <main className="flex-1 p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
