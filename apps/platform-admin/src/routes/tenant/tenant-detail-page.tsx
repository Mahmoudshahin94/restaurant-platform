import { QueryState, useCurrentLocale } from '@pos/app-kit';
import type { I18nResources } from '@pos/i18n';
import { pickLocalized } from '@pos/i18n';
import type { PlatformPermission } from '@pos/shared-types';
import { Alert, Button, PageHeader, cn } from '@pos/ui';
import type { PlatformTenantDetail } from '@pos/validation';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, useParams } from 'react-router';
import { TenantStatusBadge } from '../../components/status-badge';
import { api } from '../../lib/api';
import { usePlatformCan } from '../../lib/permissions';
import { AuditTab } from './audit-tab';
import { HealthTab } from './health-tab';
import { ModulesTab } from './modules-tab';
import { OverviewTab } from './overview-tab';
import { BrandingTab, DevicesTab, DomainsTab, LocationsTab, PaymentsTab, UsersTab } from './views';

type TabKey = keyof I18nResources['platform']['tenant']['tabs'];

const TABS: {
  key: TabKey;
  permission: PlatformPermission;
  render: (tenant: PlatformTenantDetail) => ReactNode;
}[] = [
  { key: 'overview', permission: 'tenants.view', render: (d) => <OverviewTab detail={d} /> },
  {
    key: 'locations',
    permission: 'tenants.view',
    render: (d) => <LocationsTab tenantId={d.tenant.id} />,
  },
  { key: 'users', permission: 'tenants.view', render: (d) => <UsersTab tenantId={d.tenant.id} /> },
  {
    key: 'devices',
    permission: 'tenants.view',
    render: (d) => <DevicesTab tenantId={d.tenant.id} />,
  },
  { key: 'modules', permission: 'tenants.view', render: (d) => <ModulesTab detail={d} /> },
  {
    key: 'branding',
    permission: 'tenants.view',
    render: (d) => <BrandingTab tenantId={d.tenant.id} />,
  },
  { key: 'domains', permission: 'tenants.view', render: (d) => <DomainsTab detail={d} /> },
  {
    key: 'payments',
    permission: 'tenants.payments.view',
    render: (d) => <PaymentsTab tenantId={d.tenant.id} />,
  },
  { key: 'health', permission: 'health.view', render: (d) => <HealthTab tenantId={d.tenant.id} /> },
  { key: 'audit', permission: 'audit.view', render: (d) => <AuditTab tenantId={d.tenant.id} /> },
];

/** One business, tab by tab (ADR 0025). */
export function TenantDetailPage() {
  const { t } = useTranslation('platform');
  const locale = useCurrentLocale();
  const can = usePlatformCan();
  const { tenantId = '', tab = 'overview' } = useParams();
  const detail = useQuery({
    queryKey: ['tenant', tenantId],
    queryFn: () => api.tenants.get(tenantId),
  });
  const tabs = TABS.filter((entry) => can(entry.permission));
  const current = tabs.find((entry) => entry.key === tab) ?? tabs[0];

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-2">
        <Link to="/tenants">
          <ChevronLeft aria-hidden className="rtl:-scale-x-100" />
          {t('tenant.back')}
        </Link>
      </Button>
      <QueryState query={detail}>
        {(data) => (
          <>
            <PageHeader
              title={pickLocalized(data.tenant, 'name', locale)}
              description={data.tenant.slug}
              actions={<TenantStatusBadge status={data.tenant.status} />}
            />
            {data.tenant.status === 'SUSPENDED' ? (
              <Alert variant="destructive" className="mb-4" data-testid="status-banner">
                {t('tenant.suspendedBanner')}
              </Alert>
            ) : data.tenant.status === 'ARCHIVED' ? (
              <Alert className="mb-4" data-testid="status-banner">
                {t('tenant.archivedBanner')}
              </Alert>
            ) : null}
            <nav
              aria-label={pickLocalized(data.tenant, 'name', locale)}
              className="mb-6 flex gap-1 overflow-x-auto border-b"
            >
              {tabs.map((entry) => (
                <NavLink
                  key={entry.key}
                  to={`/tenants/${tenantId}/${entry.key}`}
                  className={() =>
                    cn(
                      '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium',
                      entry.key === current?.key
                        ? 'border-primary text-foreground'
                        : 'border-transparent text-muted-foreground hover:text-foreground',
                    )
                  }
                >
                  {t(`tenant.tabs.${entry.key}`)}
                </NavLink>
              ))}
            </nav>
            {current?.render(data)}
          </>
        )}
      </QueryState>
    </div>
  );
}
