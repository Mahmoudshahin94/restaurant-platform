import { QueryState, useCurrentLocale } from '@pos/app-kit';
import type { I18nResources } from '@pos/i18n';
import { pickLocalized } from '@pos/i18n';
import { Button, PageHeader, cn } from '@pos/ui';
import type { PlatformOrganizationDetail } from '@pos/validation';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, Pencil } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, useParams } from 'react-router';
import { TenantStatusBadge } from '../../components/status-badge';
import { api } from '../../lib/api';
import { usePlatformCan } from '../../lib/permissions';
import { BrandsTab } from './brands-tab';
import { EditOrganizationDialog } from './edit-organization-dialog';
import { MembersTab } from './members-tab';

type TabKey = keyof I18nResources['platform']['organization']['tabs'];

const TABS: { key: TabKey; render: (organization: PlatformOrganizationDetail) => ReactNode }[] = [
  { key: 'brands', render: (o) => <BrandsTab organization={o} /> },
  { key: 'members', render: (o) => <MembersTab organization={o} /> },
];

/** One organization: its brands and its members. */
export function OrganizationDetailPage() {
  const { t } = useTranslation('platform');
  const locale = useCurrentLocale();
  const can = usePlatformCan();
  const { organizationId = '', tab = 'brands' } = useParams();
  const [editing, setEditing] = useState(false);
  const detail = useQuery({
    queryKey: ['organization', organizationId],
    queryFn: () => api.organizations.get(organizationId),
  });
  const current = TABS.find((entry) => entry.key === tab) ?? TABS[0];

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-2">
        <Link to="/organizations">
          <ChevronLeft aria-hidden className="rtl:-scale-x-100" />
          {t('organization.back')}
        </Link>
      </Button>
      <QueryState query={detail}>
        {(data) => (
          <>
            <PageHeader
              title={pickLocalized(data, 'name', locale)}
              description={`${data.slug} · ${data.currencyCode}`}
              actions={
                <>
                  <TenantStatusBadge status={data.status} />
                  {can('organizations.manage') ? (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setEditing(true);
                      }}
                    >
                      <Pencil aria-hidden />
                      {t('organization.edit')}
                    </Button>
                  ) : null}
                </>
              }
            />
            <nav
              aria-label={pickLocalized(data, 'name', locale)}
              className="mb-6 flex gap-1 overflow-x-auto border-b"
            >
              {TABS.map((entry) => (
                <NavLink
                  key={entry.key}
                  to={`/organizations/${organizationId}/${entry.key}`}
                  className={() =>
                    cn(
                      '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium',
                      entry.key === current?.key
                        ? 'border-primary text-foreground'
                        : 'border-transparent text-muted-foreground hover:text-foreground',
                    )
                  }
                >
                  {t(`organization.tabs.${entry.key}`)}
                </NavLink>
              ))}
            </nav>
            {current?.render(data)}
            {editing ? (
              <EditOrganizationDialog organization={data} open onOpenChange={setEditing} />
            ) : null}
          </>
        )}
      </QueryState>
    </div>
  );
}
