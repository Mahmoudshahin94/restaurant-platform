import type { PlatformPermission } from '@pos/shared-types';
import { EmptyState } from '@pos/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AppShell } from './components/app-shell';
import { RequireAuth } from './components/require-auth';
import { RequirePermission } from './components/require-permission';
import { AuditPage } from './routes/audit-page';
import { HealthBoardPage } from './routes/health-board-page';
import { LoginPage } from './routes/login-page';
import { OrganizationDetailPage } from './routes/organization/organization-detail-page';
import { OrganizationsPage } from './routes/organizations-page';
import { ReleasesPage } from './routes/releases-page';
import { SupportPage } from './routes/support-page';
import { TenantDetailPage } from './routes/tenant/tenant-detail-page';
import { TenantsPage } from './routes/tenants-page';

function guarded(path: string, permission: PlatformPermission, element: ReactNode) {
  return (
    <Route key={path} element={<RequirePermission permission={permission} />}>
      <Route path={path} element={element} />
    </Route>
  );
}

function NotFound() {
  const { t } = useTranslation('platform');
  return <EmptyState title={t('notFound')} />;
}

export function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="/tenants" replace />} />
          {guarded('tenants', 'tenants.view', <TenantsPage />)}
          {guarded('tenants/:tenantId/:tab?', 'tenants.view', <TenantDetailPage />)}
          {guarded('organizations', 'organizations.view', <OrganizationsPage />)}
          {guarded(
            'organizations/:organizationId/:tab?',
            'organizations.view',
            <OrganizationDetailPage />,
          )}
          {guarded('health', 'health.view', <HealthBoardPage />)}
          {guarded('releases', 'releases.view', <ReleasesPage />)}
          {guarded('support', 'support.find', <SupportPage />)}
          {guarded('audit', 'audit.view', <AuditPage />)}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
