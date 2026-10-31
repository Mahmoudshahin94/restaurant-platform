import { PageShell, PlatformFooter } from '@pos/app-kit';
import { BarChart3, LayoutDashboard, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Outlet, useParams } from 'react-router';
import { BrandSwitcher } from '../../components/brand-switcher';
import { UserMenu } from '../../components/user-menu';
import { useSession } from '../../stores/session';
import { NotFoundPage } from '../not-found-page';

/**
 * The frame of the organization pages (E1 §5), shown in MADAR's neutral look: it mounts no
 * `TenantProvider`, so no brand's colours, logo or language rules apply, and a brand's branding
 * is removed as soon as the person leaves its pages. Members of the organization only (the API
 * checks too); the members page is for Owners, and its link is shown to them alone.
 */
export function OrgScope() {
  const { t } = useTranslation('admin');
  const { organizationId = '' } = useParams();
  const organization = useSession((s) =>
    s.user?.organizations.find((o) => o.id === organizationId),
  );
  const base = `/org/${organizationId}`;
  const items = organization
    ? [
        {
          to: base,
          label: t('nav.organizationOverview'),
          icon: <LayoutDashboard aria-hidden className="size-4" />,
          end: true,
        },
        {
          to: `${base}/reports`,
          label: t('nav.orgReports'),
          icon: <BarChart3 aria-hidden className="size-4" />,
        },
        ...(organization.role === 'OWNER'
          ? [
              {
                to: `${base}/members`,
                label: t('nav.orgMembers'),
                icon: <Users aria-hidden className="size-4" />,
              },
            ]
          : []),
      ]
    : [];
  return (
    <PageShell
      brand={<BrandSwitcher />}
      nav={items.length > 0 ? [{ id: 'organization', label: t('nav.organization'), items }] : []}
      header={<UserMenu />}
      skipLabel={t('nav.skipToContent')}
      navLabel={t('nav.mainNavigation')}
    >
      {organization ? <Outlet /> : <NotFoundPage />}
      <PlatformFooter app="admin" className="mt-8" />
    </PageShell>
  );
}
