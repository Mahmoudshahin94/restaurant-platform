import { pickLocalized } from '@pos/i18n';
import { Feature, type Permission } from '@pos/shared-types';
import { NativeSelect } from '@pos/ui';
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
  Languages,
  LayoutDashboard,
  Link2,
  MonitorSmartphone,
  ListChecks,
  MapPin,
  Palette,
  Puzzle,
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
import { Outlet } from 'react-router';
import { PageShell, PlatformFooter, useCurrentLocale, useFeatures } from '@pos/app-kit';
import { usePermissions } from '../lib/permissions';
import { useLocations } from '../lib/queries';
import { usePreferences } from '../stores/preferences';
import { BrandSwitcher } from './brand-switcher';
import { UserMenu } from './user-menu';

type NavKey = keyof I18nResources['admin']['nav'];

interface NavItem {
  to: string;
  labelKey: NavKey;
  icon: LucideIcon;
  permission?: Permission;
  /** The permission must be held tenant-wide (pages for the whole tenant). */
  tenantWide?: boolean;
  /** Shown while any of these modules is on at the chosen location (ADR 0018). */
  features?: readonly Feature[];
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
        features: [Feature.MODIFIERS],
      },
      {
        to: '/menu/kitchen-stations',
        labelKey: 'kitchenStations',
        icon: ChefHat,
        permission: 'products.view',
        features: [Feature.KDS, Feature.KITCHEN_PRINTER],
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
        to: '/settings/modules',
        labelKey: 'modules',
        icon: Puzzle,
        permission: 'settings.manage',
        tenantWide: true,
      },
      {
        to: '/settings/branding',
        labelKey: 'branding',
        icon: Palette,
        permission: 'settings.manage',
        tenantWide: true,
      },
      {
        to: '/settings/localization',
        labelKey: 'localization',
        icon: Languages,
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
        features: [Feature.ONLINE_ORDERING],
      },
      { to: '/settings/taxes', labelKey: 'taxes', icon: Receipt, permission: 'products.view' },
      {
        to: '/settings/discounts',
        labelKey: 'discounts',
        icon: BadgePercent,
        permission: 'settings.manage',
      },
      {
        to: '/settings/tables',
        labelKey: 'tables',
        icon: Grid3x3,
        permission: 'orders.view',
        features: [Feature.TABLES],
      },
      {
        to: '/settings/payment-methods',
        labelKey: 'paymentMethods',
        icon: Wallet,
        permission: 'settings.manage',
        tenantWide: true,
      },
      {
        to: '/settings/payment-providers',
        labelKey: 'paymentProviders',
        icon: CreditCard,
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
    labelKey: 'website',
    items: [
      {
        to: '/website/editor',
        labelKey: 'websiteEditor',
        icon: MonitorSmartphone,
        permission: 'website.manage',
        tenantWide: true,
        features: [Feature.ONLINE_ORDERING],
      },
      {
        to: '/website/domains',
        labelKey: 'domains',
        icon: Link2,
        permission: 'website.manage',
        tenantWide: true,
        features: [Feature.ONLINE_ORDERING],
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
      className="h-9 w-full"
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
  const { t } = useTranslation('admin');
  const { can, canAnywhere } = usePermissions();
  const features = useFeatures();

  const nav = NAV.map((group) => ({
    id: group.labelKey,
    label: t(`nav.${group.labelKey}`),
    items: group.items
      .filter(
        (item) =>
          (!item.permission ||
            (item.tenantWide ? can(item.permission) : canAnywhere(item.permission))) &&
          (!item.features || item.features.some((f) => features[f].enabled)),
      )
      .map((item) => ({
        to: item.to,
        label: t(`nav.${item.labelKey}`),
        icon: <item.icon aria-hidden className="size-4" />,
      })),
  })).filter((group) => group.items.length > 0);

  return (
    <PageShell
      brand={
        <div className="grid gap-2">
          <BrandSwitcher />
          <LocationPicker />
        </div>
      }
      nav={nav}
      header={<UserMenu />}
      skipLabel={t('nav.skipToContent')}
      navLabel={t('nav.mainNavigation')}
    >
      <Outlet />
      <PlatformFooter app="admin" className="mt-8" />
    </PageShell>
  );
}
