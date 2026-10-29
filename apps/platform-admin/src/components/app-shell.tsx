import { PlatformFooter, ThemeSwitcher } from '@pos/app-kit';
import type { I18nResources } from '@pos/i18n';
import type { PlatformPermission } from '@pos/shared-types';
import { Button, cn } from '@pos/ui';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Building2,
  LifeBuoy,
  LogOut,
  PackageCheck,
  ScrollText,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { session, useSession } from '../lib/api';
import { usePlatformCan } from '../lib/permissions';
import { LanguageSwitcher } from './language-switcher';

type NavKey = Exclude<keyof I18nResources['platform']['nav'], 'main'>;

const NAV: { to: string; labelKey: NavKey; icon: LucideIcon; permission: PlatformPermission }[] = [
  { to: '/tenants', labelKey: 'tenants', icon: Building2, permission: 'tenants.view' },
  { to: '/health', labelKey: 'health', icon: Activity, permission: 'health.view' },
  { to: '/releases', labelKey: 'releases', icon: PackageCheck, permission: 'releases.view' },
  { to: '/support', labelKey: 'support', icon: LifeBuoy, permission: 'support.find' },
  { to: '/audit', labelKey: 'audit', icon: ScrollText, permission: 'audit.view' },
];

/** The operators' console: navigation by role, language, theme and the signed-in operator. */
export function AppShell() {
  const { t } = useTranslation(['platform', 'common']);
  const user = useSession((s) => s.user);
  const can = usePlatformCan();
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
      <aside className="surface border-b md:sticky md:top-0 md:flex md:h-screen md:w-60 md:shrink-0 md:flex-col md:border-e md:border-b-0">
        <div className="flex h-14 shrink-0 items-center gap-2 px-4">
          <img src="/madar-logo.svg" alt="" className="size-7" />
          <span className="font-semibold" dir="ltr">
            {t('common:platform.products.platform')}
          </span>
        </div>
        <nav
          aria-label={t('platform:nav.main')}
          className="flex shrink-0 gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:pb-4"
        >
          {NAV.filter((item) => can(item.permission)).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
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
              {t(`platform:nav.${item.labelKey}`)}
            </NavLink>
          ))}
        </nav>
        <PlatformFooter app="platform" className="mt-auto hidden px-4 py-3 md:block" />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="surface flex h-14 flex-wrap items-center justify-end gap-3 border-b px-4">
          <LanguageSwitcher />
          <ThemeSwitcher />
          {user ? (
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {t('platform:header.signedInAs', {
                name: user.displayName,
                role: t(`platform:roles.${user.role}`),
              })}
            </span>
          ) : null}
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
