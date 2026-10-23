import { FeatureGate, RequireAuth, TenantProvider } from '@pos/app-kit';
import { Feature } from '@pos/shared-types';
import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { PosShell } from './components/pos-shell';
import { api, session, useSession } from './lib/session';
import { LocationPage } from './routes/location-page';
import { LoginPage } from './routes/login-page';
import { OrderPage } from './routes/order-page';
import { OrdersPage } from './routes/orders-page';
import { SettingsPage } from './routes/settings-page';
import { ShiftPage } from './routes/shift-page';
import { SyncPage } from './routes/sync-page';
import { TablesPage } from './routes/tables-page';
import { usePreferences } from './stores/preferences';

/** Screens that operate on a location need one chosen for this terminal first. */
function RequireLocation({ children }: { children: ReactNode }) {
  const locationId = usePreferences((s) => s.locationId);
  return locationId ? <>{children}</> : <Navigate to="/location" replace />;
}

/** The tenant's modules at this terminal's location (ADR 0018), served by the hub. */
function TenantScope({ children }: { children: ReactNode }) {
  const tenantId = useSession((s) => s.user?.tenantId);
  const locationId = usePreferences((s) => s.locationId);
  if (!tenantId) return null;
  return (
    <TenantProvider api={api} tenantId={tenantId} locationId={locationId}>
      {children}
    </TenantProvider>
  );
}

export function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/location"
          element={
            <RequireAuth session={session}>
              <LocationPage />
            </RequireAuth>
          }
        />
        <Route
          element={
            <RequireAuth session={session}>
              <RequireLocation>
                <TenantScope>
                  <PosShell />
                </TenantScope>
              </RequireLocation>
            </RequireAuth>
          }
        >
          <Route path="/order" element={<OrderPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route
            path="/tables"
            element={
              <FeatureGate feature={Feature.TABLES} fallback={<Navigate to="/order" replace />}>
                <TablesPage />
              </FeatureGate>
            }
          />
          <Route path="/shift" element={<ShiftPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/sync" element={<SyncPage />} />
          <Route path="*" element={<Navigate to="/order" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
