import { pickLocalized } from '@pos/i18n';
import type { Permission } from '@pos/shared-types';
import { Button, NativeSelect, cn } from '@pos/ui';
import { useQueryClient } from '@tanstack/react-query';
import {
  BadgePercent,
  Banknote,
  BarChart3,
  Building2,
  ChefHat,
  Contact,
  CreditCard,
  FolderTree,
  Globe,
  Grid3x3,
  IdCard,
  LayoutDashboard,
  ListChecks,
  LogOut,
  MapPin,
  Receipt,
  RefreshCw,
  ScrollText,
  ServerCog,
  ShieldCheck,
  ShoppingBag,
  Timer,
  ToggleRight,
  Users,
  UtensilsCrossed,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { I18nResources } from '@pos/i18n';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { session } from '../lib/api';
import { useCurrentLocale } from '@pos/app-kit';
import { usePermissions } from '../lib/permissions';
import { useLocations } from '../lib/queries';
import { usePreferences } from '../stores/preferences';
import { useSession } from '../stores/session';
import { LanguageSwitcher } from './language-switcher';

type NavKey = keyof I18nResources['admin']['nav'];

interface NavItem {
  to: string;
  labelKey: NavKey;
  icon: LucideIcon;
  permission?: Permission;
  /** The permission must be held tenant-wide (pages for the whole tenant). */
  tenantWide?: boolean;
}

interface NavGroup {
  labelKey: NavKey;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    labelKey: 'overview',
    items: [
      { to: '/', labelKey: 'dashboard', icon: LayoutDashboard },
      { to: '/reports', labelKey: 'reports', icon: BarChart3, permission: 'reports.view' },
    ],
  },
  {
    labelKey: 'operations',
    items: [
      {
        to: '/operations/orders',
        labelKey: 'orders',
        icon: ShoppingBag,
        permission: 'orders.view',
      },
      {
        to: '/operations/customers',
        labelKey: 'customers',
        icon: Contact,
        permission: 'customers.view',
      },
      {
        to: '/operations/payments',
        labelKey: 'payments',
        icon: CreditCard,
        permission: 'payments.view',
      },
      { to: '/operations/shifts', labelKey: 'shifts', icon: Timer, permission: 'shifts.manage' },
    ],
  },
  {
    labelKey: 'menu',
    items: [
      {
        to: '/menu/categories',
        labelKey: 'categories',
        icon: FolderTree,
        permission: 'products.view',
      },
      {
        to: '/menu/products',
        labelKey: 'products',
        icon: UtensilsCrossed,
        permission: 'products.view',
      },
      {
        to: '/menu/modifier-groups',
        labelKey: 'modifierGroups',
        icon: ListChecks,
        permission: 'products.view',
      },
      {
        to: '/menu/kitchen-stations',
        labelKey: 'kitchenStations',
        icon: ChefHat,
        permission: 'products.view',
      },
      {
        to: '/menu/availability',
        labelKey: 'availability',
        icon: ToggleRight,
        permission: 'products.view',
      },
    ],
  },
  {
    labelKey: 'settings',
    items: [
      {
        to: '/settings/tenant',
        labelKey: 'tenant',
        icon: Building2,
        permission: 'settings.manage',
        tenantWide: true,
      },
      {
        to: '/settings/locations',
        labelKey: 'locations',
        icon: MapPin,
        permission: 'locations.view',
      },
      {
        to: '/settings/online-ordering',
        labelKey: 'onlineOrdering',
        icon: Globe,
        permission: 'locations.view',
      },
      { to: '/settings/taxes', labelKey: 'taxes', icon: Receipt, permission: 'products.view' },
      {
        to: '/settings/discounts',
        labelKey: 'discounts',
        icon: BadgePercent,
        permission: 'settings.manage',
      },
      { to: '/settings/tables', labelKey: 'tables', icon: Grid3x3, permission: 'orders.view' },
      {
        to: '/settings/payment-methods',
        labelKey: 'paymentMethods',
        icon: Wallet,
        permission: 'settings.manage',
        tenantWide: true,
      },
      {
        to: '/settings/cash-registers',
        labelKey: 'cashRegisters',
        icon: Banknote,
        permission: 'settings.manage',
      },
    ],
  },
  {
    labelKey: 'staff',
    items: [
      {
        to: '/staff/users',
        labelKey: 'users',
        icon: Users,
        permission: 'users.manage',
        tenantWide: true,
      },
      {
        to: '/staff/roles',
        labelKey: 'roles',
        icon: ShieldCheck,
        permission: 'roles.manage',
        tenantWide: true,
      },
      {
        to: '/staff/employees',
        labelKey: 'employees',
        icon: IdCard,
        permission: 'users.manage',
        tenantWide: true,
      },
    ],
  },
  {
    labelKey: 'system',
    items: [
      { to: '/system/devices', labelKey: 'devices', icon: ServerCog, permission: 'devices.manage' },
      { to: '/system/sync', labelKey: 'sync', icon: RefreshCw, permission: 'sync.view' },
      { to: '/system/audit-log', labelKey: 'auditLog', icon: ScrollText, permission: 'audit.view' },
    ],
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
  const { can, canAnywhere } = usePermissions();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const signOut = async () => {
    try {
      await session.signOut();
    } finally {
      queryClient.clear();
      void navigate('/login', { replace: true });
    }
  };

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b bg-card md:sticky md:top-0 md:h-screen md:w-64 md:shrink-0 md:overflow-y-auto md:border-e md:border-b-0">
        <div className="flex h-14 items-center px-4 font-semibold">{t('common:appName')}</div>
        <nav
          aria-label={t('admin:nav.mainNavigation')}
          className="flex gap-4 overflow-x-auto px-2 pb-2 md:flex-col md:gap-3 md:pb-4"
        >
          {NAV.map((group) => {
            const items = group.items.filter(
              (item) =>
                !item.permission ||
                (item.tenantWide ? can(item.permission) : canAnywhere(item.permission)),
            );
            if (items.length === 0) return null;
            return (
              <div key={group.labelKey} className="flex gap-1 md:flex-col">
                <span className="hidden px-3 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:block">
                  {t(`admin:nav.${group.labelKey}`)}
                </span>
                {items.map((item) => (
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
                    {t(`admin:nav.${item.labelKey}`)}
                  </NavLink>
                ))}
              </div>
            );
          })}
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
