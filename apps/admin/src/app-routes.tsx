import { RequireAuth, TenantProvider } from '@pos/app-kit';
import { Feature, type Permission } from '@pos/shared-types';
import type { ReactNode } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { api, session, useSession } from './lib/api';
import { AppShell } from './components/app-shell';
import { AdminToaster } from './components/admin-toaster';
import { RequireModule } from './components/require-module';
import { RequirePermission } from './components/require-permission';
import { usePreferences } from './stores/preferences';
import { DashboardPage } from './routes/dashboard-page';
import { LoginPage } from './routes/login-page';
import { AvailabilityPage } from './routes/menu/availability-page';
import { CategoriesPage } from './routes/menu/categories-page';
import { KitchenStationsPage } from './routes/menu/kitchen-stations-page';
import { ModifierGroupsPage } from './routes/menu/modifier-groups-page';
import { ProductsPage } from './routes/menu/products-page';
import { CustomerDetailPage, CustomersPage } from './routes/operations/customers-page';
import { OrderDetailPage } from './routes/operations/order-detail-page';
import { OrdersPage } from './routes/operations/orders-page';
import { PaymentsPage } from './routes/operations/payments-page';
import { ShiftDetailPage, ShiftsPage } from './routes/operations/shifts-page';
import { BrandingPage } from './routes/settings/branding-page';
import { CashRegistersPage } from './routes/settings/cash-registers-page';
import { DiscountsPage } from './routes/settings/discounts-page';
import { LocalizationPage } from './routes/settings/localization-page';
import { LocationsPage } from './routes/settings/locations-page';
import { ModulesPage } from './routes/settings/modules-page';
import { OnlineOrderingPage } from './routes/settings/online-ordering-page';
import { PaymentMethodsPage } from './routes/settings/payment-methods-page';
import { PaymentProvidersPage } from './routes/settings/payment-providers-page';
import { TenantPage } from './routes/settings/tenant-page';
import { TablesPage } from './routes/settings/tables-page';
import { TaxesPage } from './routes/settings/taxes-page';
import { EmployeesPage } from './routes/staff/employees-page';
import { RolesPage } from './routes/staff/roles-page';
import { UsersPage } from './routes/staff/users-page';
import { AuditLogPage } from './routes/system/audit-log-page';
import { DevicesPage } from './routes/system/devices-page';
import { SyncIssuePage, SyncPage } from './routes/system/sync-page';
import { NotFoundPage } from './routes/not-found-page';
import { DomainsPage } from './routes/website/domains-page';
import { WebsiteEditorPage } from './routes/website/website-editor-page';
import { ReportsIndex, ReportsPage } from './routes/reports/reports-page';
import { OrgDashboardPage } from './routes/organization/org-dashboard-page';
import { OrgMembersPage } from './routes/organization/org-members-page';
import { OrgReportsIndex, OrgReportsPage } from './routes/organization/org-reports-page';
import { OrgScope } from './routes/organization/org-scope';

/** A page behind a permission (checked again by the API). */
function guarded(path: string, permission: Permission, element: ReactNode, tenantWide = false) {
  return (
    <Route
      key={path}
      element={<RequirePermission permission={permission} tenantWide={tenantWide} />}
    >
      <Route path={path} element={element} />
    </Route>
  );
}

/** Pages of a module, behind its permission too. */
function moduleGuarded(features: readonly Feature[], route: ReactNode) {
  return (
    <Route key={`module:${features.join(',')}`} element={<RequireModule features={features} />}>
      {route}
    </Route>
  );
}

/**
 * The tenant's modules at the location chosen in the header (ADR 0018), in the language this
 * browser chose, else the user's, else the tenant's default (ADR 0020).
 */
function TenantScope({ children }: { children: ReactNode }) {
  const tenantId = useSession((s) => s.user?.tenantId);
  const preferred = useSession((s) => s.user?.preferredLocale ?? null);
  const locationId = usePreferences((s) => s.locationId);
  const stored = usePreferences((s) => s.locale);
  if (!tenantId) return null;
  return (
    // Keyed by brand: switching brands starts afresh, so the new brand's branding replaces the old.
    <TenantProvider
      key={tenantId}
      api={api}
      tenantId={tenantId}
      locationId={locationId}
      locale={{ stored, preferred }}
    >
      {children}
    </TenantProvider>
  );
}

export function AppRoutes() {
  return (
    <BrowserRouter>
      <AdminToaster />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {/* The organization's pages: outside TenantScope, so MADAR's neutral look (E1 §5). */}
        <Route
          path="org/:organizationId"
          element={
            <RequireAuth session={session}>
              <OrgScope />
            </RequireAuth>
          }
        >
          <Route index element={<OrgDashboardPage />} />
          <Route path="reports" element={<OrgReportsIndex />} />
          <Route path="reports/:kind" element={<OrgReportsPage />} />
          <Route path="members" element={<OrgMembersPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
        <Route
          element={
            <RequireAuth session={session}>
              <TenantScope>
                <AppShell />
              </TenantScope>
            </RequireAuth>
          }
        >
          <Route index element={<DashboardPage />} />
          {guarded('reports', 'reports.view', <ReportsIndex />)}
          {guarded('reports/:kind', 'reports.view', <ReportsPage />)}
          {guarded('operations/orders', 'orders.view', <OrdersPage />)}
          {guarded('operations/orders/:locationId/:orderId', 'orders.view', <OrderDetailPage />)}
          {guarded('operations/customers', 'customers.view', <CustomersPage />)}
          {guarded('operations/customers/:key', 'customers.view', <CustomerDetailPage />)}
          {guarded('operations/payments', 'payments.view', <PaymentsPage />)}
          {guarded('operations/shifts', 'shifts.manage', <ShiftsPage />)}
          {guarded('operations/shifts/:locationId/:shiftId', 'shifts.manage', <ShiftDetailPage />)}
          <Route path="menu" element={<RequirePermission permission="products.view" />}>
            <Route path="categories" element={<CategoriesPage />} />
            <Route path="products" element={<ProductsPage />} />
            {moduleGuarded(
              [Feature.MODIFIERS],
              <Route path="modifier-groups" element={<ModifierGroupsPage />} />,
            )}
            {moduleGuarded(
              [Feature.KDS, Feature.KITCHEN_PRINTER],
              <Route path="kitchen-stations" element={<KitchenStationsPage />} />,
            )}
            <Route path="availability" element={<AvailabilityPage />} />
          </Route>
          {guarded('settings/tenant', 'settings.manage', <TenantPage />, true)}
          {guarded('settings/modules', 'settings.manage', <ModulesPage />, true)}
          {guarded('settings/branding', 'settings.manage', <BrandingPage />, true)}
          {guarded('settings/localization', 'settings.manage', <LocalizationPage />, true)}
          {guarded('settings/locations', 'locations.view', <LocationsPage />)}
          {moduleGuarded(
            [Feature.ONLINE_ORDERING],
            <>
              {guarded('settings/online-ordering', 'locations.view', <OnlineOrderingPage />)}
              {/* The tenant's website and its domains (ADR 0023). */}
              {guarded('website/editor', 'website.manage', <WebsiteEditorPage />, true)}
              {guarded('website/domains', 'website.manage', <DomainsPage />, true)}
            </>,
          )}
          {guarded('settings/taxes', 'products.view', <TaxesPage />)}
          {guarded('settings/discounts', 'settings.manage', <DiscountsPage />)}
          {moduleGuarded(
            [Feature.TABLES],
            guarded('settings/tables', 'orders.view', <TablesPage />),
          )}
          {guarded('settings/payment-methods', 'settings.manage', <PaymentMethodsPage />, true)}
          {guarded('settings/payment-providers', 'settings.manage', <PaymentProvidersPage />, true)}
          {guarded('settings/cash-registers', 'settings.manage', <CashRegistersPage />)}
          {guarded('staff/users', 'users.manage', <UsersPage />, true)}
          {guarded('staff/roles', 'roles.manage', <RolesPage />, true)}
          {guarded('staff/employees', 'users.manage', <EmployeesPage />, true)}
          {guarded('system/devices', 'devices.manage', <DevicesPage />)}
          {guarded('system/sync', 'sync.view', <SyncPage />)}
          {guarded('system/sync/:locationId/:operationId', 'sync.view', <SyncIssuePage />)}
          {guarded('system/audit-log', 'audit.view', <AuditLogPage />)}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
